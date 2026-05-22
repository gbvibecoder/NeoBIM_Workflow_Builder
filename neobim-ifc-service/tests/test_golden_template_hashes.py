"""Golden byte-identity safety net for the 12 Tier-2 template builders.

Each of the 12 builders is run through `build_ifc_from_building_model`
and hashed with the EXISTING `_content_hash()` helper (imported verbatim
from `test_ifc_from_building_model_byte_identity` — no new hashing
function). The hash must match the value frozen in
`tests/golden_template_hashes.py`.

This is the regression net for every refactor: a change that claims to
be non-breaking MUST leave all 12 hashes unchanged. If a hash drifts,
the change altered the IFC output — intended or not.

Cross-process determinism (Phase 2)
-----------------------------------
Phase 1 discovered that `build_ifc_from_building_model` was NOT
byte-deterministic across processes: `ifcopenshell.api.run(...)`
populated four order-INDEPENDENT `SET OF` attributes
(`IfcUnitAssignment.Units`, `IfcRelAggregates.RelatedObjects`,
`IfcRelContainedInSpatialStructure.RelatedElements`,
`IfcRelAssociatesMaterial.RelatedObjects`) in object-`id()` order,
which is process-random. Phase 1 worked around it test-side.

Phase 2 fixed it at the source: `build_ifc_from_building_model` now ends
with a `_canonicalize_set_attribute_order(model)` pass that sorts those
four SETs by a stable key. So this test hashes the builder output
DIRECTLY — no test-side canonicalisation — and the golden hashes are
genuinely process-independent. Two guards keep that honest:

  * `test_template_hashes_match_golden` is, by construction, a
    cross-process check — the golden values were recorded in a different
    process than the one running the test.
  * `test_production_output_is_already_canonical` re-runs the production
    canonicalisation pass on a fresh build and asserts it is a no-op —
    i.e. the builder's output is already canonical. If the Phase 2 pass
    is ever removed, this fails loudly.

First-call determinism (Phase 2)
--------------------------------
Phase 0 / Phase 1 also noted that the *first* `build_ifc_from_building_model`
call in a process produced different bytes than later calls (a lazy
module-cache warm-up shifted object allocation, hence set iteration
order). The Phase 2 source fix resolves that too: with the four SETs
sorted by a stable key, the output no longer depends on set iteration
order — so it is independent of warm-up state. The fixture below
therefore needs NO warm-up call; call #1 in a fresh process is already
identical to call #N and to the golden recorded in another process.

Other determinism guards (per the Phase 0 audit):
  * `_content_hash` strips the HEADER `FILE_NAME(...)` line (a wall-clock
    timestamp from the IfcOpenShell writer).
"""

from __future__ import annotations

import pytest

ifcopenshell = pytest.importorskip("ifcopenshell")

from app.services.ifc_from_building_model import (  # noqa: E402
    _canonicalize_set_attribute_order,
    build_ifc_from_building_model,
)
from app.templates import (  # noqa: E402
    build_1bhk_pune_duplex,
    build_1bhk_pune_house,
    build_1bhk_pune_template,
    build_1bhk_pune_tower,
    build_2bhk_pune_duplex,
    build_2bhk_pune_house,
    build_2bhk_pune_template,
    build_2bhk_pune_tower,
    build_3bhk_pune_duplex,
    build_3bhk_pune_house,
    build_3bhk_pune_template,
    build_3bhk_pune_tower,
)
from tests.golden_template_hashes import GOLDEN_TEMPLATE_HASHES  # noqa: E402

# Reuse the EXISTING content-hash helper verbatim — single source of truth
# for "what byte-identity means" (FILE_NAME timestamp stripped, SHA-256).
from tests.test_ifc_from_building_model_byte_identity import (  # noqa: E402
    _content_hash,
)

# Each builder invoked with its defaults — the canonical invocation. All
# three towers default to habitable_floor_count=5.
_TEMPLATE_BUILDERS = {
    "build_1bhk_pune_duplex": build_1bhk_pune_duplex,
    "build_1bhk_pune_house": build_1bhk_pune_house,
    "build_1bhk_pune_template": build_1bhk_pune_template,
    "build_1bhk_pune_tower": build_1bhk_pune_tower,
    "build_2bhk_pune_duplex": build_2bhk_pune_duplex,
    "build_2bhk_pune_house": build_2bhk_pune_house,
    "build_2bhk_pune_template": build_2bhk_pune_template,
    "build_2bhk_pune_tower": build_2bhk_pune_tower,
    "build_3bhk_pune_duplex": build_3bhk_pune_duplex,
    "build_3bhk_pune_house": build_3bhk_pune_house,
    "build_3bhk_pune_template": build_3bhk_pune_template,
    "build_3bhk_pune_tower": build_3bhk_pune_tower,
}


@pytest.fixture(scope="module")
def template_content_hashes() -> dict[str, str]:
    """Hash all 12 templates.

    No warm-up call: the Phase 2 source fix made `build_ifc_from_building_model`
    independent of process state, so call #1 in a fresh process is already
    canonical. Omitting the warm-up also means this net would *catch* any
    future first-call non-determinism rather than mask it.
    """
    return {
        name: _content_hash(build_ifc_from_building_model(builder()))
        for name, builder in _TEMPLATE_BUILDERS.items()
    }


def test_all_twelve_templates_are_covered() -> None:
    """The golden file and the builder registry must list the same 12
    template names — otherwise a template could silently lose its net."""
    assert set(GOLDEN_TEMPLATE_HASHES) == set(_TEMPLATE_BUILDERS), (
        "golden_template_hashes.py and _TEMPLATE_BUILDERS disagree: "
        f"only in golden={set(GOLDEN_TEMPLATE_HASHES) - set(_TEMPLATE_BUILDERS)}, "
        f"only in builders={set(_TEMPLATE_BUILDERS) - set(GOLDEN_TEMPLATE_HASHES)}"
    )


def test_production_output_is_already_canonical() -> None:
    """The Phase 2 source fix must keep the builder's output canonical.

    Re-running `_canonicalize_set_attribute_order` on a fresh build must
    be a no-op — if it changes the bytes, the builder emitted a
    non-canonical (process-dependent) IFC, which means the
    `_canonicalize_set_attribute_order(model)` call inside
    `build_ifc_from_building_model` is missing or ineffective.
    """
    model = build_ifc_from_building_model(build_3bhk_pune_house())
    before = _content_hash(model)
    _canonicalize_set_attribute_order(model)  # expected: no-op
    after = _content_hash(model)
    assert before == after, (
        "build_ifc_from_building_model output is NOT canonical — the "
        "Phase 2 _canonicalize_set_attribute_order(model) pass appears "
        "to be missing or ineffective. Cross-process byte-identity is "
        "broken until it is restored."
    )


@pytest.mark.parametrize("template_name", sorted(_TEMPLATE_BUILDERS))
def test_template_hashes_match_golden(
    template_name: str, template_content_hashes: dict[str, str]
) -> None:
    """Each template's IFC content hash must match its frozen golden value."""
    actual = template_content_hashes[template_name]
    expected = GOLDEN_TEMPLATE_HASHES[template_name]
    assert actual == expected, (
        f"byte-identity regression for {template_name}: "
        f"expected golden {expected}, got {actual}. "
        f"A change altered this template's IFC output. If the change is "
        f"intentional, re-record golden_template_hashes.py in the same "
        f"commit with justification; otherwise revert and investigate."
    )
