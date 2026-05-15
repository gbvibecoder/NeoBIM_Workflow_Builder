"""AI builder-script sandbox endpoint — POST /api/v1/execute-builder-script.

Runs an AI-authored IfcOpenShell Python script (from TR-022, the IFC
Architect) in an isolated subprocess and returns the generated IFC.

SANDBOX MODEL (v1 — hardened further in Phase 2)
------------------------------------------------
* The script is written to `/tmp/sandbox-<uuid>/script.py` and executed
  as a SUBPROCESS — never `eval`/`exec` in-process.
* Working directory is the sandbox dir; the script must write its IFC to
  `output.ifc` there. The endpoint reads exactly that path — the script's
  claimed output path is never trusted.
* The subprocess gets a MINIMAL environment: no `API_KEY`, no `R2_*`, no
  `ANTHROPIC_API_KEY`. The script cannot read or exfiltrate service
  secrets because they are simply not present in its environment.
* Resource limits via `preexec_fn` + `setrlimit`: 4 GB address space,
  60 s CPU, 100 MB max file write. Wall-clock cap: 120 s.
* Network: best-effort `unshare -rn` namespace when the container grants
  the capability. Railway containers usually do NOT (no CAP_SYS_ADMIN),
  so this is probed once at import and degrades gracefully — see
  `_NETWORK_ISOLATION_AVAILABLE`. Documented as a Phase 2 hardening gap.
* The sandbox directory is always removed in a `finally` block.

The endpoint returns HTTP 200 for every script-level outcome (success or
failed); only an unexpected sandbox-setup crash propagates as a 500 via
the global exception handler.
"""

from __future__ import annotations

import os
import re
import resource
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

import ifcopenshell
import structlog
from fastapi import APIRouter, Request

from app.models.builder_script import (
    BuilderScriptError,
    ExecuteBuilderScriptRequest,
    ExecuteBuilderScriptResponse,
    SandboxAudit,
    SandboxLog,
)
from app.services.audit_counter import audit_model
from app.services.r2_uploader import ifc_to_base64_data_uri, upload_ifc_to_r2

log = structlog.get_logger()

router = APIRouter(tags=["builder-script"])

# ── Sandbox limits ─────────────────────────────────────────────────────
# Phase 2.1: raised from 1GB — ifcopenshell + Opus-generated scripts
# authoring 1000+ elements need more headroom.
RLIMIT_AS_BYTES = 4 * 1024 * 1024 * 1024  # 4 GB virtual address space
RLIMIT_CPU_SECONDS = 60  # 60 s CPU time
RLIMIT_FSIZE_BYTES = 100 * 1024 * 1024  # 100 MB max single-file write
WALL_TIMEOUT_SECONDS = 120  # hard wall-clock cap
MAX_OUTPUT_IFC_BYTES = 50 * 1024 * 1024  # app-level cap on the produced IFC
STDIO_TAIL_BYTES = 8 * 1024  # tail of stdout / stderr kept for diagnostics
OUTPUT_FILENAME = "output.ifc"  # the script MUST write exactly this, in cwd
SCRIPT_FILENAME = "script.py"

# Error codes — the EX-006 handler branches on these to pick an HTTP status.
ERR_RUNTIME = "IFCOPENSHELL_RUNTIME_ERROR"
ERR_TIMEOUT = "SANDBOX_TIMEOUT"
ERR_OUTPUT_TOO_LARGE = "OUTPUT_TOO_LARGE"
ERR_MISSING_OUTPUT = "MISSING_OUTPUT"
ERR_INVALID_IFC = "INVALID_IFC"


def _probe_network_isolation() -> bool:
    """Can this container create a network namespace? Probed once at import.

    Railway containers usually lack CAP_SYS_ADMIN, so `unshare -rn` fails
    with EPERM. We degrade gracefully: when unavailable the script runs
    without network isolation (it still has no credentials in its env and
    no useful service to call). Documented as a Phase 2 hardening gap.
    """
    try:
        result = subprocess.run(
            ["unshare", "-rn", "true"],
            capture_output=True,
            timeout=5,
        )
        return result.returncode == 0
    except (FileNotFoundError, OSError, subprocess.SubprocessError):
        return False


_NETWORK_ISOLATION_AVAILABLE = _probe_network_isolation()


