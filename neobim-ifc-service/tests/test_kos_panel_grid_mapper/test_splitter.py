"""Tests for the splitter dispatcher (splitter.split_wall_to_panels).

Coverage:
  - Dispatches to the correct strategy module
  - Unknown strategy raises KeyError
  - SplitResult.strategy_used echoes the dispatched strategy
"""

from __future__ import annotations

import pytest

from app.services.kos_panel_grid_mapper import (
    SplitInput,
    SplitResult,
    split_wall_to_panels,
)


def _p_int_8_input(strategy: str) -> SplitInput:
    """Build a minimal P_INT_8-style SplitInput parametrized by strategy."""
    return SplitInput(
        segment_id="P_INT_8",
        segment_length_mm=2101.0,
        segment_height_mm=3000,
        system="K4-110",
        sku_thickness_mm=110,
        application="internal",
        strategy=strategy,  # type: ignore[arg-type]
        first_panel_reservation=None,
        last_panel_reservation=None,
        neighbour_covered_left_mm=0.0,
        neighbour_covered_right_mm=0.0,
        openings=(),
    )


@pytest.mark.parametrize("strategy", ["minimize_cuts", "minimize_panels", "symmetric"])
def test_dispatcher_routes_to_each_strategy(strategy: str) -> None:
    result = split_wall_to_panels(_p_int_8_input(strategy))
    assert isinstance(result, SplitResult)
    assert result.strategy_used == strategy
    assert len(result.panels) >= 2   # at least 2 horizontal bands


def test_unknown_strategy_raises_keyerror() -> None:
    inp = _p_int_8_input("minimize_cuts")
    # Construct a frozen-replaced SplitInput with an invalid strategy.
    import dataclasses
    bad = dataclasses.replace(inp, strategy="not_a_strategy")  # type: ignore[arg-type]
    with pytest.raises(KeyError):
        split_wall_to_panels(bad)


def test_default_strategy_is_minimize_cuts_per_policy() -> None:
    """POLICY-DEFAULT-STRATEGY-B: minimize_cuts is the project-wide default.
    Verify the dispatcher accepts it as a valid key."""
    result = split_wall_to_panels(_p_int_8_input("minimize_cuts"))
    assert result.strategy_used == "minimize_cuts"


def test_determinism_repeated_dispatches() -> None:
    inp = _p_int_8_input("minimize_cuts")
    a = split_wall_to_panels(inp)
    b = split_wall_to_panels(inp)
    assert a == b
