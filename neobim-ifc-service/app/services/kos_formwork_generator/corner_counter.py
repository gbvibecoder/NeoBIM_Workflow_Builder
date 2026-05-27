"""Corner detection via plan_polyline endpoint clustering.

Reference: 5F-DESIGN v2 doc 02 §4 (Problem 2 — Corner detection).
FRB §7.2 (corner clamp catalog), FRB §7.1 RULE CJ-1 (corner unit installation).

Algorithm:
  1. For each non-custom wall, extract polyline endpoints (start + end).
  2. Cluster endpoints within tolerance (default 50mm).
  3. For each cluster with ≥2 wall endpoints:
     - 2 walls → compute interior angle → classify as '90', '135', or unsupported.
     - 3+ walls → 'T' junction.
  4. Determine corner clamp SKU thickness from THICKEST wall at the corner
     (per FRB §7.2 SKU mapping convention).
  5. Sort detected corners by (cluster_x, cluster_y) for deterministic output.

Custom-order walls are EXCLUDED from clustering (per DESIGN v2 doc 02 §4:
'curved/custom walls do not contribute geometric corners — they are routed
to custom_quotes by PR 4').
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Literal, Tuple

from app.services.kos_formwork_generator.exceptions import FormworkInputError
from app.services.kos_panel_grid_mapper.types import WallSegment

logger = logging.getLogger(__name__)


# ═════════════════════════════════════════════════════════════════════
# CONSTANTS
# ═════════════════════════════════════════════════════════════════════

#: Tolerance for clustering polyline endpoints (mm). Per DESIGN v2 §4.
_CLUSTER_TOLERANCE_MM: float = 50.0

#: Angle tolerance for 90°/135° classification (degrees).
_ANGLE_TOLERANCE_DEG: float = 5.0

#: System thickness order (thicker = higher priority for corner SKU selection).
_SYSTEM_THICKNESS_RANK: dict = {
    "K4-110": 110, "K6-150": 150, "K6-180": 180,
    "K8-200": 200, "K8-250": 250,
}


# ═════════════════════════════════════════════════════════════════════
# PUBLIC TYPES
# ═════════════════════════════════════════════════════════════════════


CornerType = Literal["90", "135", "T"]


@dataclass(frozen=True)
class CornerDetection:
    """A detected corner involving 2+ walls.

    Fields:
        corner_type: '90', '135', or 'T'.
        wall_ids: alphabetically-sorted tuple of involved wall_ids.
        system_used: system code (e.g., 'K6-150') determining corner clamp SKU.
            For mixed-system corners, the THICKEST system wins (FRB §7.2 convention).
        cluster_x_mm: cluster centroid X (used for deterministic sort).
        cluster_y_mm: cluster centroid Y.
        frb_source: FRB rule citation.
    """

    corner_type: CornerType
    wall_ids: Tuple[str, ...]
    system_used: str
    cluster_x_mm: float
    cluster_y_mm: float
    frb_source: str


# ═════════════════════════════════════════════════════════════════════
# INTERNAL HELPERS
# ═════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class _Endpoint:
    """One endpoint of a wall's plan_polyline."""

    wall_id: str
    system: str
    x_mm: float
    y_mm: float
    is_start: bool  # True = first polyline point; False = last
    inward_vec: Tuple[float, float]  # unit vector pointing AWAY from this endpoint along the polyline


