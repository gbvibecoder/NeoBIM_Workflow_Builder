"""Tests for the orchestrator — map_walls_to_panels (DESIGN.md §6.1).

The flagship: P_INT_8 end-to-end. The orchestrator chains PR 1-7 modules
through the full pipeline (validate → segment → enrich → corner/T-junction →
split → totals → validate) and the resulting Panel objects are byte-equal
to the PR 1 canonical golden JSON.

Coverage:
  - Flagship: P_INT_8 byte-equal vs golden + project totals
  - All 21 invariants pass on P_INT_8 (validate_output returns [])
  - Schema fields (schema_version, generated_at format, downstream_ready)
  - assumptions_made + pending_karthik populated (static tuples)
  - Input validation errors: IV-1 (non-FLOOR_PLAN), IV-2 (boq False),
    IV-3 (empty walls), IV-5 (empty project_name + bad seismic_zone)
  - Determinism: panels are byte-equal across repeated calls (generated_at
    excluded)
  - generated_at is the ONLY datetime.now() use
"""

from __future__ import annotations

import dataclasses
import math
import re

import pytest

from app.services.kos_panel_grid_mapper import (
    MAPPER_SCHEMA_VERSION,
    MapperInput,
    MapperInputError,
    OutputInvariantError,
    PanelGridMapperOutput,
    map_walls_to_panels,
    validate_output,
)


# ──────────────────────────────────────────────────────────────────────────────
# THE FLAGSHIP — P_INT_8 end-to-end byte-equal vs PR 1 golden JSON
# ──────────────────────────────────────────────────────────────────────────────


def test_p_int_8_full_orchestration_produces_panel_grid_mapper_output(
    p_int_8_mapper_input: MapperInput,
) -> None:
    output = map_walls_to_panels(p_int_8_mapper_input)
    assert isinstance(output, PanelGridMapperOutput)


def test_p_int_8_full_orchestration_one_segment_nine_panels(
    p_int_8_mapper_input: MapperInput,
) -> None:
    output = map_walls_to_panels(p_int_8_mapper_input)
    assert len(output.wall_segments) == 1
    seg = output.wall_segments[0]
    assert len(seg.panels) == 9


def test_p_int_8_full_orchestration_panels_byte_equal_to_golden(
    p_int_8_mapper_input: MapperInput, p_int_8_canonical_json: dict,
) -> None:
    """All 18 Panel fields × 9 panels match the canonical golden JSON byte-equal.

    Note: segment id may differ (golden says 'P_INT_8' but the fixture
    contains 1 isolated wall with no externals, so segmenter assigns
    'P_INT_1'). We compare PANELS, not segment id. The acid is that the
    splitter + numeric pipeline produces the same panel content as the
    canonical regardless of where the segment ends up named."""
    output = map_walls_to_panels(p_int_8_mapper_input)
    seg = output.wall_segments[0]
    golden_panels = p_int_8_canonical_json["panels"]

    assert len(seg.panels) == len(golden_panels)
    for actual, expected in zip(seg.panels, golden_panels):
        # Identity fields — exact equality
        assert actual.label == expected["label"]
        assert actual.sku == expected["sku"]
        assert actual.type == expected["type"]
        assert actual.thickness_mm == expected["thickness_mm"]
        assert actual.width_mm == expected["width_mm"]
        assert actual.cut_length_mm == expected["cut_length_mm"]
        assert actual.raw_length_mm == expected["raw_length_mm"]
        assert actual.orientation == expected["orientation"]
        assert actual.is_cut_member == expected["is_cut_member"]
        # Float fields — should match the canonical denominator (92903.04) exactly
        assert math.isclose(actual.position_mm, expected["position_mm"], abs_tol=1e-9)
        assert math.isclose(actual.area_sqft, expected["area_sqft"], rel_tol=1e-12)
        assert math.isclose(actual.weight_kg, expected["weight_kg"], rel_tol=1e-12)
        assert math.isclose(actual.weight_kg_skin, expected["weight_kg_skin"], rel_tol=1e-12)
        assert math.isclose(actual.weight_kg_rib, expected["weight_kg_rib"], rel_tol=1e-12)
        assert math.isclose(actual.raw_weight_kg, expected["raw_weight_kg"], rel_tol=1e-12)
        assert math.isclose(actual.waste_weight_kg, expected["waste_weight_kg"], rel_tol=1e-12)
        assert math.isclose(actual.price_inr, expected["price_inr"], rel_tol=1e-12)


