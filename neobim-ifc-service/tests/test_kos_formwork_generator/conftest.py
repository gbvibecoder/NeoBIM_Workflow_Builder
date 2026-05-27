"""Test fixtures for KOS Formwork Quantities Generator (PR 1+).

The ``p_int_8_mapper_output`` fixture reconstructs the canonical P_INT_8
``PanelGridMapperOutput`` IDENTICALLY to BOQ conftest, so that
``compute_mapper_output_hash(p_int_8_mapper_output)`` yields the same SHA-256
as BOQ's golden file:

    2aba9af930cd77d2467fe4b14576f80522cf4f13c9e69623145b85e39b725588

This guarantees the 5F vs BOQ byte-equal contract on mapper_output_hash.

Reference: tests/test_kos_boq_generator/conftest.py (BOQ PR 1 reconstruction).
"""
from __future__ import annotations

import dataclasses
import json
import logging
from pathlib import Path

import pytest

from app.services.kos_formwork_generator.types import FormworkContext

logger = logging.getLogger(__name__)


# ═════════════════════════════════════════════════════════════════════
# P_INT_8 — single wall, K4-110, 3.0m height, 9 panels
# Reconstruction MIRRORS BOQ conftest.py p_int_8_mapper_output exactly.
# ═════════════════════════════════════════════════════════════════════


