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

from app.services.design_agent.classifier import classify_brief
from app.services.design_agent.intake import parse_design_request
from app.services.design_agent.pdf_extractor import extract_pdf_text
from app.services.design_agent.types import (
    BriefAnalysis,
    BriefForm,
    BriefStyleWeights,
    BuildingClass,
    CirculationSpec,
    DesignContext,
    DesignContextValidationError,
    DesignRequest,
    ExtractionWarning,
    ExtractionWarningCode,
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
    # PDF extraction (Slice 2A.3)
    "extract_pdf_text",
    "ExtractionWarning",
    "ExtractionWarningCode",
    # Intake (Slice 2A.3)
    "parse_design_request",
    # Classifier (Slice 2A.2)
    "classify_brief",
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