def test_p_int_8_segment_totals_match_golden(
    p_int_8_mapper_input: MapperInput, p_int_8_canonical_json: dict,
) -> None:
    """Per-segment totals (cost/weight/skin/rib/raw/waste) match the golden."""
    output = map_walls_to_panels(p_int_8_mapper_input)
    seg = output.wall_segments[0]
    assert math.isclose(
        seg.segment_cost_inr, p_int_8_canonical_json["segment_cost_inr"], rel_tol=1e-10
    )
    assert math.isclose(
        seg.segment_weight_kg, p_int_8_canonical_json["segment_weight_kg"], rel_tol=1e-10
    )
    assert math.isclose(
        seg.segment_skin_kg, p_int_8_canonical_json["segment_skin_kg"], rel_tol=1e-10
    )
    assert math.isclose(
        seg.segment_rib_kg, p_int_8_canonical_json["segment_rib_kg"], rel_tol=1e-10
    )
    assert math.isclose(
        seg.segment_raw_kg, p_int_8_canonical_json["segment_raw_kg"], rel_tol=1e-10
    )
    assert math.isclose(
        seg.segment_waste_kg, p_int_8_canonical_json["segment_waste_kg"], rel_tol=1e-10
    )


def test_p_int_8_project_totals_match_segment_totals_single_segment(
    p_int_8_mapper_input: MapperInput, p_int_8_canonical_json: dict,
) -> None:
    """Single-segment project: total_* == segment_*."""
    output = map_walls_to_panels(p_int_8_mapper_input)
    assert math.isclose(
        output.total_cost_inr, p_int_8_canonical_json["segment_cost_inr"], rel_tol=1e-10
    )
    assert math.isclose(
        output.total_weight_kg, p_int_8_canonical_json["segment_weight_kg"], rel_tol=1e-10
    )
    assert math.isclose(
        output.total_skin_kg + output.total_rib_kg,
        output.total_weight_kg,
        rel_tol=1e-10,
    )


def test_p_int_8_passes_all_21_validation_invariants(
    p_int_8_mapper_input: MapperInput,
) -> None:
    """Validator returns zero hard issues for P_INT_8 end-to-end output."""
    output = map_walls_to_panels(p_int_8_mapper_input)
    issues = validate_output(output)
    hard = [i for i in issues if i.severity == "hard"]
    assert hard == [], f"Unexpected hard validation failures: {[i.message for i in hard]}"


def test_p_int_8_segment_id_is_p_int_1_not_p_int_8(
    p_int_8_mapper_input: MapperInput,
) -> None:
    """The fixture has 1 isolated wall + no externals → segmenter assigns
    P_INT_1 (since externals consume 1..N first, and there are none).
    This is an honest divergence from the golden's `P_INT_8` — the golden's
    naming presumes a fuller Vamshi project context, while the fixture is
    a single segment in isolation."""
    output = map_walls_to_panels(p_int_8_mapper_input)
    assert output.wall_segments[0].id == "P_INT_1"


# ──────────────────────────────────────────────────────────────────────────────
# Output schema sanity
# ──────────────────────────────────────────────────────────────────────────────


def test_schema_version_set_from_constants(p_int_8_mapper_input: MapperInput) -> None:
    output = map_walls_to_panels(p_int_8_mapper_input)
    assert output.schema_version == MAPPER_SCHEMA_VERSION == "0.1.0"


def test_generated_at_is_iso_8601(p_int_8_mapper_input: MapperInput) -> None:
    """generated_at is the only allowed datetime.now() — must be ISO-8601 UTC."""
    output = map_walls_to_panels(p_int_8_mapper_input)
    # Format: "YYYY-MM-DDTHH:MM:SS+00:00" (timespec=seconds, UTC)
    pattern = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$")
    assert pattern.match(output.generated_at), (
        f"generated_at={output.generated_at!r} doesn't match ISO-8601 format"
    )


