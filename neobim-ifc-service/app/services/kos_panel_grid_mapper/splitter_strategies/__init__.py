"""Splitter strategies registry.

Re-exports the 3 strategy functions for convenient import. The dispatcher
in `splitter.py` maps SplitInput.strategy to the appropriate function via
`_STRATEGY_REGISTRY`.

Public API:
  - split_minimize_cuts (Strategy B — DEFAULT, POLICY-DEFAULT-STRATEGY-B)
  - split_minimize_panels (Strategy A — custom-width ALL APs for min count)
  - split_symmetric (Strategy C — half-residual at AP-run ends)
"""

from .minimize_cuts import split_minimize_cuts
from .minimize_panels import split_minimize_panels
from .symmetric import split_symmetric

__all__ = [
    "split_minimize_cuts",
    "split_minimize_panels",
    "split_symmetric",
]
