"""Deterministic IFC builders — one module per archetype.

Phase G ships the `office` builder. Other archetypes are Phase H.
"""

from .office_builder import build_office

__all__ = ["build_office"]