def test_assumptions_made_is_populated(p_int_8_mapper_input: MapperInput) -> None:
    """assumptions_made is the static design-time tuple (not empty)."""
    output = map_walls_to_panels(p_int_8_mapper_input)
    assert len(output.assumptions_made) >= 5
    assert any("POLICY-KARTHIK-WINS" in a for a in output.assumptions_made)
    assert any("R1 INTEGRATED" in a for a in output.assumptions_made)
    assert any("R5 INTEGRATED" in a for a in output.assumptions_made)


def test_pending_karthik_is_populated(p_int_8_mapper_input: MapperInput) -> None:
    output = map_walls_to_panels(p_int_8_mapper_input)
    assert len(output.pending_karthik) >= 5
    assert any("Skin-vs-rib" in p for p in output.pending_karthik)


def test_downstream_ready_all_true_for_clean_p_int_8(
    p_int_8_mapper_input: MapperInput,
) -> None:
    output = map_walls_to_panels(p_int_8_mapper_input)
    assert output.downstream_ready["boq"] is True
    assert output.downstream_ready["formwork"] is True
    assert output.downstream_ready["shop_drawings"] is True


def test_custom_quote_requests_empty_for_standard_walls(
    p_int_8_mapper_input: MapperInput,
) -> None:
    output = map_walls_to_panels(p_int_8_mapper_input)
    assert output.custom_quote_requests == ()


def test_project_context_fields_propagated(p_int_8_mapper_input: MapperInput) -> None:
    output = map_walls_to_panels(p_int_8_mapper_input)
    assert output.project_name == "VAMSHI RESIDENCE"
    assert output.seismic_zone == "III"
    assert output.split_strategy_used == "minimize_cuts"
    assert output.wall_height_mm == 3000


def test_total_counts_grand_total_equals_sum_of_panel_counts(
    p_int_8_mapper_input: MapperInput,
) -> None:
    output = map_walls_to_panels(p_int_8_mapper_input)
    assert output.total_counts.grand_total == 9
    assert sum(output.total_counts.by_sku.values()) == 9
    assert sum(output.total_counts.by_type.values()) == 9


def test_by_segment_count_matches_panel_count(p_int_8_mapper_input: MapperInput) -> None:
    output = map_walls_to_panels(p_int_8_mapper_input)
    assert len(output.total_counts.by_segment) == 1
    assert output.total_counts.by_segment[0].panel_count == 9


# ──────────────────────────────────────────────────────────────────────────────
# Input validation errors (IV-1..IV-5)
# ──────────────────────────────────────────────────────────────────────────────


def test_iv1_non_floor_plan_raises_mapper_input_error(
    p_int_8_mapper_input: MapperInput,
) -> None:
    bad_parser = dataclasses.replace(
        p_int_8_mapper_input.parser_output, drawing_classification="SECTION",
    )
    bad_input = dataclasses.replace(p_int_8_mapper_input, parser_output=bad_parser)
    with pytest.raises(MapperInputError, match="IV-1"):
        map_walls_to_panels(bad_input)


def test_iv2_boq_not_ready_raises(p_int_8_mapper_input: MapperInput) -> None:
    bad_parser = dataclasses.replace(
        p_int_8_mapper_input.parser_output,
        downstream_ready={"boq": False, "formwork": True, "shop_drawings": True},
    )
    bad_input = dataclasses.replace(p_int_8_mapper_input, parser_output=bad_parser)
    with pytest.raises(MapperInputError, match="IV-2"):
        map_walls_to_panels(bad_input)


def test_iv3_empty_walls_raises(p_int_8_mapper_input: MapperInput) -> None:
    bad_parser = dataclasses.replace(p_int_8_mapper_input.parser_output, walls=())
    bad_input = dataclasses.replace(p_int_8_mapper_input, parser_output=bad_parser)
    with pytest.raises(MapperInputError, match="IV-3"):
        map_walls_to_panels(bad_input)