@pytest.fixture(scope="session")
def p_int_8_mapper_output():
    """Reconstruct the canonical P_INT_8 ``PanelGridMapperOutput``.

    Reads ``tests/test_kos_panel_grid_mapper/golden/p_int_8_canonical.json``
    (a serialized single ``WallSegment``) and wraps it in a full
    ``PanelGridMapperOutput`` matching BOQ conftest's reconstruction exactly.

    Byte-equality contract: ``compute_mapper_output_hash(result)`` must equal
    ``2aba9af930cd77d2467fe4b14576f80522cf4f13c9e69623145b85e39b725588``.

    Session-scoped because reconstruction is deterministic and idempotent.
    """
    from app.services.kos_panel_grid_mapper import (
        MAPPER_SCHEMA_VERSION,
        Opening,
        Panel,
        PanelGridMapperOutput,
        ReinforcementSpec,
        SegmentCount,
        TotalCounts,
        WallSegment,
    )

    mapper_golden_path = (
        Path(__file__).parent.parent
        / "test_kos_panel_grid_mapper"
        / "golden"
        / "p_int_8_canonical.json"
    )
    if not mapper_golden_path.exists():
        raise FileNotFoundError(
            f"Mapper P_INT_8 golden missing at {mapper_golden_path}. "
            f"Required for mapper_output_hash byte-equal contract."
        )
    d = json.loads(mapper_golden_path.read_text())

    # Reconstruct the 9 Panel dataclasses preserving full IEEE-754 precision.
    panels = tuple(
        Panel(
            label=pd["label"],
            sku=pd["sku"],
            type=pd["type"],
            thickness_mm=pd["thickness_mm"],
            width_mm=pd["width_mm"],
            cut_length_mm=pd["cut_length_mm"],
            raw_length_mm=pd["raw_length_mm"],
            position_mm=pd["position_mm"],
            orientation=pd["orientation"],
            is_cut_member=pd["is_cut_member"],
            cut_male_mm=pd["cut_male_mm"],
            cut_female_mm=pd["cut_female_mm"],
            area_sqft=pd["area_sqft"],
            weight_kg=pd["weight_kg"],
            weight_kg_skin=pd["weight_kg_skin"],
            weight_kg_rib=pd["weight_kg_rib"],
            raw_weight_kg=pd["raw_weight_kg"],
            waste_weight_kg=pd["waste_weight_kg"],
            price_inr=pd["price_inr"],
        )
        for pd in d["panels"]
    )

    rd = d["reinforcement_spec"]
    seg = WallSegment(
        id=d["id"],
        system=d["system"],
        custom_thickness_mm=d.get("custom_thickness_mm"),
        inferred_application=d["inferred_application"],
        application_confidence=d["application_confidence"],
        application_source=d["application_source"],
        length_mm=d["length_mm"],
        height_mm=d["height_mm"],
        area_sqft=d["area_sqft"],
        lifts_required=d["lifts_required"],
        neighbour_covered_left_mm=d["neighbour_covered_left_mm"],
        neighbour_covered_right_mm=d["neighbour_covered_right_mm"],
        panels=panels,
        openings=tuple(Opening(**o) for o in d.get("openings", ())),
        openings_inferable=d["openings_inferable"],
        bracing_height_class=d["bracing_height_class"],
        reinforcement_spec=ReinforcementSpec(
            vertical_bars=rd["vertical_bars"],
            horizontal_bars=rd["horizontal_bars"],
            concrete_grade=rd["concrete_grade"],
            cover_external_mm=rd["cover_external_mm"],
            cover_internal_mm=rd["cover_internal_mm"],
            source_section=rd["source_section"],
        ),
        segment_cost_inr=d["segment_cost_inr"],
        segment_weight_kg=d["segment_weight_kg"],
        segment_skin_kg=d["segment_skin_kg"],
        segment_rib_kg=d["segment_rib_kg"],
        segment_raw_kg=d["segment_raw_kg"],
        segment_waste_kg=d["segment_waste_kg"],
        segment_panel_counts=dict(d["segment_panel_counts"]),
        warnings=tuple(d["warnings"]),
        info_notes=tuple(d.get("info_notes", ())),
        assumptions=tuple(d["assumptions"]),
        plan_polyline=tuple(tuple(p) for p in d.get("plan_polyline", ())),
        source_wall_ids=tuple(d.get("source_wall_ids", ())),
        is_custom_order=d.get("is_custom_order", False),
        custom_quote_request=None,
    )

    # Build per-type and per-thickness tallies from the panels.
    by_type: dict[str, int] = {}
    by_thickness: dict[int, int] = {}
    for p in seg.panels:
        by_type[p.type] = by_type.get(p.type, 0) + 1
        by_thickness[p.thickness_mm] = by_thickness.get(p.thickness_mm, 0) + 1

    waste_ratio = (
        seg.segment_waste_kg / seg.segment_raw_kg if seg.segment_raw_kg > 0 else 0.0
    )

    return PanelGridMapperOutput(
        project_name="VAMSHI RESIDENCE",
        seismic_zone="III",
        split_strategy_used="minimize_cuts",
        wall_height_mm=3000,
        wall_segments=(seg,),
        custom_quote_requests=(),
        total_counts=TotalCounts(
            by_sku=dict(seg.segment_panel_counts),
            by_type=by_type,
            by_thickness=by_thickness,
            grand_total=len(seg.panels),
            by_segment=(
                SegmentCount(segment_id=seg.id, panel_count=len(seg.panels)),
            ),
        ),
        total_cost_inr=seg.segment_cost_inr,
        total_weight_kg=seg.segment_weight_kg,
        total_skin_kg=seg.segment_skin_kg,
        total_rib_kg=seg.segment_rib_kg,
        total_raw_kg=seg.segment_raw_kg,
        total_waste_kg=seg.segment_waste_kg,
        warnings=(),
        assumptions_made=("POLICY-KARTHIK-WINS",),
        pending_karthik=(),
        info_notes=(),
        schema_version=MAPPER_SCHEMA_VERSION,
        generated_at="2026-05-24T00:00:00Z",
        waste_ratio=waste_ratio,
        downstream_ready={"boq": True, "formwork": True, "shop_drawings": True},
    )


# ═════════════════════════════════════════════════════════════════════
# FORMWORK CONTEXT — P_INT_8 byte-equal test (matches Pre-flight E hash)
# ═════════════════════════════════════════════════════════════════════


@pytest.fixture(scope="session")
def formwork_context_p_int_8() -> FormworkContext:
    """Canonical FormworkContext for P_INT_8 byte-equal tests.

    Field values chosen so that ``compute_context_hash(result)`` yields the
    SHA-256 hash hardcoded in the golden file (Pre-flight E):

        1ca9e2049ae72129f2958354b205f052295cfa6d3843264a7b2650228dccd727

    PR 5 orchestrator will use this fixture for the byte-equal golden test.
    """
    return FormworkContext(
        project_id="P_INT_8_TEST",
        quote_date="2026-05-25",
        seismic_zone=None,                              # → derive from mapper
        pour_rate_m_per_hr=None,                        # → FRB default for K4
        wastage_percent=5.0,
        wall_type_overrides=(),                         # → use mapper.inferred_application
        deterministic_id_seed="p_int_8_formwork_test_seed",
        generated_at_override="2026-05-25T00:00:00Z",
        notes=None,
    )


