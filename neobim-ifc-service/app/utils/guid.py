"""IFC GlobalId generation — deterministic UUID v5 → 22-char base64.

Phase 2 (Fix 5): every GlobalId emitted by this service is now derived
from stable inputs. Same MassingGeometry → same GUIDs across re-runs.
That is required for change-tracking, diff-based downstream syncing,
and the writeback flows in Phases 5–6.

Resolution model
----------------
The GUID seed is `<project_namespace> | <part_1> | <part_2> | ...`.
`project_namespace` is set once per build (top of `build_ifc`) via
`set_project_namespace()` and read by every emitter through
`derive_guid(*parts)`. We use `contextvars.ContextVar` so concurrent
async requests (FastAPI workers) don't trample each other's namespace.

If a build forgets to call `set_project_namespace()`, the default
namespace `"neobim-ifc-service"` is used — the build still succeeds
deterministically across re-runs, but cross-project GUID collisions
become possible. The audit baseline + tests catch any caller that
forgets to set the namespace.

Random GUIDs are still available via `random_guid()` for the rare
cases where determinism is impossible (e.g. ad-hoc temp entities used
during the audit endpoint's parse-and-discard flow). All emitter code
paths use `derive_guid()`.

Reference: buildingSMART base-64 spec — 64-char alphabet
`0-9 A-Z a-z _ $`, big-endian compression of the 128-bit UUID into 22
chars (3 chars for the leading 6 bits + 21 chars for the remaining 126
bits).
"""

from __future__ import annotations

import uuid
from contextvars import ContextVar
from typing import Iterable

# IFC base64 alphabet (different from RFC 4648 standard base64).
_IFC_B64 = (
    "0123456789"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    "_$"
)

# buildingSMART-published OID namespace UUID — the canonical seed for
# IFC v5 GUID derivation. Reference: §2.1 Fix 5 of the TS-exporter R&D
# report and the original buildingSMART-tech blog post.
BUILDINGSMART_NAMESPACE = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")

_DEFAULT_PROJECT_NAMESPACE = "neobim-ifc-service"

_PROJECT_NS: ContextVar[str] = ContextVar(
    "neobim_project_namespace",
    default=_DEFAULT_PROJECT_NAMESPACE,
)


# ── Namespace lifecycle ───────────────────────────────────────────────


def set_project_namespace(*parts: str) -> None:
    """Set the per-build namespace seed.

    Call once at the top of `build_ifc()` before emitters run. Pass
    every input that uniquely identifies the build (project name,
    building name, site name) so two different builds with different
    inputs cannot collide.
    """
    seed = "|".join(p for p in parts if p) or _DEFAULT_PROJECT_NAMESPACE
    _PROJECT_NS.set(seed)


def get_project_namespace() -> str:
    return _PROJECT_NS.get()


def reset_project_namespace() -> None:
    """Reset to the default. Useful in tests + the audit endpoint."""
    _PROJECT_NS.set(_DEFAULT_PROJECT_NAMESPACE)


# ── GUID derivation ───────────────────────────────────────────────────


def _uuid_to_ifc_guid(u: uuid.UUID) -> str:
    """Convert a UUID to a 22-character IFC GlobalId (base64 encoded).

    The big-endian-with-leading-2-bits convention used by buildingSMART
    is preserved: the first emitted character covers the leading 2 bits
    only (so its value is always 0–3), and the remaining 21 characters
    cover 6 bits each.
    """
    n = u.int
    chars: list[str] = []
    # Pull 21 chars of 6 bits each from the LSB end first…
    for _ in range(21):
        chars.append(_IFC_B64[n & 0x3F])
        n >>= 6
    # …and the final char encodes the remaining 2 bits.
    chars.append(_IFC_B64[n & 0x03])
    return "".join(reversed(chars))


def derive_guid(*parts: object) -> str:
    """Deterministic 22-char IFC GUID derived from stable inputs.

    Layout: namespace | part_1 | part_2 | … hashed into a UUID5 against
    the buildingSMART namespace, then compressed.

    Pass enough parts to make the seed unique per entity:
      * For instances:   ("IfcWall", elem.id)
      * For types:       ("IfcWallType", dedup_signature_str)
      * For relationships: ("IfcRelDefinesByType", type_guid, related_guid)
    """
    ns = get_project_namespace()
    seed = "|".join([ns] + [str(p) for p in parts])
    u = uuid.uuid5(BUILDINGSMART_NAMESPACE, seed)
    return _uuid_to_ifc_guid(u)


