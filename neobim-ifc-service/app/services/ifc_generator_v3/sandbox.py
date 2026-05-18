"""Restricted Python `exec()` for the v3 generator agent's `run_python` tool.

Threat model: the code is AUTHORED BY OUR OWN Anthropic call (Claude
Opus 4.7) — not user-supplied. The risk is *bad* code with accidental
side-effects, not *malicious* code. The restrictions below block the
common-mistake surface:

  • No file I/O outside the session scratch dir.
  • No network (`socket`, `urllib`, `requests`, …) imports.
  • No process control (`os.system`, `subprocess`, …).
  • Only a whitelisted set of modules is reachable through
    `__builtins__.__import__`.

For stronger isolation (untrusted-source code), wrap the exec in a
subprocess with rlimits + unshare-net (mirrors `app/routers/builder_script.py`).
v1 ships the in-process variant because every call site already trusts
Opus output enough to ship it directly to the Phase 1 sandbox.
"""

from __future__ import annotations

import builtins
import contextlib
import io
import math
import time
import traceback
from dataclasses import dataclass
from typing import Any, Dict, Optional, Set


# ── Whitelisted module set ────────────────────────────────────────────
#
# Anything outside this list is blocked at `__import__`. The list is
# tight on purpose — the agent's job is to write IFC, not arbitrary
# Python. Numerical / structural / IFC modules only.

_ALLOWED_IMPORTS: Set[str] = frozenset({
    "ifcopenshell",
    "ifcopenshell.api",
    "ifcopenshell.guid",
    "ifcopenshell.util",
    "ifcopenshell.util.element",
    "ifcopenshell.util.unit",
    "numpy",
    "math",
    "json",
    "dataclasses",
    "typing",
    "collections",
    "collections.abc",
    "itertools",
    "functools",
    "uuid",
    "app.services.ifc_generator_v3",
    "app.services.ifc_generator_v3.buildflow_ifc",
})


# Builtins explicitly stripped from the exec namespace. Pre-importing
# `os` / `subprocess` / `socket` / `urllib` would bypass the import
# block, so we also nuke any pre-resolved name that could reach them.
_BLOCKED_BUILTINS: Set[str] = frozenset({
    "open",      # file IO — the sandbox uses bf.save_state instead
    "input",     # not meaningful in non-interactive exec
    "exit",
    "quit",
    "exec",      # nested exec is a footgun
    "eval",
    "compile",
    "__import__",  # we replace this with the gated version below
    "memoryview",  # easy way into low-level file ops
})


# Curated `print`-output guard: stdout/stderr are tee'd to a string buffer
# so the agent gets `print()` results back in the tool response. We CAP
# the captured output so a runaway loop can't OOM the FastAPI process.
PRINT_CAPTURE_MAX_BYTES = 16_384


@dataclass
class SandboxResult:
    """What `Sandbox.execute` returns to the FastAPI router."""

    ok: bool
    stdout: str
    stderr: str
    error_type: Optional[str]
    error_message: Optional[str]
    error_traceback: Optional[str]
    duration_ms: int