# ═════════════════════════════════════════════════════════════════════
# GOLDEN FILE FIXTURES
# ═════════════════════════════════════════════════════════════════════


@pytest.fixture(scope="session")
def p_int_8_formwork_golden_path() -> Path:
    """Path to P_INT_8 formwork golden JSON."""
    return (
        Path(__file__).parent
        / "golden"
        / "p_int_8_formwork_canonical.json"
    )


@pytest.fixture(scope="session")
def p_int_8_formwork_golden(p_int_8_formwork_golden_path: Path) -> dict:
    """Load P_INT_8 formwork golden as dict.

    Raises:
        FileNotFoundError: if golden missing.
        RuntimeError: if golden is malformed JSON.
    """
    if not p_int_8_formwork_golden_path.exists():
        raise FileNotFoundError(
            f"P_INT_8 formwork golden not found at {p_int_8_formwork_golden_path}. "
            f"CC: ensure golden file was created during PR 1."
        )
    try:
        with open(p_int_8_formwork_golden_path, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"P_INT_8 formwork golden malformed JSON: {e}"
        ) from e


# ═════════════════════════════════════════════════════════════════════
# DIAGNOSTIC FIXTURE: byte-equal contract sanity (used by PR 5 too)
# ═════════════════════════════════════════════════════════════════════


@pytest.fixture(scope="session")
def p_int_8_mapper_output_hash(p_int_8_mapper_output) -> str:
    """Compute the SHA-256 of P_INT_8 mapper output (BOQ algorithm)."""
    import hashlib

    d = dataclasses.asdict(p_int_8_mapper_output)
    canonical_json = json.dumps(
        d, sort_keys=True, separators=(",", ":"), default=str,
    )
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


# ═════════════════════════════════════════════════════════════════════
# PR 2 FIXTURES (appended; PR 1 fixtures above are unchanged)
# Reference: PR 2 prompt §3.7.
# ═════════════════════════════════════════════════════════════════════


@pytest.fixture(scope="session")
def p_int_8_wall(p_int_8_mapper_output):
    """The single WallSegment in P_INT_8 mapper output."""
    return p_int_8_mapper_output.wall_segments[0]


@pytest.fixture(scope="session")
def k4_110_scheme():
    """The bracing scheme matching P_INT_8 (K4-110, 3.0m height → 2.4-3.0m row)."""
    from app.services.kos_formwork_generator import find_bracing_scheme
    return find_bracing_scheme("K4-110", 3000)


@pytest.fixture(scope="session")
def p_int_8_components_map(p_int_8_wall, k4_110_scheme):
    """Map wall_id → (wall, scheme, base_counts) for P_INT_8.

    Returns the dict shape that build_tier6_components / build_tier5_walls expect.
    """
    from app.services.kos_formwork_generator import count_components
    counts = count_components(p_int_8_wall, k4_110_scheme)
    return {p_int_8_wall.id: (p_int_8_wall, k4_110_scheme, counts)}


@pytest.fixture
def very_short_wall(p_int_8_wall):
    """A synthetic wall shorter than prop_spacing for edge-case testing.

    Used to verify the props_per_side minimum-2 guard.
    """
    return dataclasses.replace(
        p_int_8_wall,
        id="VERY_SHORT_TEST_WALL",
        length_mm=500.0,  # 0.5m — much shorter than 2.0m prop spacing
    )


@pytest.fixture
def k4_at_3_5m_wall(p_int_8_wall):
    """Synthetic K4 wall at 3.5m height (3.0-3.6m scheme range).

    Tier-spec: prop_spacing=1.8m, waler_count=1, kicker_spacing=600mm.
    """
    return dataclasses.replace(
        p_int_8_wall,
        id="K4_3_5M_WALL",
        height_mm=3500,
        bracing_height_class="3.0_to_4.5m",
        length_mm=5000.0,
    )


@pytest.fixture
def synthetic_l_shape_walls(p_int_8_wall):
    """Two walls meeting at origin to form a 90° L-shape corner.

    Wall A: horizontal from (0,0) to (3000,0).
    Wall B: vertical from (0,0) to (0,3000).
    Both K4-110 at 2.5m height (same scheme).
    """
    wall_a = dataclasses.replace(
        p_int_8_wall,
        id="LSHAPE_WALL_A",
        length_mm=3000.0,
        plan_polyline=((0.0, 0.0), (3000.0, 0.0)),
    )
    wall_b = dataclasses.replace(
        p_int_8_wall,
        id="LSHAPE_WALL_B",
        length_mm=3000.0,
        plan_polyline=((0.0, 0.0), (0.0, 3000.0)),
    )
    return (wall_a, wall_b)


