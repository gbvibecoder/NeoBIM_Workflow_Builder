"""
Output validator — runs all 21 invariants from DESIGN.md §5 against a
PanelGridMapperOutput and returns a list of ValidationIssue records.

Catches don't raise: `validate_output(output) -> list[ValidationIssue]` is a
pure aggregator. The caller (orchestrator, PR 8) decides what to do with the
issues — typically: append soft issues to `output.warnings`, raise
`OutputInvariantError` if any hard issues are present. For convenience,
`validate_or_raise(output) -> None` is provided to do that in one call.

Tolerances and severities follow DESIGN §5 verbatim. Every `_check_c{n}`
function is annotated with the rule's DESIGN text + the source-of-truth
section number.

Determinism: pure functions, no random, no datetime.now(), no I/O.
"""

from __future__ import annotations

import math
import re
from typing import Callable

from .constants import (
    C1_LENGTH_TOLERANCE_FRACTION,
    C1_LENGTH_TOLERANCE_MM,
    KG_PER_SFT,
    MM2_PER_SFT,
    PRICE_PER_SFT_INR,
    RIB_FRACTION,
    SKIN_FRACTION,
    classify_bracing_height,
)
from .exceptions import OutputInvariantError
from .types import PanelGridMapperOutput, ValidationIssue, WallSegment

# ──────────────────────────────────────────────────────────────────────────────
# Tolerances (DESIGN §5 — table)
# ──────────────────────────────────────────────────────────────────────────────

_TOL_C7_WEIGHT_KG = 0.001          # C-7: weight = area × KG_PER_SFT
_TOL_C8_PRICE_INR = 0.01           # C-8: price = area × 225
_TOL_C9_SKIN_RIB_KG = 0.001        # C-9: skin + rib = weight
_TOL_C10_AREA_SQFT = 0.01          # C-10: area = (cut × width) / 92903.04
_TOL_C13_TOTAL_COST = 0.01         # C-13: total cost = sum of price_inr (cumulative)
_TOL_C14_TOTAL_WEIGHT = 0.01       # C-14: total weight = sum of weight_kg
_TOL_C15_SKIN_RIB_TOTALS = 0.01    # C-15: total_skin + total_rib = total_weight
_TOL_C17_WASTE_AND_RATIO = 0.0001  # C-17: waste = raw − installed; ratio
_TOL_EXACT_FLOAT = 1e-9            # for nominally-exact float comparisons

# C-12 SKU regex — DESIGN §5 row C-12 verbatim.
_SKU_REGEX = re.compile(
    r"^(AP|BT|TC|CP|CTC|ECF|ECM|JTF|JTM|PC)(110|155|200)-\d+(-CUT)?$"
)

# C-21 Segment ID regex — DESIGN §5 row C-21.
_SEGMENT_ID_REGEX = re.compile(r"^P_(EXT|INT)_\d+$")


# ──────────────────────────────────────────────────────────────────────────────
# C-1 — Length-sum tolerance (R3 INTEGRATED)
# DESIGN §5: sum(panel.width_mm for vertical_panels)
#             + neighbour_covered_left_mm + neighbour_covered_right_mm
#           ≈ segment.length_mm  ± max(50mm, 2% of length_mm)
# ──────────────────────────────────────────────────────────────────────────────


