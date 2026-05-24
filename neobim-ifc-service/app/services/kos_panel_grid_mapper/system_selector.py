"""
System selection — Problem 1 of the mapper pipeline. DESIGN.md §6.2.

Maps a (wall_thickness_mm, application_hint, inferred_application) tuple to
one of the 6 Kalzen systems (K4-110 / K6-150 / K6-180 / K8-200 / K8-250 /
CUSTOM) and flags whether the wall needs a CustomQuoteRequest sales handoff.

Algorithm (4 steps):

  1. NULL or sub-band thickness → CUSTOM with diagnostic warning.
  2. Band-select via THICKNESS_BANDS (PR 1 constants): the half-open interval
     a wall's thickness falls into determines the system. Gap-thicknesses
     (120-145, 160-170, 220-240, ≥270) fall through to CUSTOM.
  3. Apply Rulebook §4.2 application-driven overrides on top:
        - basement_gt3m → K8-250
        - basement_lt3m → K8-200
        - retaining     → K8-250
        - shear_wall_g10 → K8-200
        - lift_shaft_g5  → K8-200
        - apartment_external_g5 → K6-180
     When `application_hint` is None but the orientation_inferrer's
     `inferred_application` is "basement" or "retaining" (typically from a
     title-block scan), apply the conservative default override
     (basement_lt3m for basement, retaining for retaining).
  4. Set `is_custom_order` per CONTEXT_CONFIRMED §B2/B3:
        - K6-180: in rulebook but NOT in Karthik's standard 110/155/200
                  catalog → custom-order with warning.
        - K8-250: Karthik 2026-05-22 — "250mm/275mm+ is custom-on-request"
                  → custom-order with warning.
        - CUSTOM: band-gap or thickness null → custom-order with warning.
        - K4-110, K6-150, K8-200: standard catalog → False.

Determinism: pure function. Same inputs ⇒ same SystemSelectionResult.
"""

from __future__ import annotations

from typing import Optional

from .constants import (
    SKU_THICKNESS_FOR_SYSTEM,
    THICKNESS_BANDS,
    Application,
    SimpleApplication,
    System,
)
from .types import SystemSelectionResult


