"""BOQ Generator exception hierarchy.

4-class tree::

    BOQError (base)
      ├── BOQInputError      → HTTP 400 (caller's input invalid; IV-1..IV-8)
      ├── BOQInvariantError  → HTTP 500 (computed BOQ violates hard invariant)
      └── BOQConfigError     → HTTP 500 (BOQ configuration broken; runtime fault)

The router (PR 6) translates these to HTTP status codes via ``error_code``
attributes. Each subclass has a stable, machine-readable error_code that
clients can switch on.

Source: 01_SCHEMA.md §A (input validation) + §C (output invariants).
"""

from __future__ import annotations

from typing import Optional


class BOQError(Exception):
    """Base class for all BOQ Generator errors.

    Carries an ``error_code`` attribute for stable router translation.
    The optional ``hint`` provides diagnostic guidance to the caller.

    Never raised directly — always subclass.
    """

    error_code: str = "BOQ_UNSPECIFIED"

    def __init__(self, message: str, *, hint: Optional[str] = None):
        super().__init__(message)
        self.hint = hint


class BOQInputError(BOQError):
    """Caller-supplied input is invalid (HTTP 400).

    Raised for IV-1 through IV-8 violations from 01_SCHEMA.md §A:

    * IV-1: project_id empty or whitespace
    * IV-2: quote_date not valid ISO 8601 date
    * IV-3: quote_validity_days outside [1, 365]
    * IV-4: tax_rate_percent outside [0, 100]
    * IV-5: discount_percent outside [0, 100]
    * IV-6: currency not in SUPPORTED_CURRENCIES
    * IV-7: mapper_output schema invalid (not PanelGridMapperOutput dataclass)
    * IV-8: deterministic_id_seed not None and not valid string
    """

    error_code: str = "BOQ_INPUT_INVALID"


class BOQInvariantError(BOQError):
    """Computed BOQ violates a hard invariant (B-1 through B-23).

    Algorithm bug — should NEVER happen in production. Router maps to HTTP 500.

    The error carries ``invariant_id`` (e.g. ``"B-1"``) and the failing
    arithmetic detail in the message so the bug is diagnosable.
    """

    error_code: str = "BOQ_OUTPUT_INVARIANT_VIOLATED"

    def __init__(
        self,
        message: str,
        *,
        invariant_id: str,
        hint: Optional[str] = None,
    ):
        super().__init__(message, hint=hint)
        self.invariant_id = invariant_id


class BOQConfigError(BOQError):
    """BOQ configuration is broken.

    Detected at import time via the runtime assert in ``constants.py``, or at
    orchestrator boundary if a required mapper re-export is missing.
    Router maps to HTTP 500.
    """

    error_code: str = "BOQ_CONFIG_BROKEN"
