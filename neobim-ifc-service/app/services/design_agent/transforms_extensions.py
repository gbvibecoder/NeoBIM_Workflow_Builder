"""Slice 2B.3 — Extension orchestrator.

Coordinates application of the five extension primitives (compound
wall, entry gate, car porch, servant quarter, mumty) onto a
BuildingModel produced by ``dispatch_template``. The orchestrator
sits between dispatcher and adapter in the pipeline:

    matcher → dispatcher → BuildingModel
                              ▼
                       apply_extensions  ← THIS MODULE
                              ▼
                       apply_adaptations  (2B.2 adapter)
                              ▼
                       IFC export

Contract
--------
:func:`apply_extensions(bm, plan) -> (bm, ExtensionFailed | None)`

Behaviour:

* **No-op plan** (``plan.is_noop``): returns ``(bm, None)`` — input
  BuildingModel unchanged, downstream pipeline byte-identical to the
  2B.2 output.
* **Canonical order**: regardless of ``plan.extensions`` ordering, the
  orchestrator applies extensions in dependency-aware sequence:

      compound_wall → entry_gate → car_porch → servant_quarter → mumty

  Entry gate depends on compound wall (cuts opening); applying
  compound wall first prevents the auto-add path inside ``entry_gate``
  from creating duplicate walls. The other three are independent.
* **Dedup**: duplicates by ``extension_type`` in ``plan.extensions``
  are deduped first-occurrence-wins. The orchestrator emits a warning
  via the failure reason if dedup happened (but does NOT mark the
  extension as failed — silent dedup matches the senior-engineer rule
  "don't fail-loud on harmless cases").
* **Per-extension try/except**: each call is independently failable.
  An ExtensionError (or its subclasses
  :class:`PlotBoundaryViolationError`, :class:`NBCViolationError`,
  :class:`ExtensionRequiresPlotError`) routes the failure into
  ``failed_extensions`` and continues. A
  :class:`BuildingModelValidationError` (the geometric invariant
  layer) is also caught and reported with its precise ``rule_id``.
* **Return envelope**:

  - All extensions succeeded → ``(new_bm, None)``.
  - Some succeeded, some failed → ``(partial_bm, ExtensionFailed(
    suggested_action="skip_failed_extensions",
    failed_extensions=[...]))``.
  - All requested extensions failed → ``(input_bm, ExtensionFailed(
    suggested_action="ship_as_is", failed_extensions=[...]))`` — the
    BuildingModel is reverted to the input so the adapter + IFC
    export still ships a buildable IFC.

Extension parameter mapping
---------------------------
``ExtensionRequest`` carries optional ``length_m`` / ``width_m`` /
``height_m`` overrides. The orchestrator maps these to extension-
specific kwargs (e.g. ``length_m`` → ``porch_depth_m`` for car porch,
``length_m`` → ``bedroom_depth_m`` for servant). When a field is None,
the extension function's default applies.

``ExtensionRequest.attachment`` is currently ignored — every v1
extension has hardcoded attachment semantics (compound wall = whole
perimeter, gate / porch = front, servant = rear, mumty = rear-center
of roof). The field is preserved on the type for forward-compatibility
with v2.
"""

from __future__ import annotations

from typing import Optional

from app.domain.building_model import BuildingModel, BuildingModelValidationError
from app.services.design_agent.types import (
    ExtensionFailed,
    ExtensionPlan,
    ExtensionRequest,
    ExtensionType,
)

from .extensions._common import ExtensionError
from .extensions.car_porch import add_car_porch
from .extensions.compound_wall import add_compound_wall
from .extensions.entry_gate import add_entry_gate
from .extensions.mumty import add_mumty
from .extensions.servant_quarter import add_servant_quarter


# Dependency-aware canonical order. Entry gate cuts an opening into
# the compound wall, so compound wall MUST be applied first. The
# other three are independent and ordered by spatial sequencing
# (front → rear → roof) for diagnostic legibility — a debugger trace
# walks the building front-to-rear-to-top naturally.
_CANONICAL_ORDER: list[ExtensionType] = [
    ExtensionType.COMPOUND_WALL,
    ExtensionType.ENTRY_GATE,
    ExtensionType.CAR_PORCH,
    ExtensionType.SERVANT_QUARTER,
    ExtensionType.MUMTY,
]