def _polyline_endpoints(wall: WallSegment) -> Tuple[_Endpoint, _Endpoint]:
    """Extract the two endpoints of a wall's plan_polyline (start + end).

    Each endpoint carries the inward-pointing unit vector (along the polyline
    direction, away from the endpoint), used for angle computation at clusters.

    Raises:
        FormworkInputError: if polyline missing or has fewer than 2 points.
    """
    pl = wall.plan_polyline
    if pl is None or len(pl) < 2:
        raise FormworkInputError(
            f"Wall {wall.id!r} has plan_polyline length {len(pl) if pl else 0}; "
            f"need >= 2 points to determine corner geometry.",
            hint="Mapper should populate plan_polyline for every standard wall.",
        )

    p_start = pl[0]
    p_start_next = pl[1]
    dx_s, dy_s = p_start_next[0] - p_start[0], p_start_next[1] - p_start[1]
    mag_s = math.hypot(dx_s, dy_s)
    if mag_s < 1e-9:
        raise FormworkInputError(
            f"Wall {wall.id!r} polyline has degenerate start segment (zero length).",
        )
    inward_start = (dx_s / mag_s, dy_s / mag_s)

    p_end = pl[-1]
    p_end_prev = pl[-2]
    dx_e, dy_e = p_end_prev[0] - p_end[0], p_end_prev[1] - p_end[1]
    mag_e = math.hypot(dx_e, dy_e)
    if mag_e < 1e-9:
        raise FormworkInputError(
            f"Wall {wall.id!r} polyline has degenerate end segment (zero length).",
        )
    inward_end = (dx_e / mag_e, dy_e / mag_e)

    return (
        _Endpoint(
            wall_id=wall.id, system=wall.system,
            x_mm=float(p_start[0]), y_mm=float(p_start[1]),
            is_start=True, inward_vec=inward_start,
        ),
        _Endpoint(
            wall_id=wall.id, system=wall.system,
            x_mm=float(p_end[0]), y_mm=float(p_end[1]),
            is_start=False, inward_vec=inward_end,
        ),
    )


def _cluster_endpoints(
    endpoints: list, tolerance_mm: float,
) -> list:
    """Cluster endpoints within tolerance_mm of each other.

    Simple O(n²) clustering — sufficient for typical project sizes (≤ 100 walls).
    Each cluster is a list of _Endpoint instances.

    Returns:
        list of clusters (each a list of _Endpoint).
    """
    clusters: list = []
    visited: set = set()

    for i, ep in enumerate(endpoints):
        if i in visited:
            continue
        cluster = [ep]
        visited.add(i)
        for j, ep2 in enumerate(endpoints[i + 1:], start=i + 1):
            if j in visited:
                continue
            dist = math.hypot(ep2.x_mm - ep.x_mm, ep2.y_mm - ep.y_mm)
            if dist <= tolerance_mm:
                cluster.append(ep2)
                visited.add(j)
        clusters.append(cluster)
    return clusters


def _classify_two_wall_angle(ep_a: _Endpoint, ep_b: _Endpoint) -> CornerType:
    """Classify the interior angle between two walls meeting at a cluster.

    Uses dot product of inward-pointing unit vectors.

    Returns:
        '90' if angle within 90° ± _ANGLE_TOLERANCE_DEG.
        '135' if angle within 135° ± _ANGLE_TOLERANCE_DEG.

    Raises:
        FormworkInputError: if angle is neither 90° nor 135° (unsupported geometry).
    """
    ax, ay = ep_a.inward_vec
    bx, by = ep_b.inward_vec
    dot = ax * bx + ay * by
    # Clamp dot for numerical safety
    dot_clamped = max(-1.0, min(1.0, dot))
    angle_rad = math.acos(dot_clamped)
    angle_deg = math.degrees(angle_rad)

    if abs(angle_deg - 90.0) <= _ANGLE_TOLERANCE_DEG:
        return "90"
    if abs(angle_deg - 135.0) <= _ANGLE_TOLERANCE_DEG:
        return "135"
    raise FormworkInputError(
        f"Unsupported corner angle {angle_deg:.2f}° between walls "
        f"{ep_a.wall_id!r} and {ep_b.wall_id!r}. "
        f"FRB §7.2 supports 90° and 135° only.",
        hint="Route as custom_quote in PR 4 (reason='non_standard_corner_angle').",
    )


def _select_corner_system(involved_systems: list) -> str:
    """Pick the system for corner clamp SKU determination.

    Convention (per FRB §7.2 + DESIGN v2): use the THICKEST system involved.
    Ties broken alphabetically (stable, deterministic).

    Returns:
        System code (e.g., 'K8-200').

    Raises:
        FormworkInputError: if any system is unknown.
    """
    unknowns = [s for s in involved_systems if s not in _SYSTEM_THICKNESS_RANK]
    if unknowns:
        raise FormworkInputError(
            f"Cannot determine corner SKU: unknown system(s) {sorted(set(unknowns))} "
            f"not in {sorted(_SYSTEM_THICKNESS_RANK.keys())}.",
            hint="Custom-thickness walls should not reach corner_counter; "
            "they're routed to custom_quotes by PR 4.",
        )
    # Sort by (thickness desc, system asc) for determinism
    return sorted(
        set(involved_systems),
        key=lambda s: (-_SYSTEM_THICKNESS_RANK[s], s),
    )[0]


