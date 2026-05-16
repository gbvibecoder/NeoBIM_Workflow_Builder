"""Disk-backed session persistence for the v3 generator agent loop.

The agent loop runs across multiple HTTP round-trips (one per tool call),
which means the FastAPI handler can't keep `BuildFlowIFC` in process
memory between calls. Each session gets a scratch directory under
`/tmp/bf-sessions/{session_id}/`; `BuildFlowIFC.save_state` / `load_state`
hand the state across the request/response boundary.

The store also enforces a TTL — sessions older than `SESSION_TTL_SECONDS`
are eligible for the cleanup sweep. Caller is responsible for invoking
`purge_stale()` periodically (cron, scheduled task, or sweep-on-create).
"""

from __future__ import annotations

import os
import re
import shutil
import tempfile
import time
import uuid
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


# 30 minutes per spec. Sessions get garbage-collected after this.
SESSION_TTL_SECONDS = 30 * 60

# Where session scratch directories live. /tmp is fine — Railway clears
# /tmp between deploys and the session lifecycle is request-scoped anyway.
_SESSIONS_ROOT_ENV = "BF_V3_SESSIONS_ROOT"
_DEFAULT_SESSIONS_ROOT = os.path.join(tempfile.gettempdir(), "bf-sessions")

# Session IDs must look like UUIDv4 hex (32 chars, lowercase, no dashes).
# Anything else → reject up front so a path-traversal payload can't
# escape /tmp/bf-sessions/.
_SESSION_ID_RE = re.compile(r"^[a-f0-9]{12,64}$")


def _sessions_root() -> str:
    return os.environ.get(_SESSIONS_ROOT_ENV, _DEFAULT_SESSIONS_ROOT)


@dataclass(frozen=True)
class SessionHandle:
    """Reference to a scratch directory on disk."""

    session_id: str
    path: str

    @property
    def state_ifc_path(self) -> str:
        return os.path.join(self.path, "state.ifc")

    @property
    def meta_path(self) -> str:
        return os.path.join(self.path, "meta.json")

    @property
    def has_state(self) -> bool:
        return os.path.isfile(self.state_ifc_path) and os.path.isfile(self.meta_path)


