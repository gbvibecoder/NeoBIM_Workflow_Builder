"""POST /api/v3/verifier/check-build

Phase ε.5 — the missing endpoint.

`build_verifier.check_build()` has had the deterministic spec-vs-IFC
comparison logic since Phase Beta 3+4, but no FastAPI router ever
exposed it. The TS-side `hard-verifier.ts` has been calling
`${IFC_SERVICE_URL}/api/v3/verifier/check-build` and silently 404-ing,
falling through to `buildHeuristicReport` (which returns
`parts_coverage=0, verified=false, source="heuristic_fallback"`). The
forensic audit caught this: every production build's `verifier.source`
has been `"heuristic_fallback"`, and the legacy quality score has been
effectively hardcoded to 0.

Mounted at the path the TS client already targets, so `hard-verifier.ts`
just starts working with no client-side change. Returns the canonical
`VerifierReport.to_dict()` shape — `verifierReportSchema.safeParse({
...data, source: "railway" })` in TS will validate and lift it to the
composite metric's `parts_decomposition` sub-signal.

Auth: inherits the app-level `ApiKeyMiddleware` (Bearer token); same
guard as every other v3 router.

Never re-raises: every failure path inside `check_build` is captured
into a structured `VerifierReport` so the TS caller never sees a 500.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

import structlog
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.services.ifc_generator_v3.build_verifier import check_build

log = structlog.get_logger()

router = APIRouter(tags=["v3-verifier"])


# ── Request / response models ─────────────────────────────────────────


class VerifierTolerance(BaseModel):
    """Optional per-call tolerance overrides. Defaults applied inside
    `check_build` when keys are absent or the whole `tolerance` block
    is missing."""

    dim_m: Optional[float] = Field(
        default=None,
        ge=0,
        description="Per-dimension tolerance in metres (default 0.1).",
    )
    parts_min_fraction: Optional[float] = Field(
        default=None,
        ge=0,
        le=1,
        description="Min fraction of expected parts that must be present (default 0.7).",
    )


class CheckBuildRequest(BaseModel):
    """Body for POST /api/v3/verifier/check-build.

    Shape matches the TS client at `hard-verifier.ts:60-69` exactly
    (verified by the audit). `spec` is the full BriefSpec; we pass it
    straight through to `check_build` which reads `spec.furniture`
    and `spec.trim` to drive the parts + trim comparisons.
    """

    ifc_url: str = Field(..., min_length=8, max_length=2000)
    spec: Dict[str, Any]
    tolerance: Optional[VerifierTolerance] = None


class CheckBuildResponse(BaseModel):
    """Mirror of `VerifierReport.to_dict()`. Matches the TS
    `verifierReportSchema` (the TS side adds `source: "railway"` after
    receiving the body). Never returns 500 — every failure inside
    `check_build` becomes a structured mismatch with `verified=false`.
    """

    verified: bool
    parts_coverage: float
    trim_coverage: float
    mismatches: list
    summary: str
    verified_at: str


# ── Endpoint ─────────────────────────────────────────────────────────


@router.post("/check-build", response_model=CheckBuildResponse)
def check_build_endpoint(
    request: CheckBuildRequest,
    http_request: Request,
) -> CheckBuildResponse:
    """Deterministic verifier: parses the IFC at `request.ifc_url`,
    compares against `request.spec.furniture[*].parts` (counts +
    aggregation) and `request.spec.trim` (presence), returns a
    `VerifierReport`. See `build_verifier.check_build` docstring for
    the comparison semantics."""
    rid = getattr(http_request.state, "request_id", "unknown")

    tolerance_dict: Optional[Dict[str, Any]] = None
    if request.tolerance is not None:
        # Strip None values so check_build's `tol.get(key, default)`
        # gets the right defaults (not None).
        tolerance_dict = {
            k: v
            for k, v in request.tolerance.model_dump().items()
            if v is not None
        }

    try:
        report = check_build(
            ifc_url=request.ifc_url,
            spec=request.spec,
            tolerance=tolerance_dict,
        )
    except Exception as exc:  # pragma: no cover — defensive only
        # `check_build` is supposed to catch its own failures into the
        # report (ifcopenshell-missing, fetch errors, parse errors all
        # become mismatches with verified=false). Any leaked exception
        # is a real bug — surface it as a 500 rather than silently
        # returning a misleading report.
        log.error(
            "v3_verifier_check_build_uncaught",
            request_id=rid,
            ifc_url=request.ifc_url[:80],
            error=str(exc),
            error_type=type(exc).__name__,
        )
        raise HTTPException(
            status_code=500,
            detail={
                "code": "VERIFIER_UNCAUGHT",
                "message": f"check_build raised: {exc!r}",
            },
        )

    log.info(
        "v3_verifier_check_build",
        request_id=rid,
        ifc_url=request.ifc_url[:80],
        verified=report.verified,
        parts_coverage=report.parts_coverage,
        trim_coverage=report.trim_coverage,
        mismatch_count=len(report.mismatches),
    )

    report_dict = report.to_dict()
    return CheckBuildResponse(
        verified=report_dict["verified"],
        parts_coverage=report_dict["parts_coverage"],
        trim_coverage=report_dict["trim_coverage"],
        mismatches=report_dict["mismatches"],
        summary=report_dict["summary"],
        verified_at=report_dict["verified_at"],
    )
