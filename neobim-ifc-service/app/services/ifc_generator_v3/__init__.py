"""Brief-to-IFC v3 — generator-agent helper library + sandbox + validator.

Public surface:
    BuildFlowIFC                — the helper hiding IFC2X3 strictness from
                                  Anthropic-authored Python.
    BuildFlowIFCError           — raised on schema-strictness violations.
    validate_ifc_file(path)     — schema + reference-resolution validator.
    summarize_ifc_file(path)    — structured summary for the agent loop.
    SessionStore                — disk-backed session persistence for
                                  multi-turn tool-use calls.
    Sandbox                     — restricted exec environment that runs
                                  agent-authored Python with `bf` pre-bound.

Everything is designed so the v3 agent loop can write ~20-40 lines of
Python in `run_python` and produce a Concierge-class IFC without ever
touching ifcopenshell raw.
"""

from .buildflow_ifc import BuildFlowIFC, BuildFlowIFCError
from .session_store import SessionStore, SessionHandle
from .sandbox import Sandbox, SandboxResult
from .validate import validate_ifc_file, summarize_ifc_file

__all__ = [
    "BuildFlowIFC",
    "BuildFlowIFCError",
    "SessionStore",
    "SessionHandle",
    "Sandbox",
    "SandboxResult",
    "validate_ifc_file",
    "summarize_ifc_file",
]
