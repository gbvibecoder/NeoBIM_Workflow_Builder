"""Slice 2B.1 — Deterministic adapter from MatchResult to BuildingModel.

The matcher LLM returns a :class:`MatchResult` carrying a
:class:`TemplateId` + :class:`TemplateParameters`. This module is the
*only* place the enum is resolved back to a callable Tier-2 builder; it
also reconciles the per-builder parameter-naming inconsistency baked
into the existing template surface:

* House builders accept ``floor_height``.
* Duplex builders accept ``floor_to_floor_m``.
* Tower builders accept ``floor_height`` plus the tower-only kwargs
  ``habitable_floor_count`` / ``has_stilt_parking`` / ``stilt_height``.

The dispatcher hides this surface noise from the matcher and downstream
route handlers. AI never sees the kwarg names — only the canonical
``floor_height_m`` field on :class:`TemplateParameters`.

Parameters left ``None`` on :class:`TemplateParameters` fall back to the
builder's own default (Pune-tuned values). This is intentional: the
matcher is allowed to leave a field unset when the brief is silent on
it, and the builder's default is always a valid LOD-300 choice.

The ``has_balcony`` field is reserved for slice 2B.2 (the FLAT-room
adapter); this slice ignores it. A test asserts the dispatch is
balcony-flag-invariant so future work can wire it without breaking the
matcher's existing few-shot prompts.
"""

from __future__ import annotations

from typing import Callable, Optional

from app.domain.building_model import BuildingModel
from app.services.design_agent.types import (
    MatchResult,
    TemplateId,
    TemplateParameters,
)
from app.templates import (
    build_1bhk_pune_duplex,
    build_1bhk_pune_house,
    build_1bhk_pune_tower,
    build_2bhk_pune_duplex,
    build_2bhk_pune_house,
    build_2bhk_pune_tower,
    build_3bhk_pune_duplex,
    build_3bhk_pune_house,
    build_3bhk_pune_tower,
)


# Enum → callable Tier-2 builder. Update both this map and
# :data:`app.services.design_agent.template_catalog.CATALOG` together —
# tests cross-check the two so a drift surfaces as a fail, not a silent
# 500 from the route handler.
_BUILDER_MAP: dict[TemplateId, Callable[..., BuildingModel]] = {
    TemplateId.BHK1_PUNE_HOUSE: build_1bhk_pune_house,
    TemplateId.BHK1_PUNE_DUPLEX: build_1bhk_pune_duplex,
    TemplateId.BHK1_PUNE_TOWER: build_1bhk_pune_tower,
    TemplateId.BHK2_PUNE_HOUSE: build_2bhk_pune_house,
    TemplateId.BHK2_PUNE_DUPLEX: build_2bhk_pune_duplex,
    TemplateId.BHK2_PUNE_TOWER: build_2bhk_pune_tower,
    TemplateId.BHK3_PUNE_HOUSE: build_3bhk_pune_house,
    TemplateId.BHK3_PUNE_DUPLEX: build_3bhk_pune_duplex,
    TemplateId.BHK3_PUNE_TOWER: build_3bhk_pune_tower,
}


_DUPLEX_IDS: frozenset[TemplateId] = frozenset(
    {
        TemplateId.BHK1_PUNE_DUPLEX,
        TemplateId.BHK2_PUNE_DUPLEX,
        TemplateId.BHK3_PUNE_DUPLEX,
    }
)
_TOWER_IDS: frozenset[TemplateId] = frozenset(
    {
        TemplateId.BHK1_PUNE_TOWER,
        TemplateId.BHK2_PUNE_TOWER,
        TemplateId.BHK3_PUNE_TOWER,
    }
)


def dispatch_template(
    template_id: TemplateId,
    parameters: TemplateParameters,
    *,
    build_id: Optional[str] = None,
    generated_at: Optional[str] = None,
) -> BuildingModel:
    """Resolve ``template_id`` to a builder and call it with ``parameters``.

    ``build_id`` and ``generated_at`` are passed through when supplied;
    omit them to let the builder use its own provenance defaults
    (matches the test-fixture style used by the existing
    ``test_template_*_pune.py`` suites).

    Raises :class:`KeyError` when ``template_id`` is not one of the nine
    Tier-2 builders. The KeyError message lists every covered id so the
    caller (route handler or test) can pinpoint a catalog/enum drift.
    """
    try:
        builder = _BUILDER_MAP[template_id]
    except KeyError as exc:
        raise KeyError(
            f"No builder registered for template_id={template_id!r}; "
            f"dispatcher covers {sorted(t.value for t in _BUILDER_MAP)}"
        ) from exc

    kwargs: dict[str, object] = {
        "plot_width_m": parameters.plot_width_m,
        "plot_length_m": parameters.plot_length_m,
        "seismic_zone": parameters.seismic_zone,
        "wind_zone": parameters.wind_zone,
    }
    if build_id is not None:
        kwargs["build_id"] = build_id
    if generated_at is not None:
        kwargs["generated_at"] = generated_at

    if template_id in _DUPLEX_IDS:
        # Duplex builders use ``floor_to_floor_m`` (legacy naming);
        # canonical :class:`TemplateParameters.floor_height_m` is
        # translated here. The semantics are identical (storey-to-storey
        # vertical distance in metres).
        kwargs["floor_to_floor_m"] = parameters.floor_height_m
    else:
        # House + tower builders use ``floor_height``.
        kwargs["floor_height"] = parameters.floor_height_m

    if template_id in _TOWER_IDS:
        if parameters.habitable_floor_count is not None:
            kwargs["habitable_floor_count"] = parameters.habitable_floor_count
        if parameters.has_stilt_parking is not None:
            kwargs["has_stilt_parking"] = parameters.has_stilt_parking
        if parameters.stilt_height_m is not None:
            kwargs["stilt_height"] = parameters.stilt_height_m
    # ``has_balcony`` is reserved for slice 2B.2; the current Tier-2
    # builders pin balcony presence inside the floor-unit selection
    # itself (see ``_*_pune_flat_floor_unit.py``). Ignored here on
    # purpose.

    return builder(**kwargs)


def dispatch_match(
    result: MatchResult,
    *,
    build_id: Optional[str] = None,
    generated_at: Optional[str] = None,
) -> BuildingModel:
    """Convenience wrapper: dispatch a :class:`MatchResult` directly.

    Equivalent to ``dispatch_template(result.template_id, result.parameters,
    build_id=..., generated_at=...)`` — provided so the route handler
    can keep call sites short.
    """
    return dispatch_template(
        result.template_id,
        result.parameters,
        build_id=build_id,
        generated_at=generated_at,
    )


__all__ = [
    "dispatch_template",
    "dispatch_match",
]
