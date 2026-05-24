"""
Mapper exception hierarchy. DESIGN.md §6 + 03_MODULE_LAYOUT.md §F.3.

Each exception has an `error_code` attribute for clean HTTP translation in the router.
Algorithm modules raise; orchestrator catches and translates.
"""

from __future__ import annotations


class MapperError(Exception):
    """Base class for all mapper-emitted errors. Never raised directly."""

    error_code: str = "MAPPER_ERROR"


class MapperInputError(MapperError):
    """Raised when the input (ParserOutput + ProjectContext) fails validation.

    Caught by the router → HTTP 400 Bad Request.

    Examples:
      - parser_output.walls is empty
      - thickness_mm is None on > 50% of walls
      - drawing_classification is not "FLOOR_PLAN"
      - seismic_zone not in {II, III, IV, V}
    """

    error_code: str = "MAPPER_INPUT_INVALID"


class OutputInvariantError(MapperError):
    """Raised when the mapper's own output fails one of the 21 validation invariants.

    This is a 'should never happen' condition — it indicates an algorithm bug.
    Caught by the router → HTTP 500 Internal Server Error.

    Examples:
      - C-1 length-sum check failed
      - panel.area_sqft != (cut_length × width) / 92903.04
      - total_cost_inr != sum of all panel.price_inr
    """

    error_code: str = "MAPPER_OUTPUT_INVARIANT_FAILED"


class CustomQuoteRequired(MapperError):
    """Raised when a wall uses a thickness Kalzen cannot manufacture as standard.

    NOT an HTTP error. Caught by the orchestrator and translated into a
    CustomQuoteRequest entry in the 200 OK output. The output is still emitted —
    the caller just needs to hand off to sales for that wall.

    Examples:
      - thickness >= 275mm detected
      - thickness < 100mm detected (sub-standard thin)
    """

    error_code: str = "MAPPER_CUSTOM_QUOTE_REQUIRED"

    def __init__(self, message: str, wall_segment_id: str, thickness_mm: float):
        super().__init__(message)
        self.wall_segment_id = wall_segment_id
        self.thickness_mm = thickness_mm