def _apply_rlimits() -> None:
    """preexec_fn — runs in the child process between fork() and exec().

    Best-effort: a platform that rejects a particular limit must not abort
    the whole exec, so each `setrlimit` is independently guarded. Kept
    deliberately tiny (syscalls only, no locks, no allocation) to minimise
    the documented `preexec_fn` thread-safety risk.
    """
    for res_id, soft in (
        (resource.RLIMIT_AS, RLIMIT_AS_BYTES),
        (resource.RLIMIT_CPU, RLIMIT_CPU_SECONDS),
        (resource.RLIMIT_FSIZE, RLIMIT_FSIZE_BYTES),
    ):
        try:
            resource.setrlimit(res_id, (soft, soft))
        except (ValueError, OSError):
            pass


def _sanitise_prefix(raw: str) -> str:
    """R2-key-safe filename prefix. Mirrors the EX-006 handler's sanitiser."""
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "", raw or "")
    return cleaned[:64] or "ai-ifc"


def _failed(
    code: str,
    message: str,
    sandbox_log: SandboxLog,
    elapsed_ms: int,
) -> ExecuteBuilderScriptResponse:
    """Build a `status="failed"` response (still HTTP 200)."""
    return ExecuteBuilderScriptResponse(
        status="failed",
        execution_time_ms=elapsed_ms,
        sandbox_log=sandbox_log,
        error=BuilderScriptError(code=code, message=message),
    )


