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
from app.services.design_agent.llm_client import (
    CircuitBreakerTripped,
    LLMAPIError,
    LLMCallMetadata,
    LLMClient,
    LLMRateLimited,
    LLMResponseValidationError,
    LLMUnavailableError,
)
from app.services.design_agent.pdf_extractor import (
    PAGE_MARKER_FORMAT,
    PAGE_MARKER_RE,
    extract_pdf_text,
    vision_extract_pdf,
)
from app.services.design_agent.stages.brief_analyst import (
    BriefAnalystMetadata,
    enrich_with_zone_lookups,
    run_brief_analyst,
)
from app.services.design_agent.stages.program_architect import (
    ProgramArchitectMetadata,
    run_program_architect,
)
from app.services.design_agent.stages.adaptation_planner import (
    run_adaptation_planner,
)
from app.services.design_agent.stages.template_matcher import (
    TemplateMatcherMetadata,
    run_template_matcher,
)
from app.services.design_agent.template_catalog import (
    CATALOG,
    BHKFamily,
    FormFactor,
    TemplateDescriptor,
    descriptor_for,
)
from app.services.design_agent.template_dispatcher import (
    dispatch_match,
    dispatch_template,
)
from app.services.design_agent.types import (
    AdaptationFailed,
    AdaptationPlan,
    AdaptationPlannerMetadata,
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
    MatchFailed,
    MatchResult,
    ProgramConstraints,
    RoomProgram,
    RoomSpec,
    SiteContext,
    StructuralIntent,
    StyleIntent,
    SuggestedAction,
    TemplateId,
    TemplateParameters,
    TransformAxis,
    TransformRotation,
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
    "PAGE_MARKER_FORMAT",
    "PAGE_MARKER_RE",
    # Vision extraction (Slice 2A.4 wires this through Opus 4.7)
    "vision_extract_pdf",
    # LLM client (Slice 2A.4)
    "LLMClient",
    "LLMCallMetadata",
    "LLMUnavailableError",
    "CircuitBreakerTripped",
    "LLMResponseValidationError",
    "LLMRateLimited",
    "LLMAPIError",
    # BriefAnalyst stage (Slice 2A.5)
    "run_brief_analyst",
    "enrich_with_zone_lookups",
    "BriefAnalystMetadata",
    # ProgramArchitect stage (Slice 2A.6)
    "run_program_architect",
    "ProgramArchitectMetadata",
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
    # Template matcher (Slice 2B.1)
    "TemplateId",
    "TemplateParameters",
    "MatchResult",
    "MatchFailed",
    "SuggestedAction",
    "TemplateDescriptor",
    "BHKFamily",
    "FormFactor",
    "CATALOG",
    "descriptor_for",
    "dispatch_template",
    "dispatch_match",
    # TemplateMatcher stage (Slice 2B.1.B)
    "run_template_matcher",
    "TemplateMatcherMetadata",
    # Adaptation planner (Slice 2B.2)
    "AdaptationPlan",
    "AdaptationFailed",
    "AdaptationPlannerMetadata",
    "TransformAxis",
    "TransformRotation",
    "run_adaptation_planner",
]