def select_system(
    wall_thickness_mm: Optional[float],
    application_hint: Optional[Application] = None,
    inferred_application: SimpleApplication = "external",
) -> SystemSelectionResult:
    """Pick a Kalzen system for a wall.

    Args:
      wall_thickness_mm:      The parser-detected wall thickness in mm,
                              or None if the parser couldn't measure it.
      application_hint:       Optional explicit application from ProjectContext.
                              When supplied, takes precedence over inferred.
      inferred_application:   The orientation_inferrer's coarse classification
                              ("external" / "internal" / "basement" / "retaining").
                              Used as a fallback to apply default basement /
                              retaining overrides when no explicit hint.

    Returns:
      SystemSelectionResult with the chosen system, the SKU thickness component
      (110/155/180/200/250 or None), is_custom_order flag, and any warnings
      explaining custom-order or unusual-thickness routing.
    """
    warnings: list[str] = []

    # ── Step 1: NULL or invalid thickness → CUSTOM ────────────────────
    if wall_thickness_mm is None:
        warnings.append(
            "thickness_mm null — parser couldn't detect; routed to CUSTOM "
            "(custom_quote_request handoff at orchestrator level)"
        )
        return SystemSelectionResult(
            system="CUSTOM",
            sku_thickness_mm=None,
            is_custom_order=True,
            warnings=tuple(warnings),
        )

    if wall_thickness_mm <= 0:
        warnings.append(f"thickness_mm={wall_thickness_mm} ≤ 0 — invalid input; routed to CUSTOM")
        return SystemSelectionResult(
            system="CUSTOM",
            sku_thickness_mm=None,
            is_custom_order=True,
            warnings=tuple(warnings),
        )

    # ── Step 2: band-select ───────────────────────────────────────────
    system, sku_th = _band_select(wall_thickness_mm)
    if system == "CUSTOM":
        warnings.append(_band_gap_diagnostic(wall_thickness_mm))

    # ── Step 3: apply application override (Rulebook §4.2) ────────────
    if application_hint is not None:
        system, sku_th = _apply_hint_override(system, sku_th, application_hint, warnings)
    elif inferred_application == "basement":
        # Conservative default for inferred basement (e.g. from title_block.level).
        # User can override with explicit application_hint="basement_gt3m" for deep basements.
        if system not in ("K8-200", "K8-250"):
            warnings.append(
                "inferred_application='basement' (no explicit hint); defaulting to "
                f"basement_lt3m override per Rulebook §4.2 (K8-200, was {system})"
            )
            system, sku_th = "K8-200", 200
    elif inferred_application == "retaining":
        if system != "K8-250":
            warnings.append(
                "inferred_application='retaining' (no explicit hint); applying "
                f"retaining override per Rulebook §4.2 (K8-250, was {system})"
            )
            system, sku_th = "K8-250", 250

    # ── Step 4: is_custom_order flag + per-system warnings ────────────
    if system == "K6-180":
        warnings.append(
            "K6-180 selected: in Rulebook §4.1 but NOT in Karthik's standard SKU "
            "catalog (110/155/200) — routing to custom_quote_request"
        )
    if system == "K8-250":
        warnings.append(
            "K8-250 selected: Karthik 2026-05-22 confirmed 250mm is "
            "custom-on-request — routing to custom_quote_request"
        )

    is_custom = system in ("K6-180", "K8-250", "CUSTOM")
    return SystemSelectionResult(
        system=system,
        sku_thickness_mm=sku_th,
        is_custom_order=is_custom,
        warnings=tuple(warnings),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Private helpers
# ──────────────────────────────────────────────────────────────────────────────


def _band_select(thickness_mm: float) -> tuple[System, Optional[int]]:
    """Walk THICKNESS_BANDS in order and return the first matching system.

    Returns ("CUSTOM", None) when thickness falls outside every band (sub-100,
    in a band-gap, or ≥ top-band upper bound).
    """
    for low, high, system in THICKNESS_BANDS:
        if low <= thickness_mm < high:
            return system, SKU_THICKNESS_FOR_SYSTEM[system]
    return "CUSTOM", None


def _band_gap_diagnostic(thickness_mm: float) -> str:
    """Produce a human-readable warning explaining why a thickness fell to CUSTOM."""
    if thickness_mm < 100:
        return (
            f"thickness {thickness_mm}mm < 100mm: sub-standard thin — "
            f"routing to CUSTOM"
        )
    if thickness_mm >= 275:
        return (
            f"thickness {thickness_mm}mm ≥ 275mm: custom-thick per Karthik "
            f"2026-05-22 — routing to CUSTOM"
        )
    return (
        f"thickness {thickness_mm}mm falls in a band gap (not 110/150-155/180/200/250) "
        f"— routing to CUSTOM"
    )


def _apply_hint_override(
    system: System,
    sku_th: Optional[int],
    hint: Application,
    warnings: list[str],
) -> tuple[System, Optional[int]]:
    """Apply Rulebook §4.2 application-driven overrides on the band-selected
    system. Each override mandates K8-* (or K6-180) for specific application
    categories regardless of thickness band.

    Hints that don't trigger overrides (internal_partition, villa_external,
    apartment_external_g3, school_commercial_g3) leave system unchanged.
    """
    if hint == "basement_gt3m" and system != "K8-250":
        warnings.append(
            f"basement_gt3m hint: Rulebook §4.2 mandates K8-250 (was {system})"
        )
        return "K8-250", 250
    if hint == "basement_lt3m" and system not in ("K8-200", "K8-250"):
        warnings.append(
            f"basement_lt3m hint: Rulebook §4.2 mandates K8-200 (was {system})"
        )
        return "K8-200", 200
    if hint == "retaining" and system != "K8-250":
        warnings.append(
            f"retaining hint: Rulebook §4.2 mandates K8-250 (was {system})"
        )
        return "K8-250", 250
    if hint == "shear_wall_g10" and system != "K8-200":
        warnings.append(
            f"shear_wall_g10 hint: Rulebook §4.2 mandates K8-200 (was {system})"
        )
        return "K8-200", 200
    if hint == "lift_shaft_g5" and system != "K8-200":
        warnings.append(
            f"lift_shaft_g5 hint: Rulebook §4.2 mandates K8-200 (was {system})"
        )
        return "K8-200", 200
    if hint == "apartment_external_g5" and system != "K6-180":
        warnings.append(
            f"apartment_external_g5 hint: Rulebook §4.2 prefers K6-180 "
            f"for G+5 apartment external walls (was {system})"
        )
        return "K6-180", 180
    # No override applicable — return unchanged.
    return system, sku_th
