"""
Splitter dispatcher — Problem 4 of the mapper pipeline. DESIGN.md §6.5.

Tiny dispatcher: looks up the chosen SplitStrategy and delegates to the
matching strategy module in splitter_strategies/. All the real work lives
in the strategy modules; this file just routes.

Strategies:
  - "minimize_cuts"   → splitter_strategies.minimize_cuts.split_minimize_cuts (DEFAULT)
  - "minimize_panels" → splitter_strategies.minimize_panels.split_minimize_panels
  - "symmetric"       → splitter_strategies.symmetric.split_symmetric

Determinism: pure function. Same SplitInput ⇒ same SplitResult byte-for-byte.
"""

from __future__ import annotations

from typing import Callable

from .splitter_strategies import (
    split_minimize_cuts,
    split_minimize_panels,
    split_symmetric,
)
from .types import SplitInput, SplitResult, SplitStrategy

_STRATEGY_REGISTRY: dict[SplitStrategy, Callable[[SplitInput], SplitResult]] = {
    "minimize_cuts":   split_minimize_cuts,
    "minimize_panels": split_minimize_panels,
    "symmetric":       split_symmetric,
}


def split_wall_to_panels(inp: SplitInput) -> SplitResult:
    """Dispatch a SplitInput to the appropriate strategy implementation.

    Raises:
      KeyError: if inp.strategy is not one of the 3 registered strategies.
                This indicates an upstream bug (the orchestrator should
                validate the strategy before calling).
    """
    strategy_fn = _STRATEGY_REGISTRY[inp.strategy]
    return strategy_fn(inp)
