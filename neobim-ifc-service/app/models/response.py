"""Pydantic response models for IFC export."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class ExportedFile(BaseModel):
    discipline: str
    file_name: str
    download_url: str
    size: int
    schema_version: str = "IFC4"
    entity_count: int = 0


class EntityCounts(BaseModel):
    IfcWall: int = 0
    IfcSlab: int = 0
    IfcColumn: int = 0
    IfcBeam: int = 0
    IfcWindow: int = 0
    IfcDoor: int = 0
    IfcOpeningElement: int = 0
    IfcSpace: int = 0
    IfcStairFlight: int = 0
    IfcDuctSegment: int = 0
    IfcPipeSegment: int = 0
    IfcFooting: int = 0


class BuildFailure(BaseModel):
    """One element that raised during IFC creation.

    Logged server-side with full traceback; surfaced here so callers can
    render a partial-success UI without parsing Railway logs.
    """

    element_id: str
    element_type: str
    error_type: str
    error: str


class IdsViolation(BaseModel):
    """One failed IDS specification, scoped to a single matched IFC entity.

    Phase 0 stage 2.5 (VALIDATE-IFC) emits one of these per (spec, failed
    element) pair. `severity="error"` flips the response status to
    `"partial"`; `severity="warning"` is informational only.
    """

    rule_id: str
    rule_name: str
    severity: Literal["error", "warning"]
    discipline: str
    applicable_element_guid: Optional[str] = None
    expected: str = ""
    actual: str = ""
    hint: Optional[str] = None


class IdsValidationResult(BaseModel):
    """Outcome of running ifctester against the emitted discipline IFCs.

    `passed` is True iff the violations list is empty (warnings don't
    fail the gate). `skipped_reason` is set when validation could not run
    (e.g. ifctester not installed in the runtime image).
    """

    passed: bool = True
    target_fidelity: str = "design-development"
    violations: list[IdsViolation] = Field(default_factory=list)
    warnings: list[IdsViolation] = Field(default_factory=list)
    files_validated: int = 0
    rules_evaluated: int = 0
    elapsed_ms: float = 0
    skipped_reason: Optional[str] = None


class ExportMetadata(BaseModel):
    engine: str = "ifcopenshell"
    ifcopenshell_version: str = ""
    generation_time_ms: float = 0
    validation_passed: bool = False
    entity_counts: EntityCounts = EntityCounts()
    # Per-element build failures. Non-empty means the IFC was produced with
    # some elements skipped — caller should decide whether that's acceptable.
    build_failures: list[BuildFailure] = Field(default_factory=list)
    build_failure_count: int = 0
    # Phase 0 stage 2.5 (VALIDATE-IFC) — null when validation was skipped
    # (e.g. ifctester not installed in the worker image). Populated for
    # every successful BUILD; an error-severity violation flips response
    # status to "partial" via the same mechanism build failures use.
    ids_validation: Optional[IdsValidationResult] = None
    ids_violations: list[IdsViolation] = Field(default_factory=list)
    ids_warnings: list[IdsViolation] = Field(default_factory=list)
    # Phase 1 Slice 6 — BuildingModel JSON in the response. Populated when
    # `useParametricPipeline=true`; serialized via `.model_dump(mode="json")`
    # so the Phase 2 design agent can produce identically-shaped output.
    # The TS `EX-001` handler reads this and writes through to Postgres +
    # R2 (Slice 7).
    building_model_json: Optional[dict] = None
    building_model_r2_key: Optional[str] = None


class ExportIFCResponse(BaseModel):
    # "partial" means the IFC was generated but some elements failed to build.
    status: Literal["success", "partial", "error"]
    files: list[ExportedFile] = []
    metadata: ExportMetadata = ExportMetadata()
    error: Optional[str] = None
    code: Optional[str] = None
    # Populated on error responses so callers can correlate with server logs.
    request_id: Optional[str] = None
    stage: Optional[str] = None
    error_type: Optional[str] = None