def test_iv4_low_confidence_warning_not_raised(p_int_8_mapper_input: MapperInput) -> None:
    """IV-4 is a soft warning, not a raise. Output still produced."""
    bad_parser = dataclasses.replace(
        p_int_8_mapper_input.parser_output,
        drawing_classification_confidence=0.3,
    )
    bad_input = dataclasses.replace(p_int_8_mapper_input, parser_output=bad_parser)
    output = map_walls_to_panels(bad_input)   # must NOT raise
    assert any("IV-4" in w for w in output.warnings)


def test_iv5_empty_project_name_raises(p_int_8_mapper_input: MapperInput) -> None:
    bad_pc = dataclasses.replace(p_int_8_mapper_input.project_context, project_name="")
    bad_input = dataclasses.replace(p_int_8_mapper_input, project_context=bad_pc)
    with pytest.raises(MapperInputError, match="IV-5"):
        map_walls_to_panels(bad_input)


def test_iv5_whitespace_only_project_name_raises(
    p_int_8_mapper_input: MapperInput,
) -> None:
    bad_pc = dataclasses.replace(p_int_8_mapper_input.project_context, project_name="   ")
    bad_input = dataclasses.replace(p_int_8_mapper_input, project_context=bad_pc)
    with pytest.raises(MapperInputError, match="IV-5"):
        map_walls_to_panels(bad_input)


def test_invalid_seismic_zone_raises(p_int_8_mapper_input: MapperInput) -> None:
    bad_pc = dataclasses.replace(
        p_int_8_mapper_input.project_context, seismic_zone="VI",   # type: ignore[arg-type]
    )
    bad_input = dataclasses.replace(p_int_8_mapper_input, project_context=bad_pc)
    with pytest.raises(MapperInputError, match="seismic_zone"):
        map_walls_to_panels(bad_input)


# ──────────────────────────────────────────────────────────────────────────────
# Determinism — same input → byte-equal panels across repeated calls
# ──────────────────────────────────────────────────────────────────────────────


def test_determinism_panel_content_byte_equal_across_calls(
    p_int_8_mapper_input: MapperInput,
) -> None:
    """generated_at differs across calls (it's a live clock read), but every
    other field must be byte-equal."""
    a = map_walls_to_panels(p_int_8_mapper_input)
    b = map_walls_to_panels(p_int_8_mapper_input)
    # Compare panels directly
    assert a.wall_segments[0].panels == b.wall_segments[0].panels
    # Compare project-level numeric fields
    assert a.total_cost_inr == b.total_cost_inr
    assert a.total_weight_kg == b.total_weight_kg
    assert a.total_waste_kg == b.total_waste_kg


# ──────────────────────────────────────────────────────────────────────────────
# Determinism enforcement at the codebase level
# ──────────────────────────────────────────────────────────────────────────────


def test_datetime_now_only_used_in_mapper_orchestrator() -> None:
    """DESIGN policy: only `mapper.py` is allowed to call `datetime.now()`.

    Uses `ast` to find ACTUAL function calls (not regex on strings), so
    docstring references like "no datetime.now()" are correctly ignored.
    """
    import ast
    import pathlib

    package_dir = pathlib.Path(
        __file__
    ).parent.parent.parent / "app" / "services" / "kos_panel_grid_mapper"

    def _has_datetime_now_call(tree: ast.AST) -> bool:
        """True iff the AST contains a call to `datetime.now(...)`
        (or `datetime.datetime.now(...)` if module-imported)."""
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and node.attr == "now":
                # Walk down the attribute chain looking for "datetime" root.
                value = node.value
                while isinstance(value, ast.Attribute):
                    value = value.value
                if isinstance(value, ast.Name) and value.id == "datetime":
                    return True
        return False

    offenders: list[str] = []
    for py_file in package_dir.rglob("*.py"):
        if py_file.name == "mapper.py":
            continue
        tree = ast.parse(py_file.read_text())
        if _has_datetime_now_call(tree):
            offenders.append(str(py_file.relative_to(package_dir)))

    assert not offenders, f"datetime.now() found outside mapper.py: {offenders}"
