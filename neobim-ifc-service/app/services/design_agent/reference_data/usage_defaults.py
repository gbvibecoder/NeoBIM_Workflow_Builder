"""Phase 2A Slice 2A.6 (post-restructure) — derived RoomSpec defaults.

The ProgramArchitect's restructure (per-floor parallel calls + slim
LLM schema) extracts five fields from the LLM emission and computes
them deterministically post-call from the room's ``usage`` literal:

  * ``aspect_ratio_min`` / ``aspect_ratio_max``
  * ``natural_light_required``
  * ``natural_ventilation_required``
  * ``privacy_level``

Rationale: the ``usage`` Literal already encodes everything we need
to know about these properties — a "kitchen" will always have the
same aspect-ratio sanity bounds, light requirement, ventilation
requirement, and privacy level, regardless of which brief produced
it. Asking the LLM to repeat per-room what is essentially a static
table lookup wastes tokens and risks inconsistency.

After Slice 2A.6's per-floor restructure, the LLM emits only the
fields it actually decides:

  id, name, usage, target_area_sqm, floor_index,
  adjacency_required, adjacency_forbidden, notes

The composer then enriches each room with USAGE_DEFAULTS to construct
the strict :class:`RoomSpec` (which still requires all 14 fields).

Sourcing
--------
Aspect-ratio bounds: practical Indian-architecture norms (kitchens
tolerate longer galley layouts, 1:2.5; habitable rooms cluster near
square, 1:1.8 max for visual comfort).
Light + ventilation: NBC India 2016 Part 4 §3 + §11 (habitable rooms
require natural light + ventilation; circulation / sanitary spaces
do not).
Privacy: Indian residential / commercial convention (master bedroom +
bathroom = private; living + dining = semi-private; corridor + lobby
= public).
"""

from __future__ import annotations

from typing import TypedDict, get_args

from app.services.design_agent.types import PrivacyLevel, RoomUsage


class UsageDefaults(TypedDict):
    """The 5 RoomSpec fields the composer derives from ``usage``."""

    aspect_ratio_min: float
    aspect_ratio_max: float
    natural_light_required: bool
    natural_ventilation_required: bool
    privacy_level: PrivacyLevel


