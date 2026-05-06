"""Phase 0 — Stage 2.5 (VALIDATE-IFC) implementation.

Wires `ifctester` into the export pipeline. Picks the IDS file set for the
requested (target_fidelity, discipline) pair, runs validation against the
emitted ifcopenshell.File, and returns a structured `IdsValidationResult`
the export router merges into the response metadata.

Design notes
------------
* `ifctester` is lazy-imported. When it is missing in the runtime image the
  validator returns an empty result with `skipped_reason` set, so the rest
  of the pipeline still serves a response. This is what allows the test
  suite to run on a developer laptop without `ifctester` installed —
  CI installs it via `pip install -e ".[dev]"` and exercises the real path.
* Severity is derived from the IDS file at validation time: a spec whose
  requirement facets are all `cardinality="optional"` produces warnings
  on failure; anything containing a `required` or `prohibited` facet
  produces errors. This mirrors the buildingSMART IDS 1.0 cardinality
  model without inventing a parallel severity vocabulary.
* The 5-second latency budget (R2) is enforced loosely: we time the whole
  multi-file run and log a warning if it exceeds the target. The hard cap
  is a tests/test_ids_validation_stage.py invariant, not a runtime kill.
"""

from __future__ import annotations

import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import TYPE_CHECKING, Literal

import structlog

if TYPE_CHECKING:
    from app.models.response import IdsValidationResult, IdsViolation

log = structlog.get_logger()

IDS_NS = "{http://standards.buildingsmart.org/IDS}"

# Service root → app/services/ids_validator.py → ../.. = service root
IDS_DIR = Path(__file__).resolve().parents[2] / "ids"

TargetFidelity = Literal["concept", "design-development", "tender-ready"]
LATENCY_TARGET_SECONDS = 5.0


def ids_files_for(fidelity: str, discipline: str) -> list[Path]:
    """Return the IDS files to validate for a given (fidelity, discipline).

    Concept tier validates against `core.ids` only — that is the only
    spec-mandatory floor. Design-development adds `lod-300.ids` plus the
    discipline overlay. Tender-ready additionally pulls in `lod-350.ids`.
    The `combined` discipline pulls in all three discipline overlays.
    """
    files: list[Path] = [IDS_DIR / "core.ids"]
    if fidelity == "concept":
        return files

    files.append(IDS_DIR / "lod-300.ids")
    if fidelity == "tender-ready":
        files.append(IDS_DIR / "lod-350.ids")

    if discipline in ("architectural", "combined"):
        files.append(IDS_DIR / "architectural.ids")
    if discipline in ("structural", "combined"):
        files.append(IDS_DIR / "structural.ids")
    if discipline in ("mep", "combined"):
        files.append(IDS_DIR / "mep.ids")

    return files


def _spec_severity_index(ids_path: Path) -> dict[str, str]:
    """Pre-extract per-spec severity from the IDS XML.

    Returns a {identifier → 'error'|'warning'} map. Specs with only
    optional-cardinality requirement facets become warnings; any required
    or prohibited facet upgrades to error. Missing identifier → keyed by
    spec name as a fallback.
    """
    index: dict[str, str] = {}
    try:
        tree = ET.parse(ids_path)
    except ET.ParseError as exc:
        log.error("ids_xml_parse_failed", path=str(ids_path), error=str(exc))
        return index

    for spec in tree.iter(f"{IDS_NS}specification"):
        key = spec.get("identifier") or spec.get("name") or ""
        if not key:
            continue
        reqs = spec.find(f"{IDS_NS}requirements")
        if reqs is None:
            index[key] = "error"
            continue
        cardinalities = [child.get("cardinality") for child in list(reqs)]
        # Only treat as warning if at least one requirement facet exists
        # AND every facet is explicitly optional. A spec with no cardinality
        # attributes (e.g. attribute facets without explicit cardinality)
        # defaults to required per the IDS schema.
        explicit = [c for c in cardinalities if c is not None]
        if explicit and all(c == "optional" for c in explicit):
            index[key] = "warning"
        else:
            index[key] = "error"
    return index


def _failed_entities(spec: object) -> list[object]:
    """Best-effort extraction of failed-entity records across ifctester versions.

    Different `ifctester` releases expose this as `failed_entities`,
    `failures`, or via a callable. We probe them in order and return a
    list of records (each is either a dict with 'element'/'reason' keys
    or an object with attributes of the same name).
    """
    for attr in ("failed_entities", "failures"):
        value = getattr(spec, attr, None)
        if value is None:
            continue
        if callable(value):
            try:
                value = value()
            except TypeError:
                continue
        if value:
            return list(value)
    return []


def _extract_element_guid(failure: object) -> str | None:
    elem = None
    if isinstance(failure, dict):
        elem = failure.get("element")
    else:
        elem = getattr(failure, "element", None)
    if elem is None:
        return None
    return getattr(elem, "GlobalId", None)


def _extract_reason(failure: object) -> str:
    if isinstance(failure, dict):
        reason = failure.get("reason")
    else:
        reason = getattr(failure, "reason", None)
    if reason:
        return str(reason)
    elem = failure.get("element") if isinstance(failure, dict) else getattr(failure, "element", None)
    if elem is not None:
        try:
            return f"{elem.is_a()} #{elem.id()}"
        except Exception:
            return str(elem)
    return "(no detail)"