@pytest.fixture
def synthetic_135_corner_walls(p_int_8_wall):
    """Two walls meeting at origin to form a 135° interior corner.

    Wall A: horizontal (0,0) → (3000,0).  Inward vector = (1, 0).
    Wall B: (0,0) → (3000·cos135°, 3000·sin135°).  Inward vector = (cos135°, sin135°).
    Interior angle between inward vectors = 135° (acos(dot) where dot = cos135°).
    """
    import math as _math
    cos135 = _math.cos(_math.radians(135.0))
    sin135 = _math.sin(_math.radians(135.0))
    wall_a = dataclasses.replace(
        p_int_8_wall,
        id="A_135_WALL_A",
        length_mm=3000.0,
        plan_polyline=((0.0, 0.0), (3000.0, 0.0)),
    )
    wall_b = dataclasses.replace(
        p_int_8_wall,
        id="B_135_WALL_B",
        length_mm=3000.0,
        plan_polyline=((0.0, 0.0), (3000.0 * cos135, 3000.0 * sin135)),
    )
    return (wall_a, wall_b)


@pytest.fixture
def synthetic_t_junction_walls(p_int_8_wall):
    """Three walls meeting at one point to form a T-junction.

    Wall A: horizontal (0,0) → (3000,0).
    Wall B: from origin going down (0,0) → (0,-3000).
    Wall C: from origin going up (0,0) → (0,3000) — making T.
    """
    wall_a = dataclasses.replace(
        p_int_8_wall, id="T_WALL_A", length_mm=3000.0,
        plan_polyline=((0.0, 0.0), (3000.0, 0.0)),
    )
    wall_b = dataclasses.replace(
        p_int_8_wall, id="T_WALL_B", length_mm=3000.0,
        plan_polyline=((0.0, 0.0), (0.0, -3000.0)),
    )
    wall_c = dataclasses.replace(
        p_int_8_wall, id="T_WALL_C", length_mm=3000.0,
        plan_polyline=((0.0, 0.0), (0.0, 3000.0)),
    )
    return (wall_a, wall_b, wall_c)


# ═════════════════════════════════════════════════════════════════════
# PR 3 FIXTURES (appended; PR 1+2 fixtures above are unchanged)
# Build full Tier 6 / Tier 5 / Tier 4 outputs for P_INT_8 so PR 3 tests
# can verify Tier 1/2/3 + audit_trail/IDs byte-equal vs the golden file.
# Reference: PR 3 prompt §3 (fixtures), §6 (test plan).
# ═════════════════════════════════════════════════════════════════════


@pytest.fixture(scope="session")
def p_int_8_tier_6(p_int_8_components_map, p_int_8_mapper_output):
    """Tier 6 component tuple for P_INT_8.

    Returns ``(tier_6_components, base_counts_by_sku)`` as produced by
    ``build_tier6_components`` (PR 2). 5% wastage applied (matches the
    PR 1 golden context).
    """
    from app.services.kos_formwork_generator import build_tier6_components

    corners = ()  # P_INT_8 is a single straight wall; no corners.
    return build_tier6_components(
        wall_components_map=p_int_8_components_map,
        corners=corners,
        wastage_percent=5.0,
    )


@pytest.fixture(scope="session")
def p_int_8_tier_5(
    p_int_8_components_map, formwork_context_p_int_8
):
    """Tier 5 wall-segment tuple for P_INT_8."""
    from app.services.kos_formwork_generator import build_tier5_walls

    return build_tier5_walls(
        wall_components_map=p_int_8_components_map,
        corners=(),
        context=formwork_context_p_int_8,
        wastage_percent=5.0,
    )


@pytest.fixture(scope="session")
def p_int_8_tier_4(p_int_8_tier_6):
    """Tier 4 SKU-detail tuple for P_INT_8."""
    from app.services.kos_formwork_generator import build_tier4_skus

    tier_6_components, base_counts_by_sku = p_int_8_tier_6
    return build_tier4_skus(tier_6_components, base_counts_by_sku)