# ═════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═════════════════════════════════════════════════════════════════════


def count_corners(
    wall_segments: Tuple[WallSegment, ...],
    *,
    tolerance_mm: float = _CLUSTER_TOLERANCE_MM,
) -> Tuple[CornerDetection, ...]:
    """Detect all corners in a project by clustering plan_polyline endpoints.

    Args:
        wall_segments: All walls from mapper output. Custom-order walls are excluded.
        tolerance_mm: Endpoint clustering tolerance (default 50mm).

    Returns:
        Tuple of CornerDetection, sorted by (cluster_x_mm, cluster_y_mm) ascending.
        Returns empty tuple if no corners detected (e.g., single wall, or all walls
        free-standing without shared endpoints).

    Raises:
        FormworkInputError: if any non-custom wall has malformed plan_polyline,
                             or if a detected corner has unsupported angle,
                             or if a corner involves unknown systems.
    """
    logger.debug("count_corners: %d wall(s) input, tolerance=%.1fmm",
                 len(wall_segments), tolerance_mm)

    if not wall_segments:
        return ()

    # Skip custom-order walls — they have curved/non-standard geometry
    # and are routed to custom_quotes (per DESIGN v2 doc 02 §4).
    standard_walls = [w for w in wall_segments if not getattr(w, "is_custom_order", False)]
    if len(standard_walls) < 2:
        # Need at least 2 walls to form a corner
        logger.debug("count_corners: only %d standard wall(s); no corners possible",
                     len(standard_walls))
        return ()

    # Extract all endpoints
    endpoints: list = []
    for w in standard_walls:
        ep_start, ep_end = _polyline_endpoints(w)
        endpoints.append(ep_start)
        endpoints.append(ep_end)

    # Cluster
    clusters = _cluster_endpoints(endpoints, tolerance_mm)

    # Classify each cluster
    corners: list = []
    for cluster in clusters:
        # Count unique walls in cluster (a single wall could contribute both endpoints
        # if it's a tiny loop — degenerate; skip).
        unique_walls = sorted({ep.wall_id for ep in cluster})
        if len(unique_walls) < 2:
            # Single wall ending in isolation; not a corner.
            continue

        # Compute cluster centroid (for sorting)
        cx = sum(ep.x_mm for ep in cluster) / len(cluster)
        cy = sum(ep.y_mm for ep in cluster) / len(cluster)

        if len(unique_walls) == 2:
            # Two walls: classify angle.
            # Take one endpoint per wall (the one in this cluster).
            eps_by_wall = {ep.wall_id: ep for ep in cluster}
            ep_a = eps_by_wall[unique_walls[0]]
            ep_b = eps_by_wall[unique_walls[1]]
            corner_type = _classify_two_wall_angle(ep_a, ep_b)
            frb_source = "FRB §7.2 (corner clamp catalog) + §7.1 RULE CJ-1"
        else:
            # 3+ walls: T-junction
            corner_type = "T"
            frb_source = "FRB §7.2 (T-junction clamps) + §7.1 RULE CJ-1"

        # Determine corner SKU system (thickest wall wins)
        involved_systems = [ep.system for ep in cluster if ep.wall_id in unique_walls]
        system_used = _select_corner_system(involved_systems)

        corners.append(
            CornerDetection(
                corner_type=corner_type,
                wall_ids=tuple(unique_walls),
                system_used=system_used,
                cluster_x_mm=cx,
                cluster_y_mm=cy,
                frb_source=frb_source,
            )
        )

    # Deterministic sort by (x, y)
    corners.sort(key=lambda c: (c.cluster_x_mm, c.cluster_y_mm))

    logger.debug("count_corners: %d corner(s) detected", len(corners))
    return tuple(corners)
