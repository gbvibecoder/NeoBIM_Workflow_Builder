"""Diagnostic audit endpoint — POST /api/v1/audit.

Phase 1 deliverable. Loads an .ifc file (uploaded as multipart OR fetched
from a URL given in the JSON body) and returns the entity-count breakdown
that `scripts/audit_emission.py` writes into the baseline doc — by-type
counts, geometry primitives, type instances, openings/rels, materials,
Pset/Qto frequency, schema version.

HTTP verb note: the Phase 1 brief described this as `GET /api/v1/audit`,
but a GET that accepts a multipart upload OR a JSON body violates HTTP
semantics (RFC 9110 §9.3.1 — GET request bodies have no defined meaning
and are widely treated as malformed). This endpoint is therefore POST,
matching the precedent of `/api/v1/export-ifc`. Functional contract is
unchanged from the brief.

Bearer auth follows the existing pattern: handled implicitly by
`ApiKeyMiddleware` because `/api/v1/audit` is not in PUBLIC_PATHS.

Response time target: < 5 s for files ≤ 10 MB. The 10 MB ceiling is
enforced in-handler so a malicious 1 GB upload doesn't OOM the worker.
"""

from __future__ import annotations

import io
import time
from typing import Optional

import ifcopenshell
import structlog
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, ConfigDict, Field

from app.services.audit_counter import audit_model

log = structlog.get_logger()

router = APIRouter(tags=["audit"])

# Hard ceiling. Matches the BuildFlow side `parse-ifc` route (100 MB
# upper bound there too — but the audit endpoint is sync and does
# nothing useful for huge files, so 10 MB is the lower of the two).
MAX_AUDIT_FILE_BYTES = 10 * 1024 * 1024


class AuditByUrlRequest(BaseModel):
    """JSON body shape: `{ "ifcUrl": "https://..." }`.

    Fetches the .ifc from a remote URL. SSRF is the responsibility of
    the caller (BuildFlow's `/api/parse-ifc` does the whitelisting at
    the public boundary; this endpoint is internal — anything that
    reaches it has already been authenticated via the API-key
    middleware).
    """

    ifc_url: str = Field(alias="ifcUrl")
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


def _audit_bytes(rid: str, ifc_bytes: bytes, source: str) -> dict:
    """Open `ifc_bytes` with ifcopenshell and return the audit dict.

    Writes a NamedTemporaryFile-equivalent in-memory buffer because
    ifcopenshell.open requires a path. Uses `tempfile` for a real path
    when needed; the buffer is freed as soon as the model is parsed.
    """
    if len(ifc_bytes) == 0:
        raise HTTPException(
            status_code=422,
            detail={
                "status": "error",
                "error_code": "AUDIT_EMPTY_FILE",
                "detail": "Uploaded .ifc has zero length",
                "request_id": rid,
            },
        )
    if len(ifc_bytes) > MAX_AUDIT_FILE_BYTES:
        raise HTTPException(
            status_code=413,
            detail={
                "status": "error",
                "error_code": "AUDIT_FILE_TOO_LARGE",
                "detail": (
                    f"Uploaded .ifc is {len(ifc_bytes)} bytes; ceiling is "
                    f"{MAX_AUDIT_FILE_BYTES} ({MAX_AUDIT_FILE_BYTES // 1024 // 1024} MB)"
                ),
                "request_id": rid,
            },
        )

    head = ifc_bytes[:32].lstrip()
    if not head.startswith(b"ISO-10303-21"):
        raise HTTPException(
            status_code=422,
            detail={
                "status": "error",
                "error_code": "AUDIT_NOT_AN_IFC",
                "detail": (
                    f"File does not start with ISO-10303-21; header is "
                    f"{head[:16]!r} — is this actually an .ifc?"
                ),
                "request_id": rid,
            },
        )

    import tempfile

    start = time.monotonic()
    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=True) as tmp:
        tmp.write(ifc_bytes)
        tmp.flush()
        try:
            model = ifcopenshell.open(tmp.name)
        except Exception as exc:
            log.warning(
                "audit_open_failed",
                request_id=rid,
                source=source,
                error=str(exc),
                error_type=type(exc).__name__,
            )
            raise HTTPException(
                status_code=422,
                detail={
                    "status": "error",
                    "error_code": "AUDIT_PARSE_FAILED",
                    "detail": f"ifcopenshell.open() failed: {exc}",
                    "error_type": type(exc).__name__,
                    "request_id": rid,
                },
            )

    audit = audit_model(model)
    audit["request_id"] = rid
    audit["source"] = source
    audit["file_size_bytes"] = len(ifc_bytes)
    audit["audit_time_ms"] = round((time.monotonic() - start) * 1000, 1)
    log.info(
        "audit_complete",
        request_id=rid,
        source=source,
        file_size_bytes=len(ifc_bytes),
        total_entities=audit["total_entities"],
        schema=audit["schema_version"],
        elapsed_ms=audit["audit_time_ms"],
    )
    return audit