@router.post("/execute-builder-script", response_model=ExecuteBuilderScriptResponse)
def execute_builder_script(
    request: ExecuteBuilderScriptRequest,
    http_request: Request,
) -> ExecuteBuilderScriptResponse:
    """Execute an AI-authored IfcOpenShell script in a sandboxed subprocess.

    Sync route — FastAPI runs it in a worker thread, so the blocking
    subprocess does not stall the event loop.
    """
    rid = getattr(http_request.state, "request_id", "unknown")
    start = time.monotonic()
    run_id = uuid.uuid4().hex[:12]
    safe_prefix = _sanitise_prefix(request.file_prefix)
    sandbox_dir = os.path.join(tempfile.gettempdir(), f"sandbox-{run_id}")

    log.info(
        "builder_script_received",
        request_id=rid,
        run_id=run_id,
        script_chars=len(request.python_code),
        expected_entity_count=request.expected_entity_count,
        network_isolation=_NETWORK_ISOLATION_AVAILABLE,
    )

    try:
        # ── Sandbox setup ─────────────────────────────────────────────
        os.makedirs(sandbox_dir, mode=0o700, exist_ok=False)
        script_path = os.path.join(sandbox_dir, SCRIPT_FILENAME)
        with open(script_path, "w", encoding="utf-8") as fp:
            fp.write(request.python_code)

        # Minimal environment — deliberately excludes every service
        # secret so the script cannot read or exfiltrate credentials.
        #
        # Phase 2.1: pin BLAS / OpenMP / MKL / NumExpr / vecLib thread
        # pools to a single thread. OpenBLAS's per-thread scratch space
        # (32-256 MB × n_cpus) was exhausting the RLIMIT_AS budget at
        # `import numpy` time, well before any IFC code ran ("OpenBLAS
        # error: Memory allocation still failed after 10 retries"). These
        # vars are read at LIBRARY LOAD time, so they MUST be present in
        # the child's env from the start — setting them in the parent is
        # too late.
        sandbox_env = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "HOME": sandbox_dir,
            "TMPDIR": sandbox_dir,
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "PYTHONUNBUFFERED": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            # BLAS / threading pinning — see comment block above.
            "OPENBLAS_NUM_THREADS": "1",
            "OMP_NUM_THREADS": "1",
            "MKL_NUM_THREADS": "1",
            "NUMEXPR_NUM_THREADS": "1",
            "VECLIB_MAXIMUM_THREADS": "1",
        }

        base_cmd = [sys.executable, script_path]
        cmd = (
            ["unshare", "-rn", *base_cmd]
            if _NETWORK_ISOLATION_AVAILABLE
            else base_cmd
        )

        # ── Run the script ────────────────────────────────────────────
        try:
            proc = subprocess.run(
                cmd,
                cwd=sandbox_dir,
                env=sandbox_env,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=WALL_TIMEOUT_SECONDS,
                preexec_fn=_apply_rlimits,
                start_new_session=True,
                text=True,
                errors="replace",
            )
        except subprocess.TimeoutExpired as exc:
            elapsed_ms = round((time.monotonic() - start) * 1000)
            stdout_tail = (exc.stdout or "")[-STDIO_TAIL_BYTES:]
            stderr_tail = (exc.stderr or "")[-STDIO_TAIL_BYTES:]
            log.warning(
                "builder_script_timeout",
                request_id=rid,
                run_id=run_id,
                wall_timeout_s=WALL_TIMEOUT_SECONDS,
            )
            return _failed(
                ERR_TIMEOUT,
                f"Script exceeded the {WALL_TIMEOUT_SECONDS}s wall-clock budget.",
                SandboxLog(
                    stdout_tail=stdout_tail
                    if isinstance(stdout_tail, str)
                    else "",
                    stderr_tail=stderr_tail
                    if isinstance(stderr_tail, str)
                    else "",
                    exit_code=-1,
                ),
                elapsed_ms,
            )

        elapsed_ms = round((time.monotonic() - start) * 1000)
        sandbox_log = SandboxLog(
            stdout_tail=(proc.stdout or "")[-STDIO_TAIL_BYTES:],
            stderr_tail=(proc.stderr or "")[-STDIO_TAIL_BYTES:],
            exit_code=proc.returncode,
        )

        # ── Non-zero exit → the script raised ─────────────────────────
        if proc.returncode != 0:
            log.warning(
                "builder_script_nonzero_exit",
                request_id=rid,
                run_id=run_id,
                exit_code=proc.returncode,
            )
            return _failed(
                ERR_RUNTIME,
                f"Script exited with code {proc.returncode}. "
                "See stderr_tail for the traceback.",
                sandbox_log,
                elapsed_ms,
            )

        # ── Exit 0 but no output file ─────────────────────────────────
        output_path = os.path.join(sandbox_dir, OUTPUT_FILENAME)
        if not os.path.isfile(output_path):
            log.warning(
                "builder_script_missing_output",
                request_id=rid,
                run_id=run_id,
            )
            return _failed(
                ERR_MISSING_OUTPUT,
                f"Script exited 0 but did not write '{OUTPUT_FILENAME}' to its "
                "working directory.",
                sandbox_log,
                elapsed_ms,
            )

        output_size = os.path.getsize(output_path)
        if output_size > MAX_OUTPUT_IFC_BYTES:
            log.warning(
                "builder_script_output_too_large",
                request_id=rid,
                run_id=run_id,
                output_size=output_size,
            )
            return _failed(
                ERR_OUTPUT_TOO_LARGE,
                f"Generated IFC is {output_size} bytes, over the "
                f"{MAX_OUTPUT_IFC_BYTES}-byte cap.",
                sandbox_log,
                elapsed_ms,
            )

        # ── Validate the IFC parses, then audit it ────────────────────
        try:
            model = ifcopenshell.open(output_path)
        except Exception as exc:  # noqa: BLE001 — any parse failure is INVALID_IFC
            log.warning(
                "builder_script_invalid_ifc",
                request_id=rid,
                run_id=run_id,
                error=str(exc),
                error_type=type(exc).__name__,
            )
            return _failed(
                ERR_INVALID_IFC,
                f"Generated file is not a valid IFC: {type(exc).__name__}: {exc}",
                sandbox_log,
                elapsed_ms,
            )

        audit_dict = audit_model(model)
        total_entities = int(audit_dict.get("total_entities", 0))
        by_class_raw = audit_dict.get("by_type", {})
        by_class = {
            str(k): int(v) for k, v in by_class_raw.items()
        } if isinstance(by_class_raw, dict) else {}
        audit = SandboxAudit(total_entities=total_entities, by_class=by_class)

        # ── Upload to R2 (base64 data-URI fallback when R2 unconfigured) ─
        with open(output_path, "rb") as fp:
            ifc_bytes = fp.read()
        filename = f"{safe_prefix}-{run_id}.ifc"
        url = upload_ifc_to_r2(ifc_bytes, filename)
        if url is None:
            log.warning(
                "builder_script_r2_fallback_base64",
                request_id=rid,
                run_id=run_id,
                size_bytes=output_size,
            )
            url = ifc_to_base64_data_uri(ifc_bytes)

        log.info(
            "builder_script_success",
            request_id=rid,
            run_id=run_id,
            entity_count=total_entities,
            expected_entity_count=request.expected_entity_count,
            ifc_size_bytes=output_size,
            elapsed_ms=elapsed_ms,
        )

        return ExecuteBuilderScriptResponse(
            status="success",
            ifc_url=url,
            ifc_size_bytes=output_size,
            entity_count=total_entities,
            audit=audit,
            execution_time_ms=elapsed_ms,
            sandbox_log=sandbox_log,
            error=None,
        )

    finally:
        # The sandbox dir is ALWAYS removed — success, failure, or an
        # unexpected exception propagating to the global handler.
        shutil.rmtree(sandbox_dir, ignore_errors=True)
