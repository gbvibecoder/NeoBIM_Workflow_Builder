"""Annotation library for KOS opening detection — Phase 5C-3 PR 4.

Each customer/architectural firm uses its own annotation conventions on CAD
drawings (block names, text labels, layer naming). This module is the canonical
source of truth for the per-firm allow/deny lists Tier 4 uses to classify
text spans as openings.

**CRITICAL invariant:** only labels declared in a firm's opening library count
as openings. Drainage labels (``RWO``, ``RWD``, ``CO``…), wall-type labels
(``CW1``..``CW10``, ``CFW1``..``CFW3``…), and other non-opening callouts MUST
NOT trigger opening detection — false positives propagate to phantom panels
in BOQ and erode customer trust.

Confirmed by Karthik (WhatsApp, 2026-05-25):
  - 90VR "Concrete Setout Plan" PDFs are the canonical customer input format
  - Team2 Architects' conventions are the v1 baseline
  - Walls outside 110/155/200 mm are CUSTOM (case-by-case quote)
  - Curved walls are CUSTOM (curved formwork panels per project)
  - Additional firms will be added iteratively (one entry at a time)

POLICY-KARTHIK-WINS: when this library conflicts with a Karthik confirmation,
the library is wrong — update entries, never the other way around.

Determinism: all data structures are ``Final`` frozenset/tuple. Lookup
functions are pure (no I/O, no global state, no caching).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

OpeningType = Literal["door", "window", "sliding_door"]


@dataclass(frozen=True)
class AnnotationEntry:
    """One annotation label in a firm's opening library.

    All dimensions in mm. ``confidence_modifier`` ∈ [0, 1] multiplies the
    Tier 4 base confidence (declared in ``kos_opening_pdf`` /
    ``kos_opening_dxf``) so per-label trust can be tuned without changing
    the tier ceiling.

    Field invariants (verified by ``test_team2_library_invariants``):
      - ``label`` is non-empty
      - ``opening_type`` ∈ {"door", "window", "sliding_door"}
      - dimensions are positive
      - ``sill_height_mm`` is ≥ 0 (= 0 for doors, > 0 for windows)
      - ``confidence_modifier`` ∈ [0, 1]
    """

    label: str
    opening_type: OpeningType
    default_width_mm: float
    default_height_mm: float
    default_sill_height_mm: float
    confidence_modifier: float
    notes: str = ""


# ── Team2 Architects (90VR project — first verified customer) ────────────────
#
# Source: visual inspection of
#   temp_folder/reference/90VR-MR-AD-2501[J]-Concrete Setout Plan-Basement-Part 2.pdf
#   temp_folder/reference/90VR-TC-AD-2501[A]-Concrete Setout Plan-Basement-Part 2.pdf
# Inventoried 2026-05-25 via PyMuPDF text span extraction
# (see scripts/extract_90vr_ground_truth.py).
#
# 90VR-MR contains 21 SD/DW1/DW2 labels; 90VR-TC is a structural plan with
# zero door labels (correctly emits 0 openings).

TEAM2_OPENING_LIBRARY: Final[tuple[AnnotationEntry, ...]] = (
    AnnotationEntry(
        label="SD",
        opening_type="sliding_door",
        # Typical Australian residential sliding door (Karthik to confirm
        # per-project; v1 default).
        default_width_mm=2400.0,
        default_height_mm=2100.0,
        default_sill_height_mm=0.0,
        # Slightly higher than DW* because the SD label is more distinctive
        # (only one meaning in Team2's library), so the confidence we
        # have in its semantic interpretation is higher.
        confidence_modifier=0.85,
        notes=(
            "Sliding door — wider than swing door. Default 2400×2100mm "
            "pending Karthik per-project confirmation."
        ),
    ),
    AnnotationEntry(
        label="DW1",
        opening_type="door",
        # 1200mm = double-door / wide-entry default per Team2 90VR drawings.
        default_width_mm=1200.0,
        default_height_mm=2100.0,
        default_sill_height_mm=0.0,
        confidence_modifier=0.80,
        notes="Door type 1 — typically wide; verify per-drawing dimensions.",
    ),
    AnnotationEntry(
        label="DW2",
        opening_type="door",
        # 900mm = standard internal door per Team2 90VR drawings.
        default_width_mm=900.0,
        default_height_mm=2100.0,
        default_sill_height_mm=0.0,
        confidence_modifier=0.80,
        notes="Door type 2 — typically standard internal width.",
    ),
)


# Explicit NON-opening labels. These NEVER count as openings, even if a span
# bearing one of these labels happens to sit close to a wall axis. Built from
# the 90VR drawing inventory (see PR 4 report §1.4) and grouped by domain so
# we can tell at a glance why a label is excluded.
TEAM2_NON_OPENING_LABELS: Final[frozenset[str]] = frozenset({
    # ── Drainage / plumbing ──────────────────────────────────────────────
    "RWO",   # Rainwater Outlet
    "RWD",   # Rainwater Downpipe
    "TD",    # Tundish
    "FW",    # Floor Waste
    "SK",    # Sink
    "CO",    # Cleanout
    "IM",    # Inspection Manhole
    "STW",   # Stair Wall (structural — not a plumbing fixture per Karthik's
             # convention but grouped here because it likewise must not
             # register as an opening)
    "DHW",   # Domestic Hot Water (90VR inventory)

    # ── Wall types (NOT openings) ────────────────────────────────────────
    "CW1", "CW2", "CW3", "CW4", "CW5",
    "CW6", "CW7", "CW8", "CW9", "CW10",
    "CFW1", "CFW2", "CFW3",
    "PDFW",                          # Pad Footing Wall (inferred)
    "CW",                            # Bare CW (used on 90VR-MR)

    # ── Electrical ───────────────────────────────────────────────────────
    "EL",

    # ── Dimension / level / annotation tokens ────────────────────────────
    "SSL",   # Structural Slab Level
    "MIN",
    "MAX",
    "TBC",   # To Be Confirmed
    "DIM",
    "SLAB",
    "STEP",
    "UP",    # stair direction marker
    "LH",
    "JK",

    # ── Generic structural / drawing index codes ─────────────────────────
    "TC",    # Title-block code (Top Cover / Tower Crane / drawing suffix)
    "MR",    # Title-block code (Main Residence)
    "RV",    # Revision marker
})


def get_opening_entry(label: str, firm: str = "team2") -> AnnotationEntry | None:
    """Return the AnnotationEntry for ``label`` under ``firm`` or ``None``.

    ``None`` means "this label is not a recognised opening for this firm";
    that does NOT imply the label is excluded — use
    :func:`is_non_opening_label` to distinguish unknown from explicitly
    excluded.

    Pure function. Linear scan is fine: each firm's library is < 100 entries.
    """
    if firm == "team2":
        for entry in TEAM2_OPENING_LIBRARY:
            if entry.label == label:
                return entry
        return None
    # Future: elif firm == "...": ...
    return None


def is_non_opening_label(label: str, firm: str = "team2") -> bool:
    """True iff ``label`` is EXPLICITLY excluded under ``firm``.

    Three states a label can be in:
      - in opening library     → recognised opening (use ``get_opening_entry``)
      - in non-opening list    → explicitly excluded (this returns True)
      - in neither             → unknown (treated as non-opening at detection
                                 time, but ``False`` here so callers can tell
                                 the difference and surface unknowns for
                                 library expansion).
    """
    if firm == "team2":
        return label in TEAM2_NON_OPENING_LABELS
    return False


def list_known_firms() -> tuple[str, ...]:
    """All firm identifiers this module recognises (for diagnostics + tests)."""
    return ("team2",)


__all__ = [
    "AnnotationEntry",
    "OpeningType",
    "TEAM2_OPENING_LIBRARY",
    "TEAM2_NON_OPENING_LABELS",
    "get_opening_entry",
    "is_non_opening_label",
    "list_known_firms",
]
