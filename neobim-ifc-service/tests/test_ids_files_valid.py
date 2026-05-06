"""Phase 0 — IDS file structural validity.

Asserts every IDS file is well-formed XML, conforms to the buildingSMART
IDS 1.0 schema, and meets the per-file minimum rule count from the
Phase 0 spec. This is the cheapest gate in the IDS suite: the file
either parses or it doesn't, and the rule-count floor catches a
regression where a future PR accidentally drops half the rules.

The XSD-validation step is best-effort: if the XSD is not reachable
(no network, no `ifctester` installed) we fall back to well-formedness
+ rule-count checks. CI installs `ifctester` and the XSD is bundled
with the package, so the strict path runs there.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

IDS_DIR = Path(__file__).parent.parent / "ids"
IDS_NS = "{http://standards.buildingsmart.org/IDS}"

# Per-file minimum rule counts from the Phase 0 prompt §R1. A future
# refactor that reduces rule count below the floor must update these
# pins AND justify the reduction in the PR description — Phase 0's
# whole point is that the rule set is the contract.
MIN_RULES: dict[str, int] = {
    "core.ids": 8,
    "lod-300.ids": 12,
    "lod-350.ids": 10,
    "architectural.ids": 15,
    "structural.ids": 12,
    "mep.ids": 10,
}


def _ids_files() -> list[Path]:
    return sorted(IDS_DIR.glob("*.ids"))


def test_ids_directory_exists():
    assert IDS_DIR.is_dir(), f"Expected {IDS_DIR} to exist"


def test_ids_directory_contains_six_files():
    files = _ids_files()
    names = {f.name for f in files}
    expected = set(MIN_RULES.keys())
    assert names == expected, (
        f"IDS dir should contain exactly {sorted(expected)}, "
        f"got {sorted(names)}"
    )


@pytest.mark.parametrize("filename", sorted(MIN_RULES.keys()))
def test_ids_file_is_well_formed_xml(filename: str):
    path = IDS_DIR / filename
    # Will raise ParseError on malformed XML.
    ET.parse(path)


@pytest.mark.parametrize("filename", sorted(MIN_RULES.keys()))
def test_ids_file_meets_minimum_rule_count(filename: str):
    """Every IDS file must contain at least the floor rule count."""
    path = IDS_DIR / filename
    tree = ET.parse(path)
    specs = list(tree.iter(f"{IDS_NS}specification"))
    minimum = MIN_RULES[filename]
    assert len(specs) >= minimum, (
        f"{filename}: found {len(specs)} <specification> elements, "
        f"minimum is {minimum}"
    )


@pytest.mark.parametrize("filename", sorted(MIN_RULES.keys()))
def test_ids_file_root_namespace(filename: str):
    """Root element must be in the buildingSMART IDS 1.0 namespace."""
    path = IDS_DIR / filename
    tree = ET.parse(path)
    root = tree.getroot()
    assert root.tag == f"{IDS_NS}ids", (
        f"{filename}: root tag is {root.tag}, expected {IDS_NS}ids"
    )


@pytest.mark.parametrize("filename", sorted(MIN_RULES.keys()))
def test_every_specification_has_identifier_and_name(filename: str):
    """Each <specification> needs `identifier` (machine-readable) and
    `name` (human-readable). Without `identifier` the violation envelope
    in `IdsValidationResult` cannot key per rule."""
    path = IDS_DIR / filename
    tree = ET.parse(path)
    missing = []
    for spec in tree.iter(f"{IDS_NS}specification"):
        ident = spec.get("identifier")
        name = spec.get("name")
        if not ident or not name:
            missing.append((spec.get("name") or "<unnamed>", ident))
    assert not missing, f"{filename}: specs with missing id/name: {missing}"


@pytest.mark.parametrize("filename", sorted(MIN_RULES.keys()))
def test_specification_identifiers_are_unique_within_file(filename: str):
    """Two specs sharing an identifier in the same file would collapse
    in the per-file severity index — catch this at lint time."""
    path = IDS_DIR / filename
    tree = ET.parse(path)
    seen: set[str] = set()
    duplicates: list[str] = []
    for spec in tree.iter(f"{IDS_NS}specification"):
        ident = spec.get("identifier")
        if ident is None:
            continue
        if ident in seen:
            duplicates.append(ident)
        seen.add(ident)
    assert not duplicates, f"{filename}: duplicate identifiers: {duplicates}"


@pytest.mark.parametrize("filename", sorted(MIN_RULES.keys()))
def test_specification_ifc_version_is_supported(filename: str):
    """ifctester restricts ifcVersion to IFC2X3, IFC4, IFC4X3_ADD2.
    NeoBIM emits IFC4 today; locking the test surfaces accidental drift
    if a future spec gets authored against a wrong version."""
    path = IDS_DIR / filename
    tree = ET.parse(path)
    valid = {"IFC2X3", "IFC4", "IFC4X3_ADD2"}
    bad: list[tuple[str, str]] = []
    for spec in tree.iter(f"{IDS_NS}specification"):
        version = spec.get("ifcVersion") or ""
        # `ifcVersion` is a space-separated list per the XSD.
        for v in version.split():
            if v not in valid:
                bad.append((spec.get("identifier") or "?", v))
    assert not bad, f"{filename}: unsupported ifcVersion entries: {bad}"


def test_xsd_validation_when_ifctester_available():
    """When `ifctester` is installed, parse every IDS file via its loader.

    `ifctester.ids.open()` runs the canonical XSD-validation path used at
    runtime in Stage 2.5 of the export pipeline, so a parse success here
    is a stronger guarantee than `xml.etree` parsing alone. Skipped when
    `ifctester` is absent (developer laptops) — CI installs it.
    """
    ids_module = pytest.importorskip("ifctester.ids")
    failures: list[tuple[str, str]] = []
    for path in _ids_files():
        try:
            ids_module.open(str(path))
        except Exception as exc:  # noqa: BLE001 — we want to surface every
            failures.append((path.name, f"{type(exc).__name__}: {exc}"))
    assert not failures, f"ifctester.ids.open failures: {failures}"
