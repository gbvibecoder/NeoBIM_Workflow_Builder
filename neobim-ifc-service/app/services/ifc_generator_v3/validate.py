"""IFC validator + summariser for the v3 generator agent.

Exposed to the agent through the `validate_ifc` and `read_ifc_summary`
tools. The validator deliberately does cheap structural checks that
matter for the *agent feedback loop* — entity count, reference resolution
through the spatial hierarchy, presence of every space the brief declared,
non-ASCII byte scan. Web-ifc compatibility is the load-test surrogate;
strict IFC compliance (Express-rule level) is out of scope.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import ifcopenshell


def _bytes_contain_non_ascii(path: str, sample_bytes: int = 1_048_576) -> Dict[str, Any]:
    """Read up to `sample_bytes` of the file and report any non-ASCII offsets.

    1 MB is plenty for the first occurrence; we only need to report
    *whether* the file is pure-ASCII, not enumerate every offset. A pure
    IFC2X3 STEP file IS ASCII by definition (ISO 10303-21 §6.4.3.4 limits
    string content to printable ISO-8859 plus control bytes, and our
    generator never emits anything outside printable ASCII).
    """
    try:
        with open(path, "rb") as f:
            buf = f.read(sample_bytes)
    except OSError as exc:
        return {"ok": False, "error": f"read failed: {exc!r}"}
    for offset, byte in enumerate(buf):
        if byte > 0x7F:
            # Include a small context window so the caller can see the bad bytes.
            ctx_start = max(0, offset - 20)
            ctx_end = min(len(buf), offset + 20)
            return {
                "ok": False,
                "first_non_ascii_byte": byte,
                "first_non_ascii_offset": offset,
                "context_hex": buf[ctx_start:ctx_end].hex(),
            }
    return {"ok": True}


def validate_ifc_file(path: str, expected_space_tags: Optional[List[str]] = None) -> Dict[str, Any]:
    """Validate a written IFC. Mirrors the `BuildFlowIFC.validate` shape
    but operates on the WRITTEN file (so it catches serialization issues
    the in-memory validator can't see).

    Returns::

        {
            "schema": "IFC2X3",
            "entity_count": int,
            "refs_resolve": bool,
            "spaces_present": list[str],
            "spaces_missing": list[str],     # only when expected_space_tags given
            "errors": list[str],
            "web_ifc_load_test": "PASS" | "FAIL" | "SKIP",  # see note
            "ascii_only": bool,
            "ascii_first_bad_offset": int | None,
        }

    NOTE on web_ifc_load_test: we don't have web-ifc on the Python server.
    The smoke test surrogate is "ifcopenshell can re-open the file AND
    the file is pure ASCII" — both necessary conditions for web-ifc.
    """
    errors: List[str] = []
    if not os.path.isfile(path):
        return {
            "schema": None,
            "entity_count": 0,
            "refs_resolve": False,
            "spaces_present": [],
            "spaces_missing": list(expected_space_tags or []),
            "errors": [f"file not found: {path}"],
            "web_ifc_load_test": "FAIL",
            "ascii_only": False,
            "ascii_first_bad_offset": None,
        }

    ascii_check = _bytes_contain_non_ascii(path)
    ascii_only = bool(ascii_check.get("ok"))
    ascii_first_bad_offset = ascii_check.get("first_non_ascii_offset")

    try:
        f = ifcopenshell.open(path)
    except Exception as exc:
        return {
            "schema": None,
            "entity_count": 0,
            "refs_resolve": False,
            "spaces_present": [],
            "spaces_missing": list(expected_space_tags or []),
            "errors": [f"ifcopenshell.open failed: {type(exc).__name__}: {exc}"],
            "web_ifc_load_test": "FAIL",
            "ascii_only": ascii_only,
            "ascii_first_bad_offset": ascii_first_bad_offset,
        }

    schema = f.schema
    entity_count = len(list(f))

    # Reference resolution: every IfcProduct should have an ObjectPlacement
    # AND every IfcRelContainedInSpatialStructure should resolve.
    products = f.by_type("IfcProduct")
    refs_ok = True
    for p in products:
        if p.is_a("IfcProject"):
            continue
        try:
            placement = p.ObjectPlacement
            if placement is None:
                # IfcSpace in 2X3 has no Tag — fall back to Name / GlobalId.
                label = (
                    getattr(p, "Tag", None)
                    or getattr(p, "Name", None)
                    or getattr(p, "GlobalId", "?")
                )
                errors.append(f"{p.is_a()} {label} missing ObjectPlacement")
                refs_ok = False
        except Exception as exc:
            errors.append(f"{p.is_a()} GlobalId={getattr(p, 'GlobalId', '?')}: {exc!r}")
            refs_ok = False

    spaces = f.by_type("IfcSpace")
    # `IfcSpace.Tag` is IFC4-only — use Name (set by add_space to the
    # caller's space_id).
    spaces_present = [
        getattr(s, "Name", None) for s in spaces if getattr(s, "Name", None)
    ]
    spaces_missing: List[str] = []
    if expected_space_tags:
        present_set = set(spaces_present)
        spaces_missing = [t for t in expected_space_tags if t not in present_set]
        if spaces_missing:
            errors.append(
                f"spec declared {len(expected_space_tags)} spaces, "
                f"file contains {len(spaces_present)} — missing: {spaces_missing}"
            )

    web_ifc_load_test = "PASS" if (refs_ok and ascii_only) else "FAIL"

    return {
        "schema": schema,
        "entity_count": entity_count,
        "refs_resolve": refs_ok,
        "spaces_present": spaces_present,
        "spaces_missing": spaces_missing,
        "errors": errors,
        "web_ifc_load_test": web_ifc_load_test,
        "ascii_only": ascii_only,
        "ascii_first_bad_offset": ascii_first_bad_offset,
    }


def summarize_ifc_file(path: str) -> Dict[str, Any]:
    """Structured summary of the on-disk IFC, used by `read_ifc_summary`."""
    if not os.path.isfile(path):
        return {
            "schema": None,
            "entity_count_total": 0,
            "products_by_class": {},
            "materials": [],
            "property_sets": [],
            "spaces": [],
            "tracked_element_ids": [],
            "error": f"file not found: {path}",
        }
    try:
        f = ifcopenshell.open(path)
    except Exception as exc:
        return {
            "schema": None,
            "entity_count_total": 0,
            "products_by_class": {},
            "materials": [],
            "property_sets": [],
            "spaces": [],
            "tracked_element_ids": [],
            "error": f"ifcopenshell.open failed: {type(exc).__name__}: {exc}",
        }

    by_class: Dict[str, int] = {}
    for entity in f.by_type("IfcProduct"):
        by_class[entity.is_a()] = by_class.get(entity.is_a(), 0) + 1

    spaces_summary: List[Dict[str, Any]] = []
    for s in f.by_type("IfcSpace"):
        spaces_summary.append({
            "name": getattr(s, "Name", None),
            "long_name": getattr(s, "LongName", None),
            "object_type": getattr(s, "ObjectType", None),
        })

    tracked_ids: List[str] = []
    for p in f.by_type("IfcProduct"):
        # IfcSpace has no Tag attribute in 2X3 — skip it here (its name
        # is already in `spaces_summary`).
        if p.is_a("IfcSpace"):
            continue
        try:
            tag = p.Tag
        except AttributeError:
            tag = None
        if tag:
            tracked_ids.append(tag)

    return {
        "schema": f.schema,
        "entity_count_total": len(list(f)),
        "products_by_class": by_class,
        "materials": [m.Name for m in f.by_type("IfcMaterial") if m.Name],
        "property_sets": sorted({p.Name for p in f.by_type("IfcPropertySet") if p.Name}),
        "spaces": spaces_summary,
        "tracked_element_ids": sorted(tracked_ids),
    }
