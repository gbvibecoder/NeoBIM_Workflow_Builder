"""KOS drawing geometry — format-agnostic wall/thickness/junction primitives.

Shared by both the DXF parser (``kos_dxf_parser``) and the PDF parser
(``kos_pdf_parser``). Everything here is pure: it operates on wall dicts and
(x, y) tuples already expressed in **millimetres**, with NO dependency on
``ezdxf`` or ``fitz``. Extracted from ``kos_dxf_parser`` in Week 5C-2 so the
PDF parser can reuse it without duplication; the DXF parser re-imports these
names, so its behaviour is byte-identical (pure functions, identical literals).

Contains: the canonical wall-dict builder (:func:`_seg_to_wall`), the
non-exclusive thickness-enrichment pass (:func:`_enrich_thickness`) and its
geometry helpers, and junction clustering (:func:`_detect_junctions`).
"""

from __future__ import annotations

import math

# Walls shorter than this (in mm) are treated as noise (dimension ticks,
# hatch fragments, leader stubs) and dropped.
MIN_WALL_LENGTH_MM = 100.0

# Junction clustering tolerance — endpoints within this distance (mm) are
# considered to meet at the same point.
JUNCTION_TOLERANCE_MM = 20.0

# Parallel-pair geometry band: a parallel partner must sit between these
# perpendicular distances (mm) to read as the two faces of one wall.
WALL_THICKNESS_MIN_MM = 50.0
WALL_THICKNESS_MAX_MM = 500.0

# Thickness enrichment (post-detection, non-exclusive parallel-partner pass).
THICKNESS_ANGLE_TOL_DEG = 3.0       # partner must be parallel within this many °
THICKNESS_MIN_OVERLAP_FRAC = 0.30   # partner must overlap >30% of the wall's axis
THICKNESS_MAX_WALLS = 4000          # O(n²) guard; skip + warn above this


# ── small geometry helpers ──────────────────────────────────────────────


def _length(ax: float, ay: float, bx: float, by: float) -> float:
    return math.hypot(bx - ax, by - ay)


def _angle_deg(ax: float, ay: float, bx: float, by: float) -> float:
    """0 = horizontal, 90 = vertical. Normalised to [0, 180)."""
    return math.degrees(math.atan2(by - ay, bx - ax)) % 180.0


def _seg_to_wall(
    idx: int,
    ax: float,
    ay: float,
    bx: float,
    by: float,
    mult: float,
    layer: str,
    tier: int,
    confidence: float,
    thickness_mm: float | None,
) -> dict | None:
    """Build a wall dict in millimetres, or None if below the noise floor.

    ``mult`` scales the input coordinates into millimetres (DXF: unit
    multiplier; PDF: pass already-mm coords with ``mult=1``).
    """
    sx, sy, ex, ey = ax * mult, ay * mult, bx * mult, by * mult
    length = _length(sx, sy, ex, ey)
    if length < MIN_WALL_LENGTH_MM:
        return None
    return {
        "id": f"w{idx}",
        "start": [round(sx, 2), round(sy, 2)],
        "end": [round(ex, 2), round(ey, 2)],
        "length_mm": round(length, 2),
        "thickness_mm": round(thickness_mm, 2) if thickness_mm is not None else None,
        "angle_degrees": round(_angle_deg(sx, sy, ex, ey), 2),
        "layer": layer,
        "detection_tier": tier,
        "confidence": round(confidence, 2),
    }


# ── thickness enrichment (post-detection, non-exclusive) ────────────────────


def _perp_distance(ax: float, ay: float, ux: float, uy: float,
                   px: float, py: float) -> float:
    """Perpendicular distance of point (px, py) to the line through (ax, ay)
    with unit direction (ux, uy)."""
    nx, ny = -uy, ux
    return abs((px - ax) * nx + (py - ay) * ny)


def _projected_overlap(ax: float, ay: float, ux: float, uy: float, length: float,
                       cx: float, cy: float, dx: float, dy: float) -> float:
    """Length of segment (c→d)'s projection onto the [0, length] axis of a wall
    anchored at (ax, ay) with unit direction (ux, uy)."""
    t1 = (cx - ax) * ux + (cy - ay) * uy
    t2 = (dx - ax) * ux + (dy - ay) * uy
    lo, hi = (t1, t2) if t1 <= t2 else (t2, t1)
    return min(hi, length) - max(lo, 0.0)


