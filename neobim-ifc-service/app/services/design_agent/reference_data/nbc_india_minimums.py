"""NBC India 2016 Part 4 — minimum dimensions for habitable rooms.

Source: National Building Code of India 2016, Volume 1, Part 4
"Fire and Life Safety" + Part 3 "Development Control Rules and General
Building Requirements", Tables for minimum sizes of habitable rooms,
kitchens, sanitary fittings, corridors, and stairs.

The numbers are CARPET-area floors (RERA definition) — the architect is
free to size larger but the ROOM_AREA_RESPECTS_NBC invariant on
:class:`~app.services.design_agent.types.RoomSpec` rejects anything
smaller. This module is the *single source of truth* for those minimums;
both the ProgramArchitect prompt and the Pydantic-side runtime check
read from here, so a code-update is a one-line change.

These values are kept in carpet-area sqm. Width / linear minimums (e.g.
corridor min width) are kept separately for clarity.

Coverage rationale
------------------
The :data:`NBC_MIN_AREAS_SQM` mapping covers every literal in the
``RoomUsage`` ``Literal`` defined in ``types.py``. Anything missing from
that mapping causes :func:`get_nbc_min_area_sqm` to fall back to a
conservative residential-grade habitable-room floor (1.0 sqm) so the
schema-level check still triggers — no silent zero — but a clear test
verifies every ``RoomUsage`` literal has an explicit entry.
"""

from __future__ import annotations

from typing import get_args

from app.services.design_agent.types import RoomUsage


# ── Per-usage minimum carpet area (sqm) ───────────────────────────────


# All values are CARPET-area sqm (RERA definition). Per Phase 2A Slice 1
# Q5 refinement, every entry is grouped by usage class with explicit
# source attribution so a future Phase 6+ refinement pass has a clear
# audit trail. Per-entry comments cite the section number where
# reasonable; sources spanning multiple codes cite the dominant one.
NBC_MIN_AREAS_SQM: dict[str, float] = {
    # === Residential — NBC India 2016 Part 4 §3 + Part 3 ===
    "living": 9.5,            # NBC Part 4 §3.4: primary habitable room ≥ 9.5 sqm
    "dining": 5.0,            # NBC Part 4 §3.4: secondary habitable ≥ 5.0 sqm
    "kitchen": 5.0,           # NBC Part 4 §3.5: separate kitchen ≥ 5.0 sqm
    "bedroom": 7.5,           # NBC Part 4 §3.4: 2nd bedroom floor ≥ 7.5 sqm
    "master_bedroom": 9.5,    # NBC Part 4 §3.4: primary bedroom ≥ 9.5 sqm
    "study": 5.5,             # NBC Part 3: minor habitable ≥ 5.5 sqm
    "store": 1.0,             # NBC Part 3: storage ≥ 1.0 sqm
    "utility": 1.0,           # NBC Part 3: utility/wash area ≥ 1.0 sqm
    "bathroom": 1.8,          # NBC Part 4 §3.6: bath+WC combined ≥ 1.8 sqm
    "powder_room": 1.1,       # NBC Part 4 §3.6: WC-only ≥ 1.1 sqm
    "balcony": 1.4,           # NBC Part 4: balcony carpet ≥ 1.4 sqm
    "corridor": 1.5,          # NBC Part 4: residential corridor area floor
    "lobby": 2.5,             # NBC Part 3: residential building lobby min
    "stairs_landing": 1.2,    # NBC Part 4: stair landing carpet area
    "pooja_room": 1.0,        # Indian residential standard practice
    "puja": 1.0,              # alias of pooja_room
    "vastu_zone": 1.0,        # Vastu placement marker; non-functional sized

    # === Commercial — CPWD DSR 2024 + IS 14660 ===
    # Group E (Business). NBC Part 4 specifies fire-safety minima but
    # not workspace ergonomics; commercial workstation floors come from
    # CPWD Delhi Schedule of Rates and IS 14660 office-planning standards.
    "office": 5.0,            # CPWD: individual workstation room ≥ 5 sqm
    "meeting_room": 9.0,      # CPWD: 4-6 seat meeting/conference room
    "reception": 6.0,         # CPWD: building reception lobby min
    "pantry": 4.0,            # CPWD: office pantry / kitchenette

    # === Institutional — NBC India 2016 Part 4 §6 + Hospital design guides ===
    # Group C. Indian Public Health Standards (IPHS) Vol. III + NBC
    # Part 9 (Plumbing) for sanitary; OT minima from IS 18000.
    "ward": 7.5,              # IPHS: ≥ 7.5 sqm per bed in general ward
    "consultation": 9.0,      # IPHS: hospital consult-room min
    "operation_theatre": 36.0, # IS 18000 + IPHS: minor OT ≥ 36 sqm
    "icu": 12.0,              # IPHS: ICU bay (per bed) ≥ 12 sqm

    # === Educational — NBC India 2016 Part 4 §7 + AICTE norms ===
    # Group B. NBC fire-safety floor + AICTE classroom-density norms.
    "classroom": 24.0,        # AICTE: ≥ 1.0 sqm/student × 24-30 student room
    "library": 25.0,          # NBC Part 4 §7: library reading floor min
    "auditorium": 50.0,       # NBC Part 4 §7: assembly minimum

    # === Mercantile — Group F (CPWD + commercial practice) ===
    # NBC Part 4 §F covers fire-safety; floor minima from CPWD and
    # accepted Indian retail design practice.
    "shop": 9.0,              # CPWD: small mercantile unit min
    "showroom": 18.0,         # CPWD: commercial showroom min
    "stock_room": 4.0,        # back-of-house storage min

    # === Industrial / Storage — NBC India 2016 Part 4 §8 ===
    # Group H. Warehouse storage floor + standard truck-bay loading.
    "warehouse_floor": 50.0,  # warehouse main floor min footprint
    "loading_bay": 12.0,      # 1× truck loading-bay min footprint

    # === Outdoor / Sentinels — Phase 2A Slice 1 Q2 refinement ===
    # Per Q2: ``"Outside"`` is NOT a RoomUsage. It is a magic-string
    # sentinel accepted only in adjacency arrays
    # (RoomSpec.adjacency_required / adjacency_forbidden) and Phase 1's
    # Door.connects_room_ids. ``"external"`` IS a real RoomUsage —
    # representing legitimate sized exterior spaces (terraces,
    # courtyards, verandahs, balcony slabs that aren't already
    # ``"balcony"``). Its NBC-min mirrors the balcony floor.
    "external": 1.4,          # NBC Part 4: balcony / outdoor carpet ≥ 1.4 sqm
}


