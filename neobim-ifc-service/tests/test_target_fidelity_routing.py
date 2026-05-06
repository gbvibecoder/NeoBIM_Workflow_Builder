"""Phase 0 — target_fidelity routing.

Pin the (target_fidelity, discipline) → IDS files mapping in
`app.services.ids_validator.ids_files_for`. The mapping is the
contract between the export pipeline and the IDS rule set; a regression
that, say, drops `lod-300.ids` from `design-development` validation would
silently weaken every IFC shipped — these tests guard against that.

These tests don't need `ifctester` or `ifcopenshell` installed because
they exercise pure file-routing logic on the IDS_DIR paths.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services.ids_validator import IDS_DIR, ids_files_for


# ── Concept tier — core only ─────────────────────────────────────────


@pytest.mark.parametrize(
    "discipline",
    ["architectural", "structural", "mep", "combined"],
)
def test_concept_validates_against_core_only(discipline: str):
    files = ids_files_for("concept", discipline)
    assert files == [IDS_DIR / "core.ids"], (
        f"concept × {discipline} should validate against core.ids only, "
        f"got {[p.name for p in files]}"
    )


# ── Design-development tier — core + lod-300 + discipline overlay ───


def test_design_development_architectural():
    files = ids_files_for("design-development", "architectural")
    names = [p.name for p in files]
    assert names == ["core.ids", "lod-300.ids", "architectural.ids"], (
        f"unexpected files: {names}"
    )


def test_design_development_structural():
    files = ids_files_for("design-development", "structural")
    names = [p.name for p in files]
    assert names == ["core.ids", "lod-300.ids", "structural.ids"], (
        f"unexpected files: {names}"
    )


def test_design_development_mep():
    files = ids_files_for("design-development", "mep")
    names = [p.name for p in files]
    assert names == ["core.ids", "lod-300.ids", "mep.ids"], (
        f"unexpected files: {names}"
    )


def test_design_development_combined_pulls_all_disciplines():
    files = ids_files_for("design-development", "combined")
    names = [p.name for p in files]
    assert names == [
        "core.ids",
        "lod-300.ids",
        "architectural.ids",
        "structural.ids",
        "mep.ids",
    ], f"combined should aggregate all overlays, got {names}"


# ── Tender-ready tier — adds lod-350 ─────────────────────────────────


def test_tender_ready_architectural():
    files = ids_files_for("tender-ready", "architectural")
    names = [p.name for p in files]
    assert names == [
        "core.ids", "lod-300.ids", "lod-350.ids", "architectural.ids",
    ], f"unexpected files: {names}"


def test_tender_ready_structural():
    files = ids_files_for("tender-ready", "structural")
    names = [p.name for p in files]
    assert names == [
        "core.ids", "lod-300.ids", "lod-350.ids", "structural.ids",
    ], f"unexpected files: {names}"


def test_tender_ready_mep():
    files = ids_files_for("tender-ready", "mep")
    names = [p.name for p in files]
    assert names == [
        "core.ids", "lod-300.ids", "lod-350.ids", "mep.ids",
    ], f"unexpected files: {names}"


def test_tender_ready_combined_pulls_everything():
    files = ids_files_for("tender-ready", "combined")
    names = [p.name for p in files]
    assert names == [
        "core.ids", "lod-300.ids", "lod-350.ids",
        "architectural.ids", "structural.ids", "mep.ids",
    ], f"tender-ready × combined should pull every IDS file, got {names}"


# ── Cross-tier monotonicity ──────────────────────────────────────────


@pytest.mark.parametrize("discipline", ["architectural", "structural", "mep", "combined"])
def test_higher_tier_is_superset_of_lower(discipline: str):
    """tender-ready must be a superset of design-development must be a
    superset of concept. A regression that drops a file at a higher tier
    is the failure mode this test catches."""
    concept = set(ids_files_for("concept", discipline))
    dev = set(ids_files_for("design-development", discipline))
    tender = set(ids_files_for("tender-ready", discipline))

    assert concept.issubset(dev), (
        f"{discipline}: concept {[p.name for p in concept]} not subset of "
        f"design-development {[p.name for p in dev]}"
    )
    assert dev.issubset(tender), (
        f"{discipline}: design-development {[p.name for p in dev]} not "
        f"subset of tender-ready {[p.name for p in tender]}"
    )


# ── Files actually exist on disk ─────────────────────────────────────


@pytest.mark.parametrize(
    "fidelity,discipline",
    [
        ("concept", "combined"),
        ("design-development", "combined"),
        ("tender-ready", "combined"),
    ],
)
def test_routed_files_exist(fidelity: str, discipline: str):
    """Routing returns paths — every returned path must point to a real
    IDS file on disk so Stage 2.5 doesn't crash with FileNotFoundError."""
    for path in ids_files_for(fidelity, discipline):
        assert path.is_file(), f"missing IDS file: {path}"


# ── Default tier is design-development ───────────────────────────────


def test_export_options_default_target_fidelity():
    """The default tier on `ExportOptions.target_fidelity` is
    `design-development` — pinning this prevents accidentally flipping
    the default to a stricter tier (which would start failing builds
    that previously shipped clean) or to a weaker tier (which would
    silently strip validation)."""
    from app.models.request import ExportOptions

    opts = ExportOptions()
    assert opts.target_fidelity == "design-development"


def test_export_options_target_fidelity_accepts_all_tiers():
    from app.models.request import ExportOptions

    for tier in ("concept", "design-development", "tender-ready"):
        opts = ExportOptions(targetFidelity=tier)
        assert opts.target_fidelity == tier


def test_export_options_target_fidelity_rejects_garbage():
    """Bogus tier values must raise — Pydantic Literal validation, same
    discipline as `rich_mode`."""
    from pydantic import ValidationError

    from app.models.request import ExportOptions

    with pytest.raises(ValidationError):
        ExportOptions(targetFidelity="lod-500")  # type: ignore[arg-type]
