"""India-specific reference data for the design agent.

NBC India 2016 minimum room sizes, IS 1893 seismic zones, IS 875 wind
zones. These are deterministic table lookups — the LLM does not invent
values for any of them; it emits a city name and the BriefAnalyst's
post-processing step looks up the zones / minimums from these modules.
"""

from app.services.design_agent.reference_data.nbc_india_minimums import (
    DEFAULT_RERA_RATIOS,
    NBC_MIN_AREAS_SQM,
    NBC_MIN_LINEAR,
    assert_room_usage_coverage,
    get_nbc_min_area_sqm,
)
from app.services.design_agent.reference_data.seismic_zones_in import (
    IS_1893_ZONES,
    ZONE_FACTOR,
    lookup_seismic_zone,
    lookup_zone_factor,
)
from app.services.design_agent.reference_data.wind_zones_in import (
    IS_875_ZONES,
    VB_BY_ZONE,
    lookup_basic_wind_speed_mps,
    lookup_wind_zone,
)

__all__ = [
    # NBC
    "NBC_MIN_AREAS_SQM",
    "NBC_MIN_LINEAR",
    "DEFAULT_RERA_RATIOS",
    "get_nbc_min_area_sqm",
    "assert_room_usage_coverage",
    # Seismic
    "IS_1893_ZONES",
    "ZONE_FACTOR",
    "lookup_seismic_zone",
    "lookup_zone_factor",
    # Wind
    "IS_875_ZONES",
    "VB_BY_ZONE",
    "lookup_wind_zone",
    "lookup_basic_wind_speed_mps",
]