@pytest.fixture
def synthetic_mixed_unit_tier_4():
    """Synthetic Tier 4 with a sku_prefix that has mixed units (defensive test).

    Used by tier3_categories to verify F-T3-UNIT-CONSISTENT invariant.
    """
    from app.services.kos_formwork_generator.types import Tier4SKUDetail

    return (
        Tier4SKUDetail(
            sku_code="MIX-NOS",
            sku_prefix="MIX",
            thickness_mm=None,
            description="Mixed unit test (nos)",
            base_quantity=10,
            wastage_quantity=0,
            total_quantity=10,
            unit="nos",
        ),
        Tier4SKUDetail(
            sku_code="MIX-LIN",
            sku_prefix="MIX",
            thickness_mm=None,
            description="Mixed unit test (linear_m)",
            base_quantity=5.0,
            wastage_quantity=0.0,
            total_quantity=5.0,
            unit="linear_m",
        ),
    )


@pytest.fixture
def synthetic_invalid_component_type_tier_6(p_int_8_tier_6):
    """Synthetic Tier 6 whose first entry has an off-grid component_type.

    Used by tier2_summary to verify F-T2-UNKNOWN-COMPONENT-TYPE invariant.
    """
    tier_6_components, _ = p_int_8_tier_6
    return (
        dataclasses.replace(tier_6_components[0], component_type="alien_widget"),
    ) + tier_6_components[1:]


# ═════════════════════════════════════════════════════════════════════
# PR 4 FIXTURES (appended; PR 1-3 fixtures above are unchanged)
# Reference: PR 4 prompt §3.5 + DESIGN v2 doc 02 §17-§21.
# ═════════════════════════════════════════════════════════════════════


@pytest.fixture
def curved_wall(p_int_8_wall):
    """Synthetic wall flagged as custom-order curved (inherits inherited_curved_wall).

    Uses dataclasses.replace to set is_custom_order=True and provide a mapper
    CustomQuoteRequest with reason='curved_wall_custom_panels' which the
    inheritance map routes to ``inherited_curved_wall``.
    """
    from app.services.kos_panel_grid_mapper.types import CustomQuoteRequest
    return dataclasses.replace(
        p_int_8_wall,
        id="W_CURVED",
        is_custom_order=True,
        custom_quote_request=CustomQuoteRequest(
            wall_segment_id="W_CURVED",
            thickness_mm=0.0,
            length_mm=p_int_8_wall.length_mm,
            height_mm=p_int_8_wall.height_mm,
            reason="curved_wall_custom_panels",
        ),
    )


@pytest.fixture
def tall_k4_wall(p_int_8_wall):
    """K4-110 wall at 4000mm — exceeds 3.6m FRB max → height_exceeds_field_rule_book_max."""
    return dataclasses.replace(
        p_int_8_wall, id="W_TALL_K4", height_mm=4000,
    )


@pytest.fixture
def k4_basement_override_context():
    """Context with wall_type_overrides routing K4 wall P_INT_8 to basement → high-risk."""
    from app.services.kos_formwork_generator import FormworkContext
    return FormworkContext(
        project_id="P_INT_8_OVERRIDE",
        quote_date="2026-05-27",
        seismic_zone=None,
        pour_rate_m_per_hr=None,
        wastage_percent=5.0,
        wall_type_overrides=(("P_INT_8", "basement"),),
        deterministic_id_seed="test_override",
        generated_at_override=None,
        notes=None,
    )


@pytest.fixture
def seismic_v_context():
    """Context with seismic_zone='V' → triggers seismic_zone_v_verification."""
    from app.services.kos_formwork_generator import FormworkContext
    return FormworkContext(
        project_id="TEST_V", quote_date="2026-05-27",
        seismic_zone="V", pour_rate_m_per_hr=None,
        wastage_percent=5.0, wall_type_overrides=(),
        deterministic_id_seed="test_seismic_v",
        generated_at_override=None, notes=None,
    )


@pytest.fixture
def seismic_iv_context():
    """Context with seismic_zone='IV' → triggers seismic_zone_high (operator review)."""
    from app.services.kos_formwork_generator import FormworkContext
    return FormworkContext(
        project_id="TEST_IV", quote_date="2026-05-27",
        seismic_zone="IV", pour_rate_m_per_hr=None,
        wastage_percent=5.0, wall_type_overrides=(),
        deterministic_id_seed="test_seismic_iv",
        generated_at_override=None, notes=None,
    )


