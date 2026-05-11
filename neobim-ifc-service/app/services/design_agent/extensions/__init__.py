"""Slice 2B.3 — BuildingModel extension primitives.

Five extension primitives that augment a Tier-2 BuildingModel with
optional features common in Indian residential briefs:

  * compound_wall    — perimeter brick wall around the plot
  * entry_gate       — main gate at the front compound wall
  * car_porch        — covered parking in the front setback
  * servant_quarter  — small bedroom + bath at the rear setback
  * mumty            — stair-access room on the roof

Each primitive is a pure function that takes a BuildingModel and
returns a new BuildingModel. They are composable, deterministic, and
preserve the 13 BuildingModel invariants (re-validated via
``BuildingModel.build``).

Extensions run **before** the 2B.2 adapter — the planner LLM reasons
in template-space (north-front), and the adapter transforms extension
geometry alongside the rest of the building.

The orchestrator :func:`apply_extensions` (in
``transforms_extensions.py``) coordinates per-extension application
in canonical order with per-extension try / except so a single
failure doesn't cascade. Import directly:

    from app.services.design_agent.transforms_extensions import apply_extensions

(A re-export from this package is intentionally NOT provided —
the orchestrator imports per-extension modules from
``extensions._common`` and ``extensions.compound_wall`` etc., so
re-exporting back from here creates a circular import.)
"""