def _dispatch(
    ext_type: ExtensionType, bm: BuildingModel, req: ExtensionRequest
) -> BuildingModel:
    """Map an :class:`ExtensionRequest` to the matching ``add_*``
    function with extension-specific kwarg names.

    Optional dims (``length_m`` / ``width_m`` / ``height_m``) propagate
    only when set (not None). Unset fields fall through to each
    extension's documented defaults.
    """
    if ext_type == ExtensionType.COMPOUND_WALL:
        kwargs: dict = {}
        if req.height_m is not None:
            kwargs["height_m"] = req.height_m
        return add_compound_wall(bm, **kwargs)

    if ext_type == ExtensionType.ENTRY_GATE:
        kwargs = {}
        if req.width_m is not None:
            kwargs["gate_width_m"] = req.width_m
        if req.height_m is not None:
            kwargs["gate_height_m"] = req.height_m
        return add_entry_gate(bm, **kwargs)

    if ext_type == ExtensionType.CAR_PORCH:
        kwargs = {}
        if req.width_m is not None:
            kwargs["porch_width_m"] = req.width_m
        if req.length_m is not None:
            kwargs["porch_depth_m"] = req.length_m
        if req.height_m is not None:
            kwargs["porch_height_m"] = req.height_m
        return add_car_porch(bm, **kwargs)

    if ext_type == ExtensionType.SERVANT_QUARTER:
        kwargs = {}
        if req.width_m is not None:
            kwargs["bedroom_width_m"] = req.width_m
        if req.length_m is not None:
            kwargs["bedroom_depth_m"] = req.length_m
        return add_servant_quarter(bm, **kwargs)

    if ext_type == ExtensionType.MUMTY:
        kwargs = {}
        if req.width_m is not None:
            kwargs["mumty_width_m"] = req.width_m
        if req.length_m is not None:
            kwargs["mumty_depth_m"] = req.length_m
        if req.height_m is not None:
            kwargs["storey_height_m"] = req.height_m
        return add_mumty(bm, **kwargs)

    # Defensive — ExtensionType is closed; if we get here the enum
    # was extended without updating this dispatch.
    raise ValueError(  # pragma: no cover
        f"Unknown ExtensionType: {ext_type!r}"
    )


def apply_extensions(
    bm: BuildingModel, plan: ExtensionPlan
) -> tuple[BuildingModel, Optional[ExtensionFailed]]:
    """Apply ``plan`` to ``bm``; return ``(final_bm, failure_envelope)``.

    See module docstring for the full behavioural contract. The
    returned BuildingModel always satisfies the 13 BuildingModel
    invariants because each extension internally re-runs
    ``BuildingModel.build`` after committing its entities; an
    invariant failure routes the offending extension to
    ``failed_extensions`` without contaminating the running BM with
    invalid geometry.
    """
    if plan.is_noop:
        return bm, None

    # Dedup by extension_type — first occurrence wins.
    requests_by_type: dict[ExtensionType, ExtensionRequest] = {}
    for req in plan.extensions:
        requests_by_type.setdefault(req.extension_type, req)

    failed_types: list[ExtensionType] = []
    failure_reasons: list[str] = []
    current_bm = bm

    for ext_type in _CANONICAL_ORDER:
        req = requests_by_type.get(ext_type)
        if req is None:
            continue
        try:
            current_bm = _dispatch(ext_type, current_bm, req)
        except ExtensionError as exc:
            failed_types.append(ext_type)
            failure_reasons.append(f"{ext_type.value}: {exc.reason}")
        except BuildingModelValidationError as exc:
            # An extension produced a BuildingModel that fails the 13
            # invariants; surface the precise rule_id so the user
            # learns WHY this geometry would be malformed.
            failed_types.append(ext_type)
            failure_reasons.append(
                f"{ext_type.value}: invariant {exc.rule_id} failed on "
                f"node '{exc.node_id}' — expected {exc.expected}; "
                f"got {exc.actual}"
            )

    if not failed_types:
        return current_bm, None

    if len(failed_types) == len(requests_by_type):
        # ALL requested extensions failed. Revert to input BM so the
        # adapter + IFC export still produces a buildable artifact.
        # current_bm is the input bm at this point because every
        # try-body assignment to current_bm raised before completing.
        return bm, ExtensionFailed(
            reason="all requested extensions failed: "
            + "; ".join(failure_reasons),
            suggested_action="ship_as_is",
            failed_extensions=failed_types,
        )

    # Partial success — keep extensions that succeeded, report failures.
    return current_bm, ExtensionFailed(
        reason="partial success: " + "; ".join(failure_reasons),
        suggested_action="skip_failed_extensions",
        failed_extensions=failed_types,
    )


__all__ = ["apply_extensions"]