@pytest.fixture
def pour_override_context():
    """Context with explicit pour_rate_m_per_hr (triggers pour_rate_override review)."""
    from app.services.kos_formwork_generator import FormworkContext
    return FormworkContext(
        project_id="TEST_POUR", quote_date="2026-05-27",
        seismic_zone=None, pour_rate_m_per_hr=2.5,
        wastage_percent=5.0, wall_type_overrides=(),
        deterministic_id_seed="test_pour_override",
        generated_at_override=None, notes=None,
    )


@pytest.fixture
def pour_exceeds_max_context():
    """pour_rate_m_per_hr > FRB max for K4 (3.0) → custom_quote AND operator review."""
    from app.services.kos_formwork_generator import FormworkContext
    return FormworkContext(
        project_id="TEST_POUR_MAX", quote_date="2026-05-27",
        seismic_zone=None, pour_rate_m_per_hr=5.0,
        wastage_percent=5.0, wall_type_overrides=(),
        deterministic_id_seed="test_pour_max",
        generated_at_override=None, notes=None,
    )


@pytest.fixture(scope="session")
def p_int_8_full_output(p_int_8_mapper_output, formwork_context_p_int_8):
    """Build the full FormworkGeneratorOutput for P_INT_8 by running PR 1-4 pipeline.

    Mirrors the orchestrator (PR 5) wiring as a fixture so the validator tests
    can mutate dataclasses.replace() one field at a time.
    """
    from app.services.kos_formwork_generator import (
        count_corners, count_components, find_bracing_scheme,
        build_tier6_components, build_tier5_walls, build_tier4_skus,
        build_tier3_categories, build_tier2_summary, build_tier1_project,
        mint_formwork_id, compute_generated_at, build_audit_trail,
        build_custom_quote_items, build_operator_review_items,
        FORMWORK_SCHEMA_VERSION, WASTAGE_PERCENT_DEFAULT,
    )
    from app.services.kos_formwork_generator.types import FormworkGeneratorOutput

    # PR 2 pipeline
    corners = count_corners(p_int_8_mapper_output.wall_segments)
    wall = p_int_8_mapper_output.wall_segments[0]
    scheme = find_bracing_scheme(wall.system, wall.height_mm)
    counts = count_components(wall, scheme)
    wcm = {wall.id: (wall, scheme, counts)}

    tier_6, base_by_sku = build_tier6_components(wcm, corners, WASTAGE_PERCENT_DEFAULT)
    tier_5 = build_tier5_walls(wcm, corners, formwork_context_p_int_8, WASTAGE_PERCENT_DEFAULT)
    tier_4 = build_tier4_skus(tier_6, base_by_sku)

    # PR 4 handlers (return () for P_INT_8)
    custom_quote_items = build_custom_quote_items(
        p_int_8_mapper_output, formwork_context_p_int_8, corners
    )
    operator_review_items = build_operator_review_items(
        p_int_8_mapper_output, formwork_context_p_int_8
    )

    # PR 3 aggregations
    tier_3 = build_tier3_categories(tier_4)
    tier_2 = build_tier2_summary(tier_6, custom_quote_items)
    tier_1 = build_tier1_project(
        mapper_output=p_int_8_mapper_output,
        context=formwork_context_p_int_8,
        tier_5_wall_segments=tier_5,
        corners=corners,
        custom_quote_items=custom_quote_items,
        operator_review_items=operator_review_items,
    )
    audit_trail = build_audit_trail(
        p_int_8_mapper_output, formwork_context_p_int_8,
        custom_quote_items, operator_review_items,
    )
    formwork_id = mint_formwork_id(formwork_context_p_int_8)
    generated_at = compute_generated_at(formwork_context_p_int_8)

    return FormworkGeneratorOutput(
        formwork_id=formwork_id,
        generated_at=generated_at,
        schema_version=FORMWORK_SCHEMA_VERSION,
        tier_1_summary=tier_1,
        tier_2_categories=tier_2,
        tier_3_sku_types=tier_3,
        tier_4_sku_details=tier_4,
        tier_5_wall_segments=tier_5,
        tier_6_components=tier_6,
        custom_quote_items=custom_quote_items,
        operator_review_items=operator_review_items,
        audit_trail=audit_trail,
        warnings=(),
        assumptions_made=(),
        pending_karthik=(),
    )