def _enrich_thickness(walls: list[dict], msp, warnings: list[str]) -> None:
    """Fill ``thickness_mm`` on walls that still lack it (Option X+).

    For each wall whose thickness is None, scan the same wall set for parallel
    partners (within ``THICKNESS_ANGLE_TOL_DEG``) that sit side-by-side (overlap
    > ``THICKNESS_MIN_OVERLAP_FRAC`` of the axis) within the [MIN, MAX] mm band,
    and assign the CLOSEST (minimum) qualifying perpendicular offset — the
    nearest parallel partner is the opposite face of the same wall.

    Non-exclusive: a partner is never consumed and may serve several walls.
    Never overwrites a thickness a tier already computed (e.g. DXF tier-2).
    ``msp`` is accepted for the future Option-Y cross-layer search; unused here.
    """
    n = len(walls)
    if n < 2:
        return
    if n > THICKNESS_MAX_WALLS:
        warnings.append(
            f"thickness enrichment skipped: {n} walls exceeds cap "
            f"{THICKNESS_MAX_WALLS} (O(n^2) guard)"
        )
        return

    # Precompute axis (unit direction), length, angle, midpoint per wall.
    geom: list[tuple | None] = []
    for w in walls:
        ax, ay = w["start"]
        bx, by = w["end"]
        L = math.hypot(bx - ax, by - ay)
        if L <= 0:
            geom.append(None)
            continue
        ux, uy = (bx - ax) / L, (by - ay) / L
        geom.append((ax, ay, ux, uy, L, w["angle_degrees"],
                     (ax + bx) / 2.0, (ay + by) / 2.0))

    for i in range(n):
        if walls[i]["thickness_mm"] is not None:
            continue
        gi = geom[i]
        if gi is None:
            continue
        ax, ay, ux, uy, li, ang_i = gi[0], gi[1], gi[2], gi[3], gi[4], gi[5]
        best = math.inf
        for j in range(n):
            if j == i:
                continue
            gj = geom[j]
            if gj is None:
                continue
            da = abs(ang_i - gj[5])
            if da > THICKNESS_ANGLE_TOL_DEG and da < 180.0 - THICKNESS_ANGLE_TOL_DEG:
                continue
            d = _perp_distance(ax, ay, ux, uy, gj[6], gj[7])
            if d < WALL_THICKNESS_MIN_MM or d > WALL_THICKNESS_MAX_MM:
                continue
            cx, cy = walls[j]["start"]
            dxp, dyp = walls[j]["end"]
            ov = _projected_overlap(ax, ay, ux, uy, li, cx, cy, dxp, dyp)
            if ov <= THICKNESS_MIN_OVERLAP_FRAC * li:
                continue
            if d < best:
                best = d
        if best != math.inf:
            walls[i]["thickness_mm"] = round(best, 2)


# ── junctions ─────────────────────────────────────────────────────────────


def _detect_junctions(walls: list[dict], warnings: list[str]) -> list[dict]:
    """Cluster wall endpoints; classify CORNER / T_JOIN / X_JOIN / END."""
    try:
        # Bucket endpoints onto a grid so clustering is O(n) not O(n²).
        cell = JUNCTION_TOLERANCE_MM
        grid: dict[tuple[int, int], list[tuple[float, float, str]]] = {}
        for w in walls:
            for (x, y) in (w["start"], w["end"]):
                key = (int(x // cell), int(y // cell))
                grid.setdefault(key, []).append((x, y, w["id"]))

        junctions: list[dict] = []
        seen: set[tuple[int, int]] = set()
        for key, pts in grid.items():
            if key in seen:
                continue
            seen.add(key)
            # Merge the 8 neighbours so a point near a cell border still groups.
            members = list(pts)
            cx, cy = key
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    nkey = (cx + dx, cy + dy)
                    if nkey in grid and nkey not in seen:
                        members.extend(grid[nkey])
                        seen.add(nkey)
            wall_ids = {m[2] for m in members}
            n = len(wall_ids)
            if n < 2:
                kind = "END"
            elif n == 2:
                kind = "CORNER"
            elif n == 3:
                kind = "T_JOIN"
            elif n == 4:
                kind = "X_JOIN"
            else:
                kind = "END"
            ax = sum(m[0] for m in members) / len(members)
            ay = sum(m[1] for m in members) / len(members)
            junctions.append({
                "point": [round(ax, 2), round(ay, 2)],
                "type": kind,
                "wall_count": n,
                "wall_ids": sorted(wall_ids),
            })
        return junctions
    except Exception as exc:  # noqa: BLE001 — best-effort feature
        warnings.append(f"junction detection failed ({type(exc).__name__}: {exc})")
        return []
