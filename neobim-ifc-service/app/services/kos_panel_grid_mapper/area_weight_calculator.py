"""
Numeric panel metrics — pure-function module.

Source of truth: DESIGN.md §4.4 Panel field formulas + §4.1 locked constants
(PRICE_PER_SFT_INR=225, KG_PER_SFT[110|155|200], SKIN/RIB fractions 0.60/0.40,
MM2_PER_SFT=92903.04).

Every function here is **pure**: same input ⇒ same float-bit output. No random,
no datetime, no I/O, no module-level state. All values returned at IEEE-754
double precision (full precision); rounding to 2dp is the orchestrator's job at
output construction time, NOT here.

R6 INTEGRATED: compute_raw_weight_kg accepts arbitrary raw_length_mm (not pinned
to 3048) so horizontals longer than the raw stock can track multi-piece raw
consumption via ceil(cut/3048)*3048 — see DESIGN §4.4 + §8.2 P_EXT_3 worked
example (BT155-9370 → raw_length_mm = 12192 = 4 × 3048).
"""

from __future__ import annotations

from .constants import (
    KG_PER_SFT,
    MM2_PER_SFT,
    PRICE_PER_SFT_INR,
    RIB_FRACTION,
    SKIN_FRACTION,
)


def compute_panel_area_sqft(cut_length_mm: float, width_mm: float) -> float:
    """Surface area of one panel face in square feet.

    Formula (DESIGN §4.4 + §5 validation rule C-10):
        area_sqft = (cut_length_mm × width_mm) / MM2_PER_SFT

    MM2_PER_SFT is pinned to the literal 92903.04 (not computed) — see
    constants.py docstring for the IEEE-754 reproducibility rationale.

    Used by: every Panel construction (PR 8 orchestrator) and the
    output_validator's C-10 check (PR 3).
    """
    return (cut_length_mm * width_mm) / MM2_PER_SFT


def compute_panel_weight_kg(area_sqft: float, thickness_mm: int) -> float:
    """Installed weight in kg, derived from area × per-thickness rate.

    Formula (DESIGN §4.4 + §5 validation rule C-7):
        weight_kg = area_sqft × KG_PER_SFT[thickness_mm]

    Karthik confirmed rates (constants.py):
        110mm → 1.29 kg/sft   (2026-05-23 17:37)
        155mm → 1.46 kg/sft   (2026-05-22)
        200mm → 1.63 kg/sft   (2026-05-23 17:49)

    Raises:
        ValueError: thickness_mm not in {110, 155, 200}. Pure functions should
            fail loudly on bad input; orchestrator validates before calling.
    """
    if thickness_mm not in KG_PER_SFT:
        raise ValueError(
            f"compute_panel_weight_kg: thickness_mm={thickness_mm} is not one of "
            f"Karthik's standard catalog {sorted(KG_PER_SFT.keys())}. Non-standard "
            f"thicknesses route to CustomQuoteRequest at the orchestrator level."
        )
    return area_sqft * KG_PER_SFT[thickness_mm]


def compute_skin_rib_split(weight_kg: float) -> tuple[float, float]:
    """Split total panel weight into (skin, rib) per Karthik's 60/40 composition.

    Formula (DESIGN §4.4 + §5 validation rule C-9):
        skin = weight_kg × SKIN_FRACTION (= 0.60)
        rib  = weight_kg × RIB_FRACTION  (= 0.40)
        skin + rib == weight_kg (within IEEE-754 ε)

    Source: Karthik WhatsApp 2026-05-22 — "60% skin + 40% rib by weight".

    Returns:
        (skin_kg, rib_kg) tuple at full precision.
    """
    skin = weight_kg * SKIN_FRACTION
    rib = weight_kg * RIB_FRACTION
    return (skin, rib)


def compute_panel_price_inr(area_sqft: float) -> float:
    """Panel price in INR, at the flat ₹225/sft rate.

    Formula (DESIGN §4.4 + §5 validation rule C-8):
        price_inr = area_sqft × PRICE_PER_SFT_INR (= 225)

    Source: Karthik WhatsApp 2026-05-23 17:58 — "225 for all". Flat across the
    three standard thicknesses. The skin-vs-rib pricing engineering is still
    🟡 PENDING-KARTHIK but does NOT block: when it arrives, this function
    can be swapped to a per-component blend without schema change.
    """
    return area_sqft * PRICE_PER_SFT_INR