# Per-RoomUsage defaults. Every literal in ``RoomUsage`` MUST appear
# here; :func:`assert_usage_defaults_coverage` asserts this at test time.
USAGE_DEFAULTS: dict[str, UsageDefaults] = {
    # ── Residential habitable rooms ──
    "living": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 1.8,
        "natural_light_required": True,
        "natural_ventilation_required": True,
        "privacy_level": "semi_private",
    },
    "dining": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 1.8,
        "natural_light_required": True,
        "natural_ventilation_required": True,
        "privacy_level": "semi_private",
    },
    "kitchen": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 2.5,
        "natural_light_required": True,
        "natural_ventilation_required": True,
        "privacy_level": "semi_private",
    },
    "master_bedroom": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 1.6,
        "natural_light_required": True,
        "natural_ventilation_required": True,
        "privacy_level": "private",
    },
    "bedroom": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 1.8,
        "natural_light_required": True,
        "natural_ventilation_required": True,
        "privacy_level": "private",
    },
    "study": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 2.0,
        "natural_light_required": True,
        "natural_ventilation_required": True,
        "privacy_level": "private",
    },
    "store": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 3.0,
        "natural_light_required": False,
        "natural_ventilation_required": False,
        "privacy_level": "private",
    },
    "utility": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 3.0,
        "natural_light_required": False,
        "natural_ventilation_required": True,
        "privacy_level": "private",
    },
    "bathroom": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 2.5,
        "natural_light_required": False,
        "natural_ventilation_required": True,
        "privacy_level": "private",
    },
    "powder_room": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 2.5,
        "natural_light_required": False,
        "natural_ventilation_required": True,
        "privacy_level": "private",
    },
    "balcony": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 4.0,
        "natural_light_required": True,
        "natural_ventilation_required": True,
        "privacy_level": "semi_private",
    },
    "corridor": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 10.0,
        "natural_light_required": False,
        "natural_ventilation_required": False,
        "privacy_level": "public",
    },
    "lobby": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 2.5,
        "natural_light_required": False,
        "natural_ventilation_required": False,
        "privacy_level": "public",
    },
    "stairs_landing": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 2.5,
        "natural_light_required": False,
        "natural_ventilation_required": False,
        "privacy_level": "public",
    },
    # ── Cultural / religious ──
    "pooja_room": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 1.5,
        "natural_light_required": False,
        "natural_ventilation_required": True,
        "privacy_level": "private",
    },
    "puja": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 1.5,
        "natural_light_required": False,
        "natural_ventilation_required": True,
        "privacy_level": "private",
    },
    "vastu_zone": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 2.0,
        "natural_light_required": False,
        "natural_ventilation_required": False,
        "privacy_level": "semi_private",
    },
    # ── Commercial — Group E (Office) ──
    "office": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 2.0,
        "natural_light_required": True,
        "natural_ventilation_required": True,
        "privacy_level": "semi_private",
    },
    "meeting_room": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 1.8,
        "natural_light_required": True,
        "natural_ventilation_required": True,
        "privacy_level": "semi_private",
    },
    "reception": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 2.0,
        "natural_light_required": True,
        "natural_ventilation_required": True,
        "privacy_level": "public",
    },
    "pantry": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 2.5,
        "natural_light_required": False,
        "natural_ventilation_required": True,
        "privacy_level": "semi_private",
    },
    # ── Institutional — Group C (Hospital) ──
    "ward": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 2.0,
        "natural_light_required": True,
        "natural_ventilation_required": True,
        "privacy_level": "semi_private",
    },
    "consultation": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 1.5,
        "natural_light_required": True,
        "natural_ventilation_required": True,
        "privacy_level": "private",
    },
    "operation_theatre": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 1.5,
        "natural_light_required": False,
        "natural_ventilation_required": False,
        "privacy_level": "private",
    },
    "icu": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 1.8,
        "natural_light_required": False,
        "natural_ventilation_required": False,
        "privacy_level": "private",
    },
    # ── Educational — Group B ──
    "classroom": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 2.0,
        "natural_light_required": True,
        "natural_ventilation_required": True,
        "privacy_level": "public",
    },
    "library": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 2.5,
        "natural_light_required": True,
        "natural_ventilation_required": True,
        "privacy_level": "public",
    },
    "auditorium": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 2.5,
        "natural_light_required": False,
        "natural_ventilation_required": True,
        "privacy_level": "public",
    },
    # ── Mercantile — Group F ──
    "shop": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 3.0,
        "natural_light_required": False,
        "natural_ventilation_required": True,
        "privacy_level": "public",
    },
    "showroom": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 2.5,
        "natural_light_required": False,
        "natural_ventilation_required": True,
        "privacy_level": "public",
    },
    "stock_room": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 3.0,
        "natural_light_required": False,
        "natural_ventilation_required": False,
        "privacy_level": "private",
    },
    # ── Industrial — Group H ──
    "warehouse_floor": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 3.0,
        "natural_light_required": False,
        "natural_ventilation_required": True,
        "privacy_level": "public",
    },
    "loading_bay": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 4.0,
        "natural_light_required": False,
        "natural_ventilation_required": True,
        "privacy_level": "public",
    },
    # ── Outdoor / sentinel ──
    "external": {
        "aspect_ratio_min": 1.0, "aspect_ratio_max": 4.0,
        "natural_light_required": True,
        "natural_ventilation_required": True,
        "privacy_level": "public",
    },
}


_FALLBACK_DEFAULTS: UsageDefaults = {
    "aspect_ratio_min": 1.0,
    "aspect_ratio_max": 3.0,
    "natural_light_required": False,
    "natural_ventilation_required": False,
    "privacy_level": "private",
}


def get_usage_defaults(usage: str) -> UsageDefaults:
    """Return the derived defaults for the given usage literal.

    Falls back to a conservative default when the usage is unknown
    (defensive — should never happen because the ``usage`` field is
    a Pydantic ``Literal`` validated at parse time).
    """
    return USAGE_DEFAULTS.get(usage, _FALLBACK_DEFAULTS)


def assert_usage_defaults_coverage() -> None:
    """Drift sentinel: every ``RoomUsage`` literal has a defaults entry.

    Mirrors :func:`assert_room_usage_coverage` for the NBC table.
    Called from the slice's tests.
    """
    declared = set(get_args(RoomUsage))
    covered = set(USAGE_DEFAULTS.keys())
    missing = declared - covered
    if missing:
        raise KeyError(
            f"USAGE_DEFAULTS missing {sorted(missing)}; every RoomUsage "
            f"literal must have an explicit defaults entry."
        )
    extraneous = covered - declared
    if extraneous:
        raise KeyError(
            f"USAGE_DEFAULTS has stale entries {sorted(extraneous)} with "
            f"no matching RoomUsage literal — remove them."
        )


__all__ = [
    "UsageDefaults",
    "USAGE_DEFAULTS",
    "get_usage_defaults",
    "assert_usage_defaults_coverage",
]
