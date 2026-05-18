"""
Hard Verifier — deterministic spec vs IFC comparison.

Compares briefSpec.furniture[*].parts vs actual IfcRelAggregates children
in a produced IFC file. Also checks trim presence and opening dimensions.

Requires ifcopenshell for IFC parsing. Called from the Flask endpoint
POST /api/v3/verifier/check-build.
"""

from __future__ import annotations

import datetime
import io
import logging
from dataclasses import dataclass, field
from typing import Any

import requests

logger = logging.getLogger(__name__)

try:
    import ifcopenshell
except ImportError:
    ifcopenshell = None  # type: ignore[assignment]


# ─── Types ────────────────────────────────────────────────────────────────


@dataclass
class Mismatch:
    type: str
    item_id: str
    item_type: str | None
    expected: Any
    actual: Any
    severity: str  # "low", "med", "high"
    description: str
    suggested_patch: str | None = None

    def to_dict(self) -> dict:
        d: dict = {
            "type": self.type,
            "item_id": self.item_id,
            "expected": self.expected,
            "actual": self.actual,
            "severity": self.severity,
            "description": self.description,
        }
        if self.item_type:
            d["item_type"] = self.item_type
        if self.suggested_patch:
            d["suggested_patch"] = self.suggested_patch
        return d


@dataclass
class VerifierReport:
    verified: bool = True
    parts_coverage: float = 1.0
    trim_coverage: float = 1.0
    mismatches: list[Mismatch] = field(default_factory=list)
    summary: str = ""
    verified_at: str = ""

    def to_dict(self) -> dict:
        return {
            "verified": self.verified,
            "parts_coverage": round(self.parts_coverage, 4),
            "trim_coverage": round(self.trim_coverage, 4),
            "mismatches": [m.to_dict() for m in self.mismatches],
            "summary": self.summary,
            "verified_at": self.verified_at or datetime.datetime.utcnow().isoformat() + "Z",
        }


# ─── Main verification ───────────────────────────────────────────────────