class SessionStore:
    """Filesystem-backed session-handle factory + GC."""

    def __init__(self, root: Optional[str] = None) -> None:
        self._root = root or _sessions_root()
        os.makedirs(self._root, exist_ok=True)

    # ── handle resolution ────────────────────────────────────────────

    def new_session(self) -> SessionHandle:
        """Allocate a fresh session directory."""
        sid = uuid.uuid4().hex
        path = os.path.join(self._root, sid)
        os.makedirs(path, exist_ok=True)
        return SessionHandle(session_id=sid, path=path)

    def get(self, session_id: str) -> SessionHandle:
        """Resolve an existing session by id. Raises `ValueError` on a
        malformed id (path-traversal guard) and `FileNotFoundError` if
        the scratch dir doesn't exist."""
        if not isinstance(session_id, str) or not _SESSION_ID_RE.match(session_id):
            raise ValueError(
                f"invalid session id {session_id!r} — must be 12-64 lowercase hex chars"
            )
        path = os.path.join(self._root, session_id)
        if not os.path.isdir(path):
            raise FileNotFoundError(f"session {session_id} not found")
        return SessionHandle(session_id=session_id, path=path)

    def get_or_create(self, session_id: Optional[str]) -> SessionHandle:
        """Resolve or allocate. Used by the FastAPI handler when the
        client supplies a session header on a fresh exec call."""
        if not session_id:
            return self.new_session()
        try:
            return self.get(session_id)
        except FileNotFoundError:
            # Caller supplied a session id that doesn't exist — likely
            # the scratch dir got swept. Allocate a fresh one but keep
            # the same id so the caller's correlation works.
            if not _SESSION_ID_RE.match(session_id):
                raise ValueError(
                    f"invalid session id {session_id!r} — must be 12-64 lowercase hex chars"
                )
            path = os.path.join(self._root, session_id)
            os.makedirs(path, exist_ok=True)
            return SessionHandle(session_id=session_id, path=path)

    # ── bootstrap (Phase v3 completion pass) ─────────────────────────

    def bootstrap_session(
        self,
        brief: Dict[str, Any],
        session_id: Optional[str] = None,
    ) -> Tuple[SessionHandle, Any]:
        """Allocate (or resolve) a session AND write the initial IFC
        state to disk *before* any agent code runs.

        Two things this does that the old "construct-then-exec-then-save"
        flow did NOT:

          1. Materialises every space declared in `brief["spaces"]` —
             calling `bf.add_space` / `bf.add_circular_space` for each
             — so the bootstrapped IFC already contains the brief's
             spatial program, not just an empty project hierarchy.

          2. Saves `state.ifc` + `meta.json` immediately, so the very
             next `/api/v3/generator/{summary,validate}` call has data
             to read without requiring an `/exec` first.

        This closes the `read_ifc_summary on turn 1 returns null` edge
        case the prior phase flagged (§XII.7 of the v3 generator report).
        The agent's system prompt no longer instructs it to add spaces —
        those are now bootstrap-owned.

        Returns `(handle, bf)`. The caller (router) typically discards
        `bf` immediately and lets subsequent `/exec` calls re-hydrate it
        via `BuildFlowIFC.load_state` — the on-disk state is the
        cross-call source of truth.
        """
        # Lazy import — BuildFlowIFC imports ifcopenshell, which is
        # heavyweight; keep session_store cheap when only `new_session`
        # / `purge_stale` is needed (e.g. the GC endpoint).
        from .buildflow_ifc import BuildFlowIFC

        handle = self.get_or_create(session_id)
        bf = BuildFlowIFC(brief)

        # Materialise spaces from the brief. Circular spaces (where
        # `polygon_world_m` is null AND `circular_centre_radius` is
        # supplied) route to `add_circular_space`; everything else
        # uses the polygon-extrude path.
        for sp in brief.get("spaces", []) or []:
            sp_id = str(sp.get("id", ""))
            if not sp_id:
                continue
            long_name = str(sp.get("long_name", "") or sp.get("name", "") or "")
            occupancy = str(sp.get("occupancy_type", "Internal") or "Internal")
            height = float(sp.get("height_m", 3.0) or 3.0)
            polygon = sp.get("polygon_world_m")
            ccr = sp.get("circular_centre_radius")
            if polygon is None and isinstance(ccr, (list, tuple)) and len(ccr) == 3:
                bf.add_circular_space(
                    space_id=sp_id,
                    centre=(float(ccr[0]), float(ccr[1])),
                    radius=float(ccr[2]),
                    height=height,
                    long_name=long_name,
                    occupancy=occupancy,
                )
            elif isinstance(polygon, list) and len(polygon) >= 3:
                bf.add_space(
                    space_id=sp_id,
                    polygon=[(float(p[0]), float(p[1])) for p in polygon],
                    height=height,
                    long_name=long_name,
                    occupancy=occupancy,
                )
            # If neither polygon nor circular_centre_radius is supplied,
            # silently skip the space — the agent loop can still observe
            # it via the brief JSON passed through to `run_python`.

        bf.save_state(handle.path)
        return handle, bf

    def summarize_session(
        self,
        session_id: str,
    ) -> Dict[str, Any]:
        """Read-only summary of a session's on-disk IFC. Used by the
        `/summary` endpoint AND by the bootstrap test (which never
        invokes `/exec`)."""
        # Lazy import — keeps the session_store module light.
        from .validate import summarize_ifc_file

        handle = self.get(session_id)
        return summarize_ifc_file(handle.state_ifc_path)

    # ── lifecycle ────────────────────────────────────────────────────

    def discard(self, handle: SessionHandle) -> None:
        """Forget a session — caller-driven cleanup (e.g. on finalize)."""
        try:
            shutil.rmtree(handle.path, ignore_errors=True)
        except Exception:
            pass

    def purge_stale(self, ttl_seconds: int = SESSION_TTL_SECONDS) -> List[str]:
        """Sweep sessions older than `ttl_seconds`. Returns the ids of
        sessions purged so the caller can log them."""
        now = time.time()
        purged: List[str] = []
        if not os.path.isdir(self._root):
            return purged
        for entry in os.listdir(self._root):
            full = os.path.join(self._root, entry)
            if not os.path.isdir(full):
                continue
            try:
                age = now - os.path.getmtime(full)
            except OSError:
                continue
            if age > ttl_seconds:
                shutil.rmtree(full, ignore_errors=True)
                purged.append(entry)
        return purged
