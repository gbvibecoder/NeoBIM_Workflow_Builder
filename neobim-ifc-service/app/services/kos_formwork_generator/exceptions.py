"""Exception hierarchy for KOS Formwork Quantities Generator.

Four exception classes mirroring BOQ generator's pattern (verified Pre-flight C).
PR 6 HTTP router will map: FormworkInputError → 422; all others → 500.

Reference: 5F-DESIGN v2 doc 01_SCHEMA.md §17.
"""
from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)


class FormworkError(Exception):
    """Base exception for all 5F Formwork generation errors.

    All Formwork-specific exceptions inherit from this class. Each subclass
    defines an ``error_code`` class attribute used by the HTTP router (PR 6)
    to populate the JSON error response body.

    Args:
        message: human-readable error message (also accessible as ``self.message``).
        hint: optional remediation hint for the caller.

    Attributes:
        message: the error message string.
        hint: the optional remediation hint (None if not provided).
        error_code: class-level identifier (e.g., ``"FORMWORK_UNSPECIFIED"``).
    """

    error_code: str = "FORMWORK_UNSPECIFIED"

    def __init__(self, message: str, *, hint: Optional[str] = None) -> None:
        super().__init__(message)
        self.message: str = message
        self.hint: Optional[str] = hint

    def __repr__(self) -> str:
        return (
            f"{type(self).__name__}("
            f"error_code={self.error_code!r}, "
            f"message={self.message!r}, "
            f"hint={self.hint!r})"
        )


class FormworkConfigError(FormworkError):
    """Raised when 5F internal configuration (constants, lookup tables) is malformed.

    Indicates a programmer error in the 5F generator setup (e.g., SKU catalog
    contains duplicate codes, lookup table has wrong row count, FRB citation
    missing). PR 6 router maps this to HTTP 500.
    """

    error_code = "FORMWORK_CONFIG_BROKEN"


class FormworkInputError(FormworkError):
    """Raised when ``FormworkInput`` (mapper output or context) is invalid.

    Indicates upstream input is wrong — typically a caller/integration error.
    PR 6 router maps this to HTTP 422 (unprocessable entity).
    """

    error_code = "FORMWORK_INPUT_INVALID"


class FormworkInvariantError(FormworkError):
    """Raised when ``FormworkGeneratorOutput`` violates one of the 20 invariants.

    Indicates a bug in a 5F algorithm module (PR 2-5). Should never reach
    a customer in production — fails closed via the PR 4 validator. PR 6
    router maps this to HTTP 500.

    Args:
        message: human-readable invariant violation message.
        invariant_id: stable identifier (e.g., ``"F-7"``) for the violated invariant.
        hint: optional remediation hint.

    Attributes:
        invariant_id: e.g., ``"F-7"``.
    """

    error_code = "FORMWORK_OUTPUT_INVARIANT_VIOLATED"

    def __init__(
        self,
        message: str,
        *,
        invariant_id: str,
        hint: Optional[str] = None,
    ) -> None:
        super().__init__(message, hint=hint)
        self.invariant_id: str = invariant_id

    def __repr__(self) -> str:
        return (
            f"{type(self).__name__}("
            f"error_code={self.error_code!r}, "
            f"invariant_id={self.invariant_id!r}, "
            f"message={self.message!r}, "
            f"hint={self.hint!r})"
        )


logger.debug("5F exception classes loaded (4 classes)")