def validate_ifc(
    ifc_model: object,
    discipline: str,
    target_fidelity: str,
) -> "IdsValidationResult":
    """Run the IDS rule set for the (fidelity, discipline) pair.

    The single side-effect callers care about: returns a fully-populated
    `IdsValidationResult`. Never raises — exceptions are logged and turned
    into a `skipped_reason` so the export pipeline can degrade gracefully.
    """
    from app.models.response import IdsValidationResult, IdsViolation

    start = time.monotonic()

    try:
        from ifctester import ids as ifctester_ids
    except ImportError as exc:
        log.warning("ifctester_not_installed", error=str(exc))
        return IdsValidationResult(
            passed=True,
            target_fidelity=target_fidelity,
            files_validated=0,
            rules_evaluated=0,
            elapsed_ms=0.0,
            skipped_reason=f"ifctester import failed: {exc}",
        )

    files = ids_files_for(target_fidelity, discipline)
    violations: list[IdsViolation] = []
    warnings: list[IdsViolation] = []
    rules_evaluated = 0
    files_validated = 0

    for ids_path in files:
        if not ids_path.exists():
            log.warning("ids_file_missing", path=str(ids_path))
            continue

        severity_by_id = _spec_severity_index(ids_path)

        try:
            ids_obj = ifctester_ids.open(str(ids_path))
            ids_obj.validate(ifc_model)
        except Exception as exc:
            log.error(
                "ids_validation_crashed",
                ids_file=ids_path.name,
                error=str(exc),
                error_type=type(exc).__name__,
                exc_info=True,
            )
            continue

        files_validated += 1
        for spec in getattr(ids_obj, "specifications", []) or []:
            rules_evaluated += 1
            status = getattr(spec, "status", True)
            # ifctester sets status: True (passed), False (failed), None (no
            # applicable entities). Treat None as passed — applicability not
            # met means the rule did not trigger, which is not a failure.
            if status is not False:
                continue

            rule_id = getattr(spec, "identifier", None) or getattr(spec, "name", "?")
            rule_name = getattr(spec, "name", rule_id)
            severity = severity_by_id.get(rule_id, "error")
            description = getattr(spec, "description", None) or rule_name
            instructions = getattr(spec, "instructions", None)

            failures = _failed_entities(spec)
            if not failures:
                # Spec failed but no per-entity record — emit a single
                # spec-level violation so callers see something.
                violation = IdsViolation(
                    rule_id=rule_id,
                    rule_name=rule_name,
                    severity=severity,  # type: ignore[arg-type]
                    discipline=discipline,
                    applicable_element_guid=None,
                    expected=description,
                    actual="spec failed (no per-entity detail available)",
                    hint=instructions,
                )
                (warnings if severity == "warning" else violations).append(violation)
                continue

            for failure in failures:
                violation = IdsViolation(
                    rule_id=rule_id,
                    rule_name=rule_name,
                    severity=severity,  # type: ignore[arg-type]
                    discipline=discipline,
                    applicable_element_guid=_extract_element_guid(failure),
                    expected=description,
                    actual=_extract_reason(failure),
                    hint=instructions,
                )
                (warnings if severity == "warning" else violations).append(violation)

    elapsed_s = time.monotonic() - start
    elapsed_ms = round(elapsed_s * 1000, 1)
    if elapsed_s > LATENCY_TARGET_SECONDS:
        log.warning(
            "ids_validation_slow",
            elapsed_ms=elapsed_ms,
            target_seconds=LATENCY_TARGET_SECONDS,
            files_validated=files_validated,
            discipline=discipline,
            target_fidelity=target_fidelity,
        )

    return IdsValidationResult(
        passed=len(violations) == 0,
        target_fidelity=target_fidelity,
        violations=violations,
        warnings=warnings,
        files_validated=files_validated,
        rules_evaluated=rules_evaluated,
        elapsed_ms=elapsed_ms,
    )


def merge_results(results: list["IdsValidationResult"]) -> "IdsValidationResult":
    """Aggregate per-discipline results into one envelope for the response.

    Violations and warnings concatenate; counts sum; elapsed_ms sums (the
    pipeline runs disciplines sequentially today, so this is the wallclock
    spent in stage 2.5 across all files). `passed` is True iff every input
    was either passed or skipped.
    """
    from app.models.response import IdsValidationResult

    if not results:
        return IdsValidationResult()

    merged_violations = []
    merged_warnings = []
    rules = 0
    files = 0
    elapsed = 0.0
    skipped_reasons: list[str] = []
    passed = True
    fidelity = results[0].target_fidelity

    for r in results:
        merged_violations.extend(r.violations)
        merged_warnings.extend(r.warnings)
        rules += r.rules_evaluated
        files += r.files_validated
        elapsed += r.elapsed_ms
        if r.skipped_reason:
            skipped_reasons.append(r.skipped_reason)
        if not r.passed:
            passed = False

    return IdsValidationResult(
        passed=passed,
        target_fidelity=fidelity,
        violations=merged_violations,
        warnings=merged_warnings,
        files_validated=files,
        rules_evaluated=rules,
        elapsed_ms=round(elapsed, 1),
        skipped_reason="; ".join(skipped_reasons) if skipped_reasons else None,
    )
