"""Phase 2A — Design agent foundation layer.

Pipeline (slice-by-slice rollout):

    DesignRequest
       │  (Slice 2A.2) classifier.classify_brief
       ▼
    BriefStyleWeights
       │  (Slice 2A.3) pdf_extractor.extract_pdf_text   [optional]
       ▼
    BriefAnalysis    (Slice 2A.5) stages.brief_analyst.run_brief_analyst
       ▼
    RoomProgram     (Slice 2A.6) stages.program_architect.run_program_architect
       ▼
    DesignContext  ← consumed by Phase 2B design agents (massing, layout,
                     structural, MEP, envelope) and Phase 2C critics.

Slice 2A.1 (this commit) lays down the schemas + reference data only.
The classifier / PDF extractor / LLM client / stages / endpoint are
filled in by subsequent slices in the order above. Imports for the
later modules will be added to this barrel as they land — keeping the
public surface in one place.
"""

from app.services.design_agent.types import (
    BriefAnalysis,
    BriefForm,
    BriefStyleWeights,
    BuildingClass,
    CirculationSpec,
    DesignContext,
    DesignContextValidationError,
    DesignRequest,
    FidelityHint,
    ProgramConstraints,
    RoomProgram,
    RoomSpec,
    SiteContext,
    StructuralIntent,
    StyleIntent,
    fidelity_hint_for,
)

__all__ = [
    # Errors
    "DesignContextValidationError",
    # Inputs
    "BriefForm",
    "DesignRequest",
    # Classifier
    "BriefStyleWeights",
    # Brief analyst
    "BuildingClass",
    "SiteContext",
    "StyleIntent",
    "StructuralIntent",
    "FidelityHint",
    "fidelity_hint_for",
    "BriefAnalysis",
    # Program architect
    "RoomSpec",
    "CirculationSpec",
    "ProgramConstraints",
    "RoomProgram",
    # Final hand-off
    "DesignContext",
]