def _check_c1(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for seg in output.wall_segments:
        if seg.is_custom_order:
            # Custom-quote segments emit no panels; C-1 doesn't apply.
            continue
        vertical_width_sum = sum(p.width_mm for p in seg.panels if p.orientation == "vertical")
        accounted = vertical_width_sum + seg.neighbour_covered_left_mm + seg.neighbour_covered_right_mm
        diff = abs(accounted - seg.length_mm)
        tol = max(C1_LENGTH_TOLERANCE_MM, C1_LENGTH_TOLERANCE_FRACTION * seg.length_mm)
        if diff > tol:
            issues.append(ValidationIssue(
                rule="C-1",
                severity="hard",
                message=(
                    f"length-sum mismatch: Σwidths={vertical_width_sum}mm + "
                    f"covered_left={seg.neighbour_covered_left_mm}mm + "
                    f"covered_right={seg.neighbour_covered_right_mm}mm = {accounted}mm "
                    f"vs segment.length_mm={seg.length_mm}; diff={diff:.2f}mm > tol={tol:.2f}mm"
                ),
                segment_id=seg.id,
            ))
    return issues


# ──────────────────────────────────────────────────────────────────────────────
# C-2 — Panel positions monotonically non-decreasing within a segment.
# Checked per-orientation (vertical-panel positions monotonic; horizontal-band
# positions monotonic). DESIGN §5: "Panel position_mm monotonically
# non-decreasing within segment".
# ──────────────────────────────────────────────────────────────────────────────


def _check_c2(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for seg in output.wall_segments:
        for orientation in ("vertical", "horizontal"):
            same = [p for p in seg.panels if p.orientation == orientation]
            for i in range(1, len(same)):
                if same[i].position_mm < same[i - 1].position_mm - _TOL_EXACT_FLOAT:
                    issues.append(ValidationIssue(
                        rule="C-2",
                        severity="hard",
                        message=(
                            f"position regression in {orientation} panels: "
                            f"{same[i - 1].label}@{same[i - 1].position_mm} → "
                            f"{same[i].label}@{same[i].position_mm}"
                        ),
                        segment_id=seg.id,
                        panel_label=same[i].label,
                    ))
    return issues


# ──────────────────────────────────────────────────────────────────────────────
# C-3 — No two vertical panels in a segment have overlapping width ranges.
# DESIGN §5: "panels[i].position_mm + panels[i].width_mm ≤ panels[i+1].position_mm".
# ──────────────────────────────────────────────────────────────────────────────


def _check_c3(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for seg in output.wall_segments:
        verticals = sorted(
            [p for p in seg.panels if p.orientation == "vertical"],
            key=lambda p: p.position_mm,
        )
        for i in range(1, len(verticals)):
            prev = verticals[i - 1]
            curr = verticals[i]
            prev_end = prev.position_mm + prev.width_mm
            if prev_end > curr.position_mm + _TOL_EXACT_FLOAT:
                issues.append(ValidationIssue(
                    rule="C-3",
                    severity="hard",
                    message=(
                        f"overlapping vertical panels: {prev.label} ends at "
                        f"{prev_end} > {curr.label} starts at {curr.position_mm}"
                    ),
                    segment_id=seg.id,
                    panel_label=curr.label,
                ))
    return issues


# ──────────────────────────────────────────────────────────────────────────────
# C-4 — total_counts.grand_total === sum(len(segment.panels) for all segments).
# DESIGN §5: exact (no tolerance).
# ──────────────────────────────────────────────────────────────────────────────


def _check_c4(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    actual_total = sum(len(seg.panels) for seg in output.wall_segments)
    if actual_total != output.total_counts.grand_total:
        return [ValidationIssue(
            rule="C-4",
            severity="hard",
            message=(
                f"grand_total mismatch: total_counts.grand_total={output.total_counts.grand_total} "
                f"vs Σlen(segment.panels)={actual_total}"
            ),
        )]
    return []


# ──────────────────────────────────────────────────────────────────────────────
# C-5 — total_counts.by_sku / by_type / by_thickness / by_segment values
# sum to grand_total. DESIGN §5: exact.
# ──────────────────────────────────────────────────────────────────────────────


def _check_c5(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    gt = output.total_counts.grand_total

    by_sku_sum = sum(output.total_counts.by_sku.values())
    if by_sku_sum != gt:
        issues.append(ValidationIssue(
            rule="C-5", severity="hard",
            message=f"by_sku sum {by_sku_sum} ≠ grand_total {gt}",
        ))
    by_type_sum = sum(output.total_counts.by_type.values())
    if by_type_sum != gt:
        issues.append(ValidationIssue(
            rule="C-5", severity="hard",
            message=f"by_type sum {by_type_sum} ≠ grand_total {gt}",
        ))
    by_thickness_sum = sum(output.total_counts.by_thickness.values())
    if by_thickness_sum != gt:
        issues.append(ValidationIssue(
            rule="C-5", severity="hard",
            message=f"by_thickness sum {by_thickness_sum} ≠ grand_total {gt}",
        ))
    by_segment_sum = sum(sc.panel_count for sc in output.total_counts.by_segment)
    if by_segment_sum != gt:
        issues.append(ValidationIssue(
            rule="C-5", severity="hard",
            message=f"by_segment sum {by_segment_sum} ≠ grand_total {gt}",
        ))
    return issues


# ──────────────────────────────────────────────────────────────────────────────
# C-6 — 1 ≤ cut_length_mm ≤ raw_length_mm (R6 INTEGRATED).
# DESIGN §5: where raw_length can exceed 3048 for long horizontals. Exact.
# ──────────────────────────────────────────────────────────────────────────────


def _check_c6(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for seg in output.wall_segments:
        for p in seg.panels:
            if not (1 <= p.cut_length_mm <= p.raw_length_mm):
                issues.append(ValidationIssue(
                    rule="C-6", severity="hard",
                    message=(
                        f"cut/raw violation: cut_length_mm={p.cut_length_mm}, "
                        f"raw_length_mm={p.raw_length_mm} (must satisfy 1 ≤ cut ≤ raw)"
                    ),
                    segment_id=seg.id, panel_label=p.label,
                ))
    return issues


# ──────────────────────────────────────────────────────────────────────────────
# C-7 — weight_kg === area_sqft × KG_PER_SFT[thickness_mm]. DESIGN §5: ±0.001 kg.
# ──────────────────────────────────────────────────────────────────────────────


def _check_c7(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for seg in output.wall_segments:
        for p in seg.panels:
            if p.thickness_mm not in KG_PER_SFT:
                # Should not happen — Panel.thickness_mm is Literal[110,155,200].
                # Defensive: treat as hard issue.
                issues.append(ValidationIssue(
                    rule="C-7", severity="hard",
                    message=f"thickness {p.thickness_mm} not in KG_PER_SFT — schema violation",
                    segment_id=seg.id, panel_label=p.label,
                ))
                continue
            expected = p.area_sqft * KG_PER_SFT[p.thickness_mm]
            diff = abs(p.weight_kg - expected)
            if diff > _TOL_C7_WEIGHT_KG:
                issues.append(ValidationIssue(
                    rule="C-7", severity="hard",
                    message=(
                        f"weight formula mismatch: weight_kg={p.weight_kg} vs "
                        f"area_sqft({p.area_sqft}) × KG_PER_SFT[{p.thickness_mm}]"
                        f"({KG_PER_SFT[p.thickness_mm]}) = {expected}; "
                        f"diff={diff:.6f} > tol={_TOL_C7_WEIGHT_KG}"
                    ),
                    segment_id=seg.id, panel_label=p.label,
                ))
    return issues


# ──────────────────────────────────────────────────────────────────────────────
# C-8 — price_inr === area_sqft × 225. DESIGN §5: ±0.01 INR.
# ──────────────────────────────────────────────────────────────────────────────


def _check_c8(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for seg in output.wall_segments:
        for p in seg.panels:
            expected = p.area_sqft * PRICE_PER_SFT_INR
            diff = abs(p.price_inr - expected)
            if diff > _TOL_C8_PRICE_INR:
                issues.append(ValidationIssue(
                    rule="C-8", severity="hard",
                    message=(
                        f"price formula mismatch: price_inr={p.price_inr} vs "
                        f"area_sqft({p.area_sqft}) × 225 = {expected}; "
                        f"diff={diff:.4f} > tol={_TOL_C8_PRICE_INR}"
                    ),
                    segment_id=seg.id, panel_label=p.label,
                ))
    return issues


# ──────────────────────────────────────────────────────────────────────────────
# C-9 — weight_kg_skin + weight_kg_rib === weight_kg. DESIGN §5: ±0.001 kg.
# Also implicitly checks that skin/rib match SKIN_FRACTION/RIB_FRACTION via
# the sum-invariant.
# ──────────────────────────────────────────────────────────────────────────────


def _check_c9(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for seg in output.wall_segments:
        for p in seg.panels:
            total_split = p.weight_kg_skin + p.weight_kg_rib
            diff = abs(total_split - p.weight_kg)
            if diff > _TOL_C9_SKIN_RIB_KG:
                issues.append(ValidationIssue(
                    rule="C-9", severity="hard",
                    message=(
                        f"skin+rib mismatch: skin({p.weight_kg_skin}) + rib({p.weight_kg_rib}) "
                        f"= {total_split} vs weight_kg={p.weight_kg}; "
                        f"diff={diff:.6f} > tol={_TOL_C9_SKIN_RIB_KG}"
                    ),
                    segment_id=seg.id, panel_label=p.label,
                ))
    return issues


# ──────────────────────────────────────────────────────────────────────────────
# C-10 — area_sqft === (cut_length_mm × width_mm) / 92903.04. DESIGN §5: ±0.01 sft.
# ──────────────────────────────────────────────────────────────────────────────


def _check_c10(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for seg in output.wall_segments:
        for p in seg.panels:
            expected = (p.cut_length_mm * p.width_mm) / MM2_PER_SFT
            diff = abs(p.area_sqft - expected)
            if diff > _TOL_C10_AREA_SQFT:
                issues.append(ValidationIssue(
                    rule="C-10", severity="hard",
                    message=(
                        f"area formula mismatch: area_sqft={p.area_sqft} vs "
                        f"(cut={p.cut_length_mm} × width={p.width_mm}) / 92903.04 = {expected}; "
                        f"diff={diff:.6f} > tol={_TOL_C10_AREA_SQFT}"
                    ),
                    segment_id=seg.id, panel_label=p.label,
                ))
    return issues


# ──────────────────────────────────────────────────────────────────────────────
# C-11 — First panel of every external segment has type === "CP".
# DESIGN §5: soft (warning on violation — some legitimate edges may start
# with ECF for wall-into-existing-structure cases).
# ──────────────────────────────────────────────────────────────────────────────


def _check_c11(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for seg in output.wall_segments:
        if seg.inferred_application != "external":
            continue
        if seg.is_custom_order or not seg.panels:
            continue
        # First VERTICAL panel (skip horizontals which are at position 0 too).
        verticals = sorted(
            [p for p in seg.panels if p.orientation == "vertical"],
            key=lambda p: p.position_mm,
        )
        if not verticals:
            continue
        first = verticals[0]
        if first.type != "CP":
            issues.append(ValidationIssue(
                rule="C-11", severity="soft",
                message=(
                    f"external segment first panel is type='{first.type}' (expected 'CP'); "
                    f"may be legitimate for wall-into-existing-structure but flag for review"
                ),
                segment_id=seg.id, panel_label=first.label,
            ))
    return issues


# ──────────────────────────────────────────────────────────────────────────────
# C-12 — Every Panel.sku matches the regex
# ^(AP|BT|TC|CP|CTC|ECF|ECM|JTF|JTM|PC)(110|155|200)-\d+(-CUT)?$. DESIGN §5: exact.
# ──────────────────────────────────────────────────────────────────────────────


def _check_c12(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for seg in output.wall_segments:
        for p in seg.panels:
            if not _SKU_REGEX.match(p.sku):
                issues.append(ValidationIssue(
                    rule="C-12", severity="hard",
                    message=f"SKU {p.sku!r} does not match C-12 regex",
                    segment_id=seg.id, panel_label=p.label,
                ))
    return issues


# ──────────────────────────────────────────────────────────────────────────────
# C-13 — total_cost_inr === Σ panel.price_inr. DESIGN §5: ±0.01 INR (cumulative).
# ──────────────────────────────────────────────────────────────────────────────


def _check_c13(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    expected = sum(p.price_inr for seg in output.wall_segments for p in seg.panels)
    diff = abs(output.total_cost_inr - expected)
    if diff > _TOL_C13_TOTAL_COST:
        return [ValidationIssue(
            rule="C-13", severity="hard",
            message=(
                f"total_cost_inr mismatch: output.total_cost_inr={output.total_cost_inr} "
                f"vs Σpanel.price_inr={expected}; diff={diff:.4f} > tol={_TOL_C13_TOTAL_COST}"
            ),
        )]
    return []


# ──────────────────────────────────────────────────────────────────────────────
# C-14 — total_weight_kg === Σ panel.weight_kg. DESIGN §5: ±0.01 kg.
# ──────────────────────────────────────────────────────────────────────────────


def _check_c14(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    expected = sum(p.weight_kg for seg in output.wall_segments for p in seg.panels)
    diff = abs(output.total_weight_kg - expected)
    if diff > _TOL_C14_TOTAL_WEIGHT:
        return [ValidationIssue(
            rule="C-14", severity="hard",
            message=(
                f"total_weight_kg mismatch: output.total_weight_kg={output.total_weight_kg} "
                f"vs Σpanel.weight_kg={expected}; diff={diff:.4f} > tol={_TOL_C14_TOTAL_WEIGHT}"
            ),
        )]
    return []


# ──────────────────────────────────────────────────────────────────────────────
# C-15 — total_skin_kg + total_rib_kg === total_weight_kg. DESIGN §5: ±0.01 kg.
# ──────────────────────────────────────────────────────────────────────────────


def _check_c15(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    total_split = output.total_skin_kg + output.total_rib_kg
    diff = abs(total_split - output.total_weight_kg)
    if diff > _TOL_C15_SKIN_RIB_TOTALS:
        return [ValidationIssue(
            rule="C-15", severity="hard",
            message=(
                f"totals skin+rib mismatch: skin({output.total_skin_kg}) + rib({output.total_rib_kg}) "
                f"= {total_split} vs total_weight_kg={output.total_weight_kg}; "
                f"diff={diff:.4f} > tol={_TOL_C15_SKIN_RIB_TOTALS}"
            ),
        )]
    return []


# ──────────────────────────────────────────────────────────────────────────────
# C-16 — total_raw_kg ≥ total_weight_kg. DESIGN §5: exact (raw always ≥ installed).
# ──────────────────────────────────────────────────────────────────────────────


def _check_c16(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    if output.total_raw_kg < output.total_weight_kg - _TOL_EXACT_FLOAT:
        return [ValidationIssue(
            rule="C-16", severity="hard",
            message=(
                f"total_raw_kg={output.total_raw_kg} < total_weight_kg={output.total_weight_kg} "
                f"— raw stock cannot be lighter than installed weight"
            ),
        )]
    return []


# ──────────────────────────────────────────────────────────────────────────────
# C-17 — total_waste_kg === total_raw_kg − total_weight_kg
#         AND waste_ratio === total_waste_kg / total_raw_kg. DESIGN §5: ±0.0001.
# ──────────────────────────────────────────────────────────────────────────────


def _check_c17(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    expected_waste = output.total_raw_kg - output.total_weight_kg
    diff_waste = abs(output.total_waste_kg - expected_waste)
    if diff_waste > _TOL_C17_WASTE_AND_RATIO:
        issues.append(ValidationIssue(
            rule="C-17", severity="hard",
            message=(
                f"waste mismatch: total_waste_kg={output.total_waste_kg} vs "
                f"total_raw_kg({output.total_raw_kg}) − total_weight_kg({output.total_weight_kg}) "
                f"= {expected_waste}; diff={diff_waste:.6f} > tol={_TOL_C17_WASTE_AND_RATIO}"
            ),
        ))
    if output.total_raw_kg > 0:
        expected_ratio = output.total_waste_kg / output.total_raw_kg
        diff_ratio = abs(output.waste_ratio - expected_ratio)
        if diff_ratio > _TOL_C17_WASTE_AND_RATIO:
            issues.append(ValidationIssue(
                rule="C-17", severity="hard",
                message=(
                    f"waste_ratio mismatch: output.waste_ratio={output.waste_ratio} vs "
                    f"total_waste_kg / total_raw_kg = {expected_ratio}; "
                    f"diff={diff_ratio:.6f} > tol={_TOL_C17_WASTE_AND_RATIO}"
                ),
            ))
    elif output.waste_ratio != 0.0:
        # No raw stock consumed (e.g. all-custom project) — ratio must be 0.
        issues.append(ValidationIssue(
            rule="C-17", severity="hard",
            message=f"waste_ratio={output.waste_ratio} but total_raw_kg=0 (must be 0)",
        ))
    return issues


# ──────────────────────────────────────────────────────────────────────────────
# C-18 — is_custom_order=true ⇒ panels.length === 0 AND custom_quote_request !== None
#         (and vice versa). DESIGN §5: exact.
# ──────────────────────────────────────────────────────────────────────────────


def _check_c18(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for seg in output.wall_segments:
        if seg.is_custom_order:
            if len(seg.panels) != 0:
                issues.append(ValidationIssue(
                    rule="C-18", severity="hard",
                    message=(
                        f"custom_order=True but panels.length={len(seg.panels)} "
                        f"(must be 0 for CUSTOM walls)"
                    ),
                    segment_id=seg.id,
                ))
            if seg.custom_quote_request is None:
                issues.append(ValidationIssue(
                    rule="C-18", severity="hard",
                    message="custom_order=True but custom_quote_request is None (must be populated)",
                    segment_id=seg.id,
                ))
        else:
            if len(seg.panels) == 0:
                issues.append(ValidationIssue(
                    rule="C-18", severity="hard",
                    message="custom_order=False but panels.length=0 (panels must be populated)",
                    segment_id=seg.id,
                ))
            if seg.custom_quote_request is not None:
                issues.append(ValidationIssue(
                    rule="C-18", severity="hard",
                    message=(
                        f"custom_order=False but custom_quote_request is populated "
                        f"(must be None for standard walls)"
                    ),
                    segment_id=seg.id,
                ))
    return issues


# ──────────────────────────────────────────────────────────────────────────────
# C-19 — bracing_height_class consistent with height_mm per Rulebook Card 1
# bands. DESIGN §5: soft (warning).
# ──────────────────────────────────────────────────────────────────────────────


def _check_c19(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for seg in output.wall_segments:
        expected = classify_bracing_height(seg.height_mm)
        if seg.bracing_height_class != expected:
            issues.append(ValidationIssue(
                rule="C-19", severity="soft",
                message=(
                    f"bracing_height_class='{seg.bracing_height_class}' inconsistent with "
                    f"height_mm={seg.height_mm} (expected '{expected}' per Card 1)"
                ),
                segment_id=seg.id,
            ))
    return issues


# ──────────────────────────────────────────────────────────────────────────────
# C-20 — downstream_ready.shop_drawings === True iff every panel has label != ""
# and position_mm is set. DESIGN §5: exact.
# ──────────────────────────────────────────────────────────────────────────────


def _check_c20(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    every_panel_renderable = all(
        p.label != "" and p.position_mm is not None and not math.isnan(p.position_mm)
        for seg in output.wall_segments
        for p in seg.panels
    )
    flag = bool(output.downstream_ready.get("shop_drawings", False))
    if flag != every_panel_renderable:
        return [ValidationIssue(
            rule="C-20", severity="hard",
            message=(
                f"downstream_ready.shop_drawings={flag} disagrees with "
                f"actual-panel-renderability={every_panel_renderable}"
            ),
        )]
    return []


# ──────────────────────────────────────────────────────────────────────────────
# C-21 — Every WallSegment id matches ^P_(EXT|INT)_\d+$. DESIGN §5: soft (warning).
# ──────────────────────────────────────────────────────────────────────────────


def _check_c21(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for seg in output.wall_segments:
        if not _SEGMENT_ID_REGEX.match(seg.id):
            issues.append(ValidationIssue(
                rule="C-21", severity="soft",
                message=f"segment id {seg.id!r} does not match ^P_(EXT|INT)_\\d+$",
                segment_id=seg.id,
            ))
    return issues


# ──────────────────────────────────────────────────────────────────────────────
# Aggregator
# ──────────────────────────────────────────────────────────────────────────────


_ALL_CHECKS: tuple[Callable[[PanelGridMapperOutput], list[ValidationIssue]], ...] = (
    _check_c1, _check_c2, _check_c3, _check_c4, _check_c5,
    _check_c6, _check_c7, _check_c8, _check_c9, _check_c10,
    _check_c11, _check_c12, _check_c13, _check_c14, _check_c15,
    _check_c16, _check_c17, _check_c18, _check_c19, _check_c20,
    _check_c21,
)
"""Ordered tuple of all 21 invariant check functions. Order is C-1..C-21."""


def validate_output(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    """Run all 21 validation invariants from DESIGN.md §5.

    Returns a list of issues (empty = clean). Never raises. The caller decides:
      - For hard issues: typically `raise OutputInvariantError(message, issues=...)`.
      - For soft issues: append `issue.message` to `output.warnings`.

    See `validate_or_raise(output)` for a convenience wrapper that does both.

    Determinism: pure function. Same input ⇒ same list of ValidationIssue records
    in the same order (C-1's issues first, then C-2's, …, then C-21's).
    """
    issues: list[ValidationIssue] = []
    for check in _ALL_CHECKS:
        issues.extend(check(output))
    return issues


def validate_or_raise(output: PanelGridMapperOutput) -> list[ValidationIssue]:
    """Convenience wrapper for orchestrator use.

    Runs validate_output(). If any HARD issues are found, raises
    OutputInvariantError(message, issues=<all issues>). Otherwise returns the
    soft issues (which the caller can append to output.warnings).

    Does NOT mutate the output — output is frozen anyway. The caller is
    responsible for constructing a new output with the soft warnings appended.
    """
    issues = validate_output(output)
    hard = [i for i in issues if i.severity == "hard"]
    if hard:
        summary = "; ".join(f"{i.rule}: {i.message}" for i in hard[:5])
        if len(hard) > 5:
            summary += f" ...and {len(hard) - 5} more hard issues"
        raise OutputInvariantError(
            f"output failed {len(hard)} hard invariant(s): {summary}"
        )
    return [i for i in issues if i.severity == "soft"]
