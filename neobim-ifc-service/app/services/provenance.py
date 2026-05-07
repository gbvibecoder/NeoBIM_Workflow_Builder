"""Phase 1 Slice 3 — Pset_BuildFlow_Provenance stamping (R7).

Stamps a single `Pset_BuildFlow_Provenance` on an `IfcProject` entity
carrying every field the Phase 1 plan considers non-negotiable for
production debugging six months from now: build id, input contract,
agent stages, LLM cost / wallclock, IDS pass/fail counts, target
fidelity, fixture match, generation timestamp.

Public API:

    stamp_provenance(ifc_file, provenance: Provenance, project_entity) -> None

Deliberately standalone — Slice 3 does NOT wire this into the build
pipeline. Slice 6 will hook it into the route handler so every
emitted IFC carries the Pset and the post-Stage-2.5 IDS counts get
re-stamped.

Idempotent: if `Pset_BuildFlow_Provenance` already exists on the
project entity (e.g. because Slice 6 calls stamp_provenance twice —
once after BUILD with zero IDS counts, again after VALIDATE-IFC with
the real counts), the existing Pset is updated in place. No
duplicate Psets are created.

Property type mapping (Python → IFC):
    str   → IfcText / IfcLabel       (handled by ifcopenshell.api)
    float → IfcReal
    int   → IfcInteger

Critically: `IfcOpenShellVersion` is sourced from `ifcopenshell.version`
at stamp time, NOT from `provenance.ifcopenshell_version`. The
Provenance dataclass carries an empty default for that field because
the lift service runs before any IFC is built — by the time we stamp,
we know which ifcopenshell version is producing the file. This avoids
the subtle bug of stamping a placeholder value into the Pset.
"""

from __future__ import annotations

from typing import Any, Optional

import ifcopenshell
import ifcopenshell.api as api

from app.domain.building_model import Provenance


PSET_NAME = "Pset_BuildFlow_Provenance"


def stamp_provenance(
    ifc_file: ifcopenshell.file,
    provenance: Provenance,
    project_entity: Any,
) -> None:
    """Attach (or refresh) `Pset_BuildFlow_Provenance` on the given
    `IfcProject` entity.

    Mutates `ifc_file` in place; returns nothing. Safe to call multiple
    times on the same project — second and subsequent calls update the
    existing Pset's properties rather than creating a duplicate.

    Raises:
        ValueError — if `project_entity` is None or not an IfcProject.
    """
    if project_entity is None:
        raise ValueError(
            "stamp_provenance: project_entity is None; cannot attach "
            "Pset_BuildFlow_Provenance to a non-existent project."
        )
    if not project_entity.is_a("IfcProject"):
        raise ValueError(
            f"stamp_provenance: expected IfcProject, got "
            f"{project_entity.is_a()} (entity #{project_entity.id()})."
        )

    pset = _find_existing_pset(project_entity, PSET_NAME)
    if pset is None:
        pset = api.run(
            "pset.add_pset",
            ifc_file,
            product=project_entity,
            name=PSET_NAME,
        )

    properties = {
        "ModelVersion": str(provenance.model_version),
        "InputContractVersion": str(provenance.input_contract_version),
        "IfcOpenShellVersion": str(ifcopenshell.version),
        "AgentStagesRun": str(provenance.agent_stages_run),
        "AgentModelsUsed": str(provenance.agent_models_used),
        "TotalLLMCostUSD": float(provenance.total_llm_cost_usd),
        "TotalWallclockMs": int(provenance.total_wallclock_ms),
        "PromptCacheHitRate": float(provenance.prompt_cache_hit_rate),
        "IdsRulesPassed": int(provenance.ids_rules_passed),
        "IdsRulesFailed": int(provenance.ids_rules_failed),
        "TargetFidelity": str(provenance.target_fidelity),
        "FixtureMatch": str(provenance.fixture_match),
        "GeneratedAt": str(provenance.generated_at),
        "BuildId": str(provenance.build_id),
        "SourceContract": str(provenance.source_contract),
    }
    api.run("pset.edit_pset", ifc_file, pset=pset, properties=properties)


def _find_existing_pset(entity: Any, name: str) -> Optional[Any]:
    """Walk `entity.IsDefinedBy` and return the matching IfcPropertySet,
    or None.

    IfcProject inherits IsDefinedBy via IfcContext → IfcObjectDefinition
    in IFC4. Each item in IsDefinedBy is an IfcRelDefinesByProperties
    whose `RelatingPropertyDefinition` is the IfcPropertySet.
    """
    is_defined_by = getattr(entity, "IsDefinedBy", None) or ()
    for rel in is_defined_by:
        if not rel.is_a("IfcRelDefinesByProperties"):
            continue
        pset = rel.RelatingPropertyDefinition
        if (
            pset is not None
            and pset.is_a("IfcPropertySet")
            and pset.Name == name
        ):
            return pset
    return None


__all__ = ["stamp_provenance", "PSET_NAME"]