def check_build(
    ifc_url: str,
    spec: dict,
    tolerance: dict | None = None,
) -> VerifierReport:
    """
    Fetch IFC from URL, open with ifcopenshell, compare against spec.

    Parameters
    ----------
    ifc_url : str
        R2 URL to the produced IFC file.
    spec : dict
        BriefSpec as a plain dict.
    tolerance : dict, optional
        Keys: dim_m (float), parts_min_fraction (float).

    Returns
    -------
    VerifierReport
    """
    tol = tolerance or {}
    dim_tol = tol.get("dim_m", 0.1)
    parts_min = tol.get("parts_min_fraction", 0.7)

    report = VerifierReport(verified_at=datetime.datetime.utcnow().isoformat() + "Z")

    if ifcopenshell is None:
        report.verified = False
        report.summary = "ifcopenshell not available — cannot verify IFC."
        report.mismatches.append(Mismatch(
            type="missing_item",
            item_id="__system__",
            item_type=None,
            expected="ifcopenshell",
            actual=None,
            severity="high",
            description="ifcopenshell module not installed — verification impossible.",
        ))
        return report

    # Fetch IFC
    try:
        resp = requests.get(ifc_url, timeout=30)
        resp.raise_for_status()
        ifc_bytes = resp.content
    except Exception as exc:
        report.verified = False
        report.summary = f"Failed to fetch IFC: {exc}"
        report.mismatches.append(Mismatch(
            type="missing_item",
            item_id="__fetch__",
            item_type=None,
            expected="IFC file",
            actual=str(exc),
            severity="high",
            description=f"Could not download IFC from {ifc_url[:80]}",
        ))
        return report

    # Parse IFC
    try:
        ifc = ifcopenshell.open(io.BytesIO(ifc_bytes))
    except Exception as exc:
        report.verified = False
        report.summary = f"Failed to parse IFC: {exc}"
        report.mismatches.append(Mismatch(
            type="missing_item",
            item_id="__parse__",
            item_type=None,
            expected="valid IFC",
            actual=str(exc),
            severity="high",
            description="IFC file could not be opened with ifcopenshell.",
        ))
        return report

    # ── Furniture parts check ─────────────────────────────────────────
    furniture = spec.get("furniture") or []
    total_expected_parts = 0
    total_actual_parts = 0

    # Build a lookup: element name/tag → IFC product
    products_by_name: dict[str, list] = {}
    for product in ifc.by_type("IfcProduct"):
        name = (getattr(product, "Name", None) or "").lower()
        tag = (getattr(product, "Tag", None) or "").lower()
        for key in [name, tag]:
            if key:
                products_by_name.setdefault(key, []).append(product)

    for item in furniture:
        item_id = item.get("id", "")
        parts = item.get("parts") or []
        if not parts:
            continue

        expected_count = len(parts)
        total_expected_parts += expected_count

        # Find matching parent element (case-insensitive substring)
        parent = None
        for key, prods in products_by_name.items():
            if item_id.lower() in key or key in item_id.lower():
                parent = prods[0]
                break

        if parent is None:
            report.mismatches.append(Mismatch(
                type="missing_item",
                item_id=item_id,
                item_type=item.get("type"),
                expected=expected_count,
                actual=0,
                severity="high",
                description=f"Item {item_id} not found in IFC.",
                suggested_patch="force_parts",
            ))
            continue

        # Count children via IfcRelAggregates
        actual_children = 0
        for rel in ifc.by_type("IfcRelAggregates"):
            if rel.RelatingObject == parent:
                actual_children = len(rel.RelatedObjects)
                break

        total_actual_parts += actual_children

        if actual_children < expected_count * parts_min:
            report.mismatches.append(Mismatch(
                type="missing_parts",
                item_id=item_id,
                item_type=item.get("type"),
                expected=expected_count,
                actual=actual_children,
                severity="high" if actual_children == 0 else "med",
                description=f"{item_id}: expected {expected_count} parts, found {actual_children}.",
                suggested_patch="force_parts",
            ))
        elif actual_children == 0 and expected_count > 0:
            report.mismatches.append(Mismatch(
                type="missing_aggregation",
                item_id=item_id,
                item_type=item.get("type"),
                expected=expected_count,
                actual=0,
                severity="med",
                description=f"{item_id}: {expected_count} parts expected but no IfcRelAggregates found.",
                suggested_patch="force_parts",
            ))

    # ── Trim check ────────────────────────────────────────────────────
    trim_items = spec.get("trim") or []
    total_expected_trim = len(trim_items)
    actual_trim_count = 0

    coverings = {(getattr(c, "Name", None) or "").lower() for c in ifc.by_type("IfcCovering")}
    accessories = {(getattr(a, "Name", None) or "").lower() for a in ifc.by_type("IfcDiscreteAccessory")}
    all_trim_names = coverings | accessories

    for trim in trim_items:
        trim_id = (trim.get("id") or "").lower()
        found = any(trim_id in name or name in trim_id for name in all_trim_names if name)
        if found:
            actual_trim_count += 1
        else:
            report.mismatches.append(Mismatch(
                type="missing_trim",
                item_id=trim.get("id", ""),
                item_type=trim.get("type"),
                expected=1,
                actual=0,
                severity="med",
                description=f"Trim item {trim.get('id', '')} ({trim.get('type', '')}) not found in IFC.",
                suggested_patch="add_trim",
            ))

    # ── Compute coverage ──────────────────────────────────────────────
    report.parts_coverage = (
        total_actual_parts / total_expected_parts
        if total_expected_parts > 0
        else 1.0
    )
    report.trim_coverage = (
        actual_trim_count / total_expected_trim
        if total_expected_trim > 0
        else 1.0
    )

    # ── Verdict ───────────────────────────────────────────────────────
    has_high = any(m.severity == "high" for m in report.mismatches)
    report.verified = report.parts_coverage >= parts_min and not has_high

    report.summary = (
        f"Parts: {total_actual_parts}/{total_expected_parts} "
        f"({report.parts_coverage:.0%}), "
        f"Trim: {actual_trim_count}/{total_expected_trim} "
        f"({report.trim_coverage:.0%}), "
        f"{len(report.mismatches)} mismatch(es). "
        f"{'PASS' if report.verified else 'FAIL'}"
    )

    return report
