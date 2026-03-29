"""Geometry utility functions for polygon operations."""

from __future__ import annotations

import math
from typing import Sequence

from app.models.request import FootprintPoint, Vertex


def polygon_area(pts: Sequence[FootprintPoint]) -> float:
    """Compute area of a 2D polygon using the shoelace formula."""
    n = len(pts)
    if n < 3:
        return 0.0
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += pts[i].x * pts[j].y
        area -= pts[j].x * pts[i].y
    return abs(area) / 2.0


def polygon_centroid(pts: Sequence[FootprintPoint]) -> tuple[float, float]:
    """Compute centroid of a 2D polygon."""
    n = len(pts)
    if n == 0:
        return (0.0, 0.0)
    cx = sum(p.x for p in pts) / n
    cy = sum(p.y for p in pts) / n
    return (cx, cy)


def polygon_perimeter(pts: Sequence[FootprintPoint]) -> float:
    """Compute perimeter of a 2D polygon."""
    n = len(pts)
    if n < 2:
        return 0.0
    total = 0.0
    for i in range(n):
        j = (i + 1) % n
        dx = pts[j].x - pts[i].x
        dy = pts[j].y - pts[i].y
        total += math.sqrt(dx * dx + dy * dy)
    return total


def edge_length(p1: FootprintPoint, p2: FootprintPoint) -> float:
    """Distance between two 2D points."""
    dx = p2.x - p1.x
    dy = p2.y - p1.y
    return math.sqrt(dx * dx + dy * dy)


def edge_midpoint(p1: FootprintPoint, p2: FootprintPoint) -> tuple[float, float]:
    """Midpoint of a 2D edge."""
    return ((p1.x + p2.x) / 2.0, (p1.y + p2.y) / 2.0)


def edge_direction(p1: FootprintPoint, p2: FootprintPoint) -> tuple[float, float]:
    """Unit direction vector from p1 to p2."""
    dx = p2.x - p1.x
    dy = p2.y - p1.y
    length = math.sqrt(dx * dx + dy * dy)
    if length < 1e-9:
        return (1.0, 0.0)
    return (dx / length, dy / length)