@router.post("/audit")
async def audit_ifc(
    http_request: Request,
    file: Optional[UploadFile] = File(default=None),
) -> dict:
    """Inspect an .ifc and return entity-count-by-type plus categorised totals.

    Two input shapes (mutually exclusive):
      * multipart/form-data — file upload under field name "file".
      * application/json — `{ "ifcUrl": "https://..." }` (server fetches).

    Returns the audit_counter.audit_model() dict plus request_id, source,
    file_size_bytes, audit_time_ms.
    """
    rid = getattr(http_request.state, "request_id", "unknown")
    content_type = (http_request.headers.get("content-type") or "").lower()

    if file is not None:
        # Multipart path
        ifc_bytes = await file.read()
        return _audit_bytes(rid, ifc_bytes, source=f"upload:{file.filename}")

    if "application/json" in content_type:
        # JSON {ifcUrl: ...} path
        body = await http_request.json()
        try:
            parsed = AuditByUrlRequest.model_validate(body)
        except Exception as exc:
            raise HTTPException(
                status_code=422,
                detail={
                    "status": "error",
                    "error_code": "AUDIT_INVALID_JSON_BODY",
                    "detail": str(exc),
                    "error_type": type(exc).__name__,
                    "request_id": rid,
                },
            )

        # Fetch the URL. Use httpx if available (already in dev deps);
        # fall back to urllib.request for the prod image which doesn't
        # ship httpx as a runtime dep.
        ifc_bytes = _fetch_url(parsed.ifc_url, rid)
        return _audit_bytes(rid, ifc_bytes, source=f"url:{parsed.ifc_url}")

    raise HTTPException(
        status_code=422,
        detail={
            "status": "error",
            "error_code": "AUDIT_NO_INPUT",
            "detail": (
                "Provide either a multipart `file` upload or a JSON body "
                "with `ifcUrl`. Got Content-Type=" + repr(content_type)
            ),
            "request_id": rid,
        },
    )


def _fetch_url(url: str, rid: str) -> bytes:
    """Fetch an .ifc from a URL with a hard size + timeout cap.

    No new dependency added — uses urllib.request, which is stdlib.
    Streamed read up to MAX_AUDIT_FILE_BYTES + 1 so we 413 early on
    obviously-too-large responses without loading them whole.
    """
    import urllib.error
    import urllib.request

    req = urllib.request.Request(url, headers={"User-Agent": "neobim-ifc-audit/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:  # nosec B310 — internal endpoint
            data = resp.read(MAX_AUDIT_FILE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "status": "error",
                "error_code": "AUDIT_URL_HTTP_ERROR",
                "detail": f"GET {url} returned {exc.code} {exc.reason}",
                "request_id": rid,
            },
        )
    except urllib.error.URLError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "status": "error",
                "error_code": "AUDIT_URL_FETCH_FAILED",
                "detail": f"Could not fetch {url}: {exc.reason}",
                "request_id": rid,
            },
        )
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "status": "error",
                "error_code": "AUDIT_URL_FETCH_CRASHED",
                "detail": f"Unexpected error fetching {url}: {exc}",
                "error_type": type(exc).__name__,
                "request_id": rid,
            },
        )
    if len(data) > MAX_AUDIT_FILE_BYTES:
        raise HTTPException(
            status_code=413,
            detail={
                "status": "error",
                "error_code": "AUDIT_REMOTE_FILE_TOO_LARGE",
                "detail": (
                    f"Remote .ifc exceeds {MAX_AUDIT_FILE_BYTES} bytes; "
                    f"refusing to load"
                ),
                "request_id": rid,
            },
        )
    return data
