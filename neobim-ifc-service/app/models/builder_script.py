"""Pydantic models for POST /api/v1/execute-builder-script.

The endpoint runs an AI-authored IfcOpenShell script in a sandboxed
subprocess (see `app/routers/builder_script.py`). It is the Railway half
of the Brief-to-IFC v2 pipeline — the Next.js EX-006 handler POSTs the
script TR-022 (the IFC Architect) produced, and gets back an R2 URL plus
an entity audit.

Contract note: the endpoint returns HTTP 200 with `status` carrying the
script-level outcome ("success" | "failed"). HTTP-layer errors (auth,
malformed body, unexpected sandbox-setup crash) flow through FastAPI /
the global exception handler as normal non-2xx responses.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# python_code over this length is rejected at the Pydantic layer (422).
MAX_PYTHON_CODE_CHARS = 200_000


class ExecuteBuilderScriptRequest(BaseModel):
    """Request body — the AI-authored builder script plus upload metadata."""

    python_code: str = Field(
        ...,
        min_length=1,
        max_length=MAX_PYTHON_CODE_CHARS,
        description="The IfcOpenShell Python script to execute in the sandbox.",
    )
    file_prefix: str = Field(
        default="ai-ifc",
        max_length=128,
        description="Filename prefix for the R2 upload of the generated IFC.",
    )
    expected_entity_count: int | None = Field(
        default=None,
        ge=0,
        description="The architect's own estimate of total IFC entities — "
        "forwarded as a sanity signal, not enforced.",
    )


class SandboxLog(BaseModel):
    """Captured subprocess diagnostics. stdout/stderr are tail-truncated.

    Phase 3: added `stderr_line_count` and `runtime_seconds` so the
    self-heal repair Opus call (TypeScript side) and the canvas error
    artifact have the full diagnostic surface they need without parsing
    the tail themselves.
    """

    stdout_tail: str
    stderr_tail: str
    exit_code: int
    # Phase 3 — number of newline-terminated lines in the FULL stderr the
    # subprocess produced (i.e. *before* tail-truncation). Lets the UI say
    # "10 stderr lines, last 16 KB shown" honestly even when stderr was
    # larger than the tail window.
    stderr_line_count: int = 0
    # Phase 3 — wall-clock seconds spent inside the subprocess.
    runtime_seconds: float = 0.0


class SandboxAudit(BaseModel):
    """Entity audit of the generated IFC (via app.services.audit_counter)."""

    total_entities: int = Field(ge=0)
    by_class: dict[str, int] = Field(
        default_factory=dict,
        description="Per-IFC-class instance counts (the audit_counter by_type map).",
    )


class BuilderScriptError(BaseModel):
    """Structured failure detail. `code` is a fixed set the EX-006 handler
    branches on to choose a canvas-facing HTTP status."""

    code: str
    message: str


class ExecuteBuilderScriptResponse(BaseModel):
    """Response body. Always HTTP 200; `status` carries the script outcome."""

    status: Literal["success", "failed"]
    ifc_url: str | None = None
    ifc_size_bytes: int | None = None
    entity_count: int | None = None
    audit: SandboxAudit | None = None
    execution_time_ms: int = Field(ge=0)
    sandbox_log: SandboxLog
    error: BuilderScriptError | None = None