def compute_raw_weight_kg(
    raw_length_mm: float, width_mm: float, thickness_mm: int
) -> float:
    """Raw-stock weight consumed by one panel.

    Formula (DESIGN §4.4 + §5 validation rule C-16):
        raw_area = (raw_length_mm × width_mm) / MM2_PER_SFT
        raw_weight_kg = raw_area × KG_PER_SFT[thickness_mm]

    R6 INTEGRATED — raw_length_mm is an arbitrary int, NOT pinned to 3048:
      - Vertical panels: raw_length_mm = 3048 (one stock piece).
      - Horizontal panels with cut ≤ 3048: raw_length_mm = 3048 (one stock).
      - Horizontal panels with cut > 3048: raw_length_mm = ceil(cut/3048) × 3048
        (multiple stock pieces joined; the caller computes this multiplier).
        Example: BT155-9370 in P_EXT_3 → raw_length_mm = 12192 (4 pieces).
        See DESIGN §8.2 P_EXT_3 walkthrough.

    The caller (orchestrator / splitter) is responsible for computing raw_length_mm
    correctly per panel orientation. This function just multiplies area × rate.
    """
    if thickness_mm not in KG_PER_SFT:
        raise ValueError(
            f"compute_raw_weight_kg: thickness_mm={thickness_mm} is not one of "
            f"Karthik's standard catalog {sorted(KG_PER_SFT.keys())}."
        )
    raw_area_sqft = (raw_length_mm * width_mm) / MM2_PER_SFT
    return raw_area_sqft * KG_PER_SFT[thickness_mm]


def compute_waste_kg(raw_weight_kg: float, installed_weight_kg: float) -> float:
    """Difference between raw stock consumed and installed weight.

    Formula (DESIGN §4.4 + §5 validation rule C-17):
        waste_weight_kg = raw_weight_kg - installed_weight_kg

    Output_validator C-16 asserts raw ≥ installed (a negative waste indicates
    an algorithm bug upstream). This function performs the math without guard
    — let the validator catch contract violations explicitly.
    """
    return raw_weight_kg - installed_weight_kg


def compute_panel_metrics(
    cut_length_mm: float,
    raw_length_mm: float,
    width_mm: float,
    thickness_mm: int,
) -> dict[str, float]:
    """Convenience aggregator returning all 7 Panel numeric metrics in one call.

    Keys match Panel dataclass field names exactly (see types.py) so the
    orchestrator can splat: `Panel(label=..., sku=..., **metrics, ...)`.

    Returns:
        {
          "area_sqft":       (cut × width) / MM2_PER_SFT,
          "weight_kg":       area_sqft × KG_PER_SFT[thickness],
          "weight_kg_skin":  weight_kg × 0.60,
          "weight_kg_rib":   weight_kg × 0.40,
          "raw_weight_kg":   (raw × width) / MM2_PER_SFT × KG_PER_SFT[thickness],
          "waste_weight_kg": raw_weight_kg - weight_kg,
          "price_inr":       area_sqft × 225,
        }

    All values at IEEE-754 full precision; orchestrator rounds at output time.

    Worked example — P_INT_8 standard vertical panel (DESIGN §8.1):
        compute_panel_metrics(2998, 3048, 300, 110) →
          area_sqft       ≈ 9.6810,
          weight_kg       ≈ 12.4886,
          weight_kg_skin  ≈ 7.4931,
          weight_kg_rib   ≈ 4.9954,
          raw_weight_kg   ≈ 12.6968,
          waste_weight_kg ≈ 0.2083,
          price_inr       ≈ 2178.2387.

    All round cleanly to the DESIGN.md §8.1 expected values (9.68 / 12.49 /
    7.49 / 5.00 / 12.70 / 0.21 / 2178.24).
    """
    area_sqft = compute_panel_area_sqft(cut_length_mm, width_mm)
    weight_kg = compute_panel_weight_kg(area_sqft, thickness_mm)
    skin_kg, rib_kg = compute_skin_rib_split(weight_kg)
    raw_weight_kg = compute_raw_weight_kg(raw_length_mm, width_mm, thickness_mm)
    waste_weight_kg = compute_waste_kg(raw_weight_kg, weight_kg)
    price_inr = compute_panel_price_inr(area_sqft)
    return {
        "area_sqft":       area_sqft,
        "weight_kg":       weight_kg,
        "weight_kg_skin":  skin_kg,
        "weight_kg_rib":   rib_kg,
        "raw_weight_kg":   raw_weight_kg,
        "waste_weight_kg": waste_weight_kg,
        "price_inr":       price_inr,
    }