def random_guid() -> str:
    """Random 22-char IFC GUID. Use ONLY when determinism is impossible.

    Currently used by: nothing in the build path. Kept for future code
    that may need a non-derivable GUID (e.g. ad-hoc temporary entities
    during a parse-and-discard flow). All build-path GUIDs go through
    `derive_guid()`.
    """
    return _uuid_to_ifc_guid(uuid.uuid4())


# ── Backward-compatible alias ─────────────────────────────────────────
#
# `new_guid()` was the old random-uuid4 generator. Phase 2 keeps the
# symbol so the call sites that haven't been migrated still link, but
# routes it through `derive_guid()` with the caller's filename + a
# monotonically-increasing counter inside this contextvar to keep
# *uniqueness within a single build*. This is a safety net only —
# emitters should be migrated to `derive_guid()` with explicit stable
# parts in the same Phase 2 commit. Any remaining `new_guid()` call
# after Phase 2 is technically deterministic per-build but fragile to
# call-order changes; emit them only as a last resort.

_NEW_GUID_COUNTER: ContextVar[int] = ContextVar("neobim_new_guid_counter", default=0)


def new_guid() -> str:
    """Deprecated alias — derives a per-build-monotonic GUID.

    Migrate call sites to `derive_guid(...)` with explicit stable
    parts. This wrapper exists so emitters that haven't been migrated
    yet still produce deterministic output across re-runs of the same
    build (the counter resets via `reset_new_guid_counter()` at the
    start of each build).
    """
    n = _NEW_GUID_COUNTER.get() + 1
    _NEW_GUID_COUNTER.set(n)
    return derive_guid("legacy_new_guid", str(n))


def reset_new_guid_counter() -> None:
    """Call at the start of each build — keeps `new_guid()` callers
    deterministic across re-runs of the same build.
    """
    _NEW_GUID_COUNTER.set(0)


# ── ifcopenshell.guid.new monkey-patch ────────────────────────────────
#
# Phase 2 / Fix 5 root cause: `ifcopenshell.api.run("...")` internally
# calls `ifcopenshell.guid.new()` — random uuid4 — when it constructs
# relationship/auxiliary entities that we never set GlobalId on
# explicitly (IfcRelAggregates, IfcRelContainedInSpatialStructure,
# IfcRelDefinesByProperties from `pset.add_pset`, etc.). Even though
# every emitter call site that *we* control uses `derive_guid`, the
# api-internal calls leak random GUIDs into the file.
#
# Monkey-patching `ifcopenshell.guid.new` to route through our
# deterministic counter wrapper closes that hole. Counter resets at the
# top of every build (via `reset_new_guid_counter()`), so re-running
# the same build produces byte-identical GUIDs — which is exactly what
# the audit-script determinism check is asserting.
#
# Done at module import time. Idempotent (re-import doesn't re-patch).

def _install_ifcopenshell_guid_patch() -> None:
    try:
        import ifcopenshell.guid as _guid_mod
    except Exception:
        return  # ifcopenshell unavailable — non-fatal at import
    if getattr(_guid_mod, "_neobim_patched", False):
        return
    _guid_mod._neobim_original_new = _guid_mod.new

    def _patched_new() -> str:
        # Same wrapper path as `new_guid()` — counter-based deterministic
        # GUID. Call sites that haven't migrated to explicit `derive_guid`
        # AND every api-internal callsite share this counter, which
        # keeps build re-runs byte-identical.
        return new_guid()

    _guid_mod.new = _patched_new
    _guid_mod._neobim_patched = True


_install_ifcopenshell_guid_patch()


# ── Convenience: derive multiple stable GUIDs at once ─────────────────


def derive_guids(seeds: Iterable[Iterable[object]]) -> list[str]:
    """Vectorised `derive_guid` for the same project namespace."""
    return [derive_guid(*parts) for parts in seeds]