# ── Linear / dimensional minimums (NBC India Part 4 — life safety) ─


class _NBCLinearMinimums:
    """Linear and dimensional NBC minimums.

    These are NOT carpet-area sqm; they're widths, depths, and heights.
    Kept distinct from :data:`NBC_MIN_AREAS_SQM` so consumers can pick
    the right floor for their check (CirculationSpec width vs. room
    area).
    """

    # Habitable room minimum width (NBC India Part 4)
    habitable_room_min_width_m: float = 2.4
    # Bedroom minimum width
    bedroom_min_width_m: float = 2.1
    # Bathroom minimum width
    bathroom_min_width_m: float = 1.2
    # WC-only minimum width
    wc_min_width_m: float = 0.9
    # Habitable room minimum clear height
    habitable_room_min_height_m: float = 2.75
    # Bathroom minimum clear height
    bathroom_min_height_m: float = 2.2
    # Corridor minimum widths
    corridor_residential_width_m: float = 1.2
    corridor_commercial_width_m: float = 1.5
    # Stair geometry
    stair_tread_min_m: float = 0.25
    stair_riser_max_m: float = 0.19
    stair_min_width_residential_m: float = 1.0
    stair_min_width_commercial_m: float = 1.5
    # Doors
    door_min_width_main_m: float = 1.0
    door_min_width_internal_m: float = 0.75
    door_min_height_m: float = 2.0
    # Balcony parapet height
    balcony_parapet_min_height_m: float = 1.0


NBC_MIN_LINEAR = _NBCLinearMinimums()


# ── Per-fidelity-tier ratio defaults ─────────────────────────────────


# RERA carpet : built-up : super-built-up ratios. Used as the default for
# ProgramConstraints.rera_carpet_built_super_ratio when the architect
# does not override per-region. Carpet is always 1.0 by definition.
DEFAULT_RERA_RATIOS: tuple[float, float, float] = (1.0, 1.15, 1.30)


# ── Lookup helpers ───────────────────────────────────────────────────


def get_nbc_min_area_sqm(usage: str) -> float:
    """Return the NBC India 2016 minimum carpet area (sqm) for a usage.

    Falls back to 1.0 sqm for unknown usages so the
    ROOM_AREA_RESPECTS_NBC invariant still triggers if the room area is
    suspiciously small. The full set of canonical ``RoomUsage`` literals
    is kept in sync with ``NBC_MIN_AREAS_SQM`` by
    :func:`assert_room_usage_coverage` (covered by the slice's tests).
    """
    return NBC_MIN_AREAS_SQM.get(usage, 1.0)


def assert_room_usage_coverage() -> None:
    """Verify every ``RoomUsage`` literal has a NBC-min entry.

    Called from the test suite. Raises :class:`KeyError` listing the
    missing entries on coverage drift. We intentionally avoid auto-
    populating defaults here — a missing usage is a real authoring bug
    that should fail loudly rather than silently round to 1.0 sqm.
    """
    declared = set(get_args(RoomUsage))
    covered = set(NBC_MIN_AREAS_SQM.keys())
    missing = declared - covered
    if missing:
        raise KeyError(
            f"NBC_MIN_AREAS_SQM missing {sorted(missing)}; every "
            f"RoomUsage literal must have an explicit min carpet area."
        )
    extraneous = covered - declared
    if extraneous:
        raise KeyError(
            f"NBC_MIN_AREAS_SQM has stale entries {sorted(extraneous)} "
            f"with no matching RoomUsage literal — remove them."
        )


__all__ = [
    "NBC_MIN_AREAS_SQM",
    "NBC_MIN_LINEAR",
    "DEFAULT_RERA_RATIOS",
    "get_nbc_min_area_sqm",
    "assert_room_usage_coverage",
]
