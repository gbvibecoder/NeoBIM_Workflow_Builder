"""Tier-2 BuildingModel templates.

Each template is a pure-Python builder that returns a `BuildingModel`
satisfying all 12 Phase-1 invariants. Callers may pass plot dimensions
and other parameters to scale the template; internal coordinates derive
from the parameters so the same builder produces a valid BuildingModel
across a range of plot sizes.
"""

from __future__ import annotations

from app.templates.tier2_2bhk_pune import (
    build_2bhk_pune_duplex,
    build_2bhk_pune_template,
)
from app.templates.tier2_2bhk_pune_house import build_2bhk_pune_house
from app.templates.tier2_2bhk_pune_tower import build_2bhk_pune_tower

__all__ = [
    "build_2bhk_pune_duplex",
    "build_2bhk_pune_house",
    "build_2bhk_pune_template",
    "build_2bhk_pune_tower",
]