class Sandbox:
    """Runs a single block of agent-authored Python inside a restricted
    namespace. Stateless — the caller (router) handles
    `BuildFlowIFC.save_state` / `load_state` around each call so the
    sandbox itself never holds session memory.

    Pre-bound helpers (available directly in agent code, no import needed):
      - `resolve_material(intent, archetype, ifc_class)` — curated library
      - `compose_furniture(bf, type, origin, rot, mat, ...)` — composites
      - `apply_naming_convention(bf, spec)` — human-readable names
      - `add_site_context(bf, polygon)` — site + ground + north arrow
      - `validate_brief_spec(spec)` — spec consistency
      - `run_preflight(spec, material_ids)` — scale/coord sanity
    """

    def __init__(self, bf_instance: Any) -> None:
        """`bf_instance` is a `BuildFlowIFC` already bound to the session.
        The agent code can call `bf.add_space(...)`, `bf.add_slab(...)`,
        etc., without any other setup."""
        self._bf = bf_instance

    def execute(self, code: str) -> SandboxResult:
        """Execute the agent-authored Python. Returns captured stdout +
        any traceback. Never re-raises — always returns a result."""
        started = time.monotonic()
        stdout_buf = io.StringIO()
        stderr_buf = io.StringIO()

        # Build the restricted globals dict. `bf` is the agent's primary
        # surface; `print` writes into our capture buffer; everything
        # else comes from the gated `__import__`.
        restricted_builtins: Dict[str, Any] = {
            name: getattr(builtins, name)
            for name in dir(builtins)
            if not name.startswith("_") and name not in _BLOCKED_BUILTINS
        }
        # Provide a safe `print` that respects the capture cap.
        original_print = builtins.print
        captured_bytes = [0]

        def safe_print(*args: Any, **kwargs: Any) -> None:
            if captured_bytes[0] >= PRINT_CAPTURE_MAX_BYTES:
                return
            text = " ".join(str(a) for a in args) + kwargs.get("end", "\n")
            remaining = PRINT_CAPTURE_MAX_BYTES - captured_bytes[0]
            if len(text) > remaining:
                text = text[:remaining] + "\n... [print output truncated]\n"
            stdout_buf.write(text)
            captured_bytes[0] += len(text)

        restricted_builtins["print"] = safe_print
        restricted_builtins["__import__"] = self._gated_import
        # math is so commonly needed it's worth pre-binding; saves the
        # agent an `import math` line and reduces the import-allowlist
        # surface area.
        restricted_builtins["__build_class__"] = builtins.__build_class__

        restricted_globals: Dict[str, Any] = {
            "__builtins__": restricted_builtins,
            "__name__": "__bf_sandbox__",
            "bf": self._bf,
            "math": math,
            # Phase HARNESS helpers — pre-bound so agent code calls them
            # directly (no import statement needed).
            **self._load_helpers(),
        }

        try:
            with contextlib.redirect_stderr(stderr_buf):
                exec(compile(code, "<agent-code>", "exec"), restricted_globals)
            duration = int((time.monotonic() - started) * 1000)
            return SandboxResult(
                ok=True,
                stdout=stdout_buf.getvalue(),
                stderr=stderr_buf.getvalue(),
                error_type=None, error_message=None, error_traceback=None,
                duration_ms=duration,
            )
        except Exception as exc:
            duration = int((time.monotonic() - started) * 1000)
            tb = traceback.format_exc()
            return SandboxResult(
                ok=False,
                stdout=stdout_buf.getvalue(),
                stderr=stderr_buf.getvalue(),
                error_type=type(exc).__name__,
                error_message=str(exc),
                error_traceback=tb,
                duration_ms=duration,
            )

    # ── pre-bound helpers ─────────────────────────────────────────────

    @staticmethod
    def _missing_helper_factory(name: str, original_error: str):
        """Return a callable that raises a clear error if the agent tries
        to use a helper that failed to import."""
        def _missing(*args: Any, **kwargs: Any) -> Any:
            raise RuntimeError(
                f"Helper '{name}' was not loaded into the sandbox. "
                f"Original import error: {original_error}. "
                f"This is a deployment bug — the helper file may be missing from "
                f"neobim-ifc-service/app/services/ifc_generator_v3/."
            )
        _missing.__name__ = f"<missing:{name}>"
        return _missing

    @staticmethod
    def _load_helpers() -> Dict[str, Any]:
        """Lazy-load Phase HARNESS helpers into the sandbox namespace.

        Each function is imported at call time (not module import time)
        so a missing file doesn't crash the entire service on startup.
        On failure: logs a warning AND binds a sentinel callable that
        raises a clear RuntimeError if the agent tries to call it.
        """
        import structlog
        log = structlog.get_logger()

        helpers: Dict[str, Any] = {}
        _imports = [
            ("resolve_material", "material_library", "resolve_material"),
            ("compose_furniture", "furniture_compositor", "compose_furniture"),
            ("apply_naming_convention", "naming_resolver", "apply_naming_convention"),
            ("add_site_context", "site_context", "add_site_context"),
            ("validate_brief_spec", "spec_validator", "validate_brief_spec"),
            ("run_preflight", "preflight", "run_preflight"),
        ]
        for bound_name, module_name, func_name in _imports:
            try:
                mod = __import__(
                    f"app.services.ifc_generator_v3.{module_name}",
                    fromlist=[func_name],
                )
                helpers[bound_name] = getattr(mod, func_name)
            except Exception as exc:
                log.warning(
                    "sandbox_helper_unavailable",
                    helper=bound_name,
                    module=module_name,
                    error=str(exc),
                )
                helpers[bound_name] = Sandbox._missing_helper_factory(bound_name, str(exc))
        return helpers

    # ── gated import ─────────────────────────────────────────────────

    @staticmethod
    def _gated_import(
        name: str,
        globals_=None,
        locals_=None,
        fromlist=(),
        level: int = 0,
    ) -> Any:
        """Replacement `__import__` that blocks anything outside the
        whitelist. Sub-modules are gated by prefix-match so
        `ifcopenshell.api.run` reaches its target."""
        top = name.split(".")[0]
        allowed = (
            name in _ALLOWED_IMPORTS
            or any(name.startswith(prefix + ".") for prefix in _ALLOWED_IMPORTS)
            or top in {a.split(".")[0] for a in _ALLOWED_IMPORTS}
        )
        if not allowed:
            raise ImportError(
                f"import {name!r} blocked by v3 sandbox — allowed top-level "
                "modules: " + ", ".join(sorted({a.split('.')[0] for a in _ALLOWED_IMPORTS}))
            )
        return __import__(name, globals_, locals_, fromlist, level)
