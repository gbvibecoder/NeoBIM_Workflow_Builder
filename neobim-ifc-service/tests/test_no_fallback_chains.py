"""Phase 1 Slice 5 — wide grep gate against fallback chains in parametric builders.

The Phase 1 spec demands that no `_parametric` builder function carries
"missing-data fallback" patterns. The legacy builders (their `_parametric`-
less twins) are allowed to keep their fallbacks until Slice 7's cleanup
deletes them outright.

This test scans every `app/services/*_builder.py` module, extracts each
function whose name ends in `_parametric`, and asserts the function body
contains zero matches against the wider regex agreed during Slice 5
planning:

    \\bor\\s+(?:[0-9]+(?:\\.[0-9]+)?|props\\.\\w+|storey_elevation)\\b
    | if\\s+v\\d+\\.\\w+\\s+else

This catches:
    * `or 1.0`, `or 0.4`, `or 0.25`, `or 0.30`, `or 0.9`, … any decimal/int
    * `or props.length`, `or props.height`, `or props.X`
    * `or storey_elevation`
    * `if v0.z else`, `if v1.x else`, … any `if vN.attr else`

If any parametric function trips the regex, the BuildingModel is failing
to carry the answer that the parametric builder needs — which is a
domain-schema gap the slice author should escalate, not paper over with
a fallback.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest


_REPO_ROOT = Path(__file__).resolve().parent.parent
_BUILDERS_DIR = _REPO_ROOT / "app" / "services"

# Files explicitly in scope: every *_builder.py
_BUILDER_FILES = sorted(_BUILDERS_DIR.glob("*_builder.py"))

# The canonical fallback-chain regex agreed in Slice 5 planning.
_FALLBACK_PATTERN = re.compile(
    r"\bor\s+(?:[0-9]+(?:\.[0-9]+)?|props\.\w+|storey_elevation)\b"
    r"|if\s+v\d+\.\w+\s+else"
)


def _parametric_function_bodies() -> list[tuple[str, str, str]]:
    """For every parametric builder across every builder file, return a
    list of (file_path_str, function_name, function_source). Uses ast to
    parse function defs so we don't accidentally pick up substrings
    inside legacy functions sharing the same module."""
    out: list[tuple[str, str, str]] = []
    for builder_path in _BUILDER_FILES:
        text = builder_path.read_text()
        try:
            tree = ast.parse(text)
        except SyntaxError as e:
            pytest.fail(f"Could not parse {builder_path.name}: {e}")
        # Build a fast line-number → text mapping so we can extract by line range.
        lines = text.splitlines()
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if not node.name.endswith("_parametric"):
                    continue
                start = node.lineno - 1
                end = (node.end_lineno or node.lineno)
                body_text = "\n".join(lines[start:end])
                out.append((builder_path.name, node.name, body_text))
    return out


def test_at_least_one_parametric_function_exists():
    """Sanity: if the regex finds zero matches but there are no parametric
    functions to scan, the gate is silently asleep. Pin the discovered
    set so CI catches a missing builder."""
    discovered = {(name,) for _file, name, _body in _parametric_function_bodies()}
    expected_parametric_names = {
        "create_wall_parametric",
        "create_slab_parametric",
        "create_column_parametric",
        "create_beam_parametric",
        "create_opening_parametric",
        "create_door_parametric",
        "create_window_parametric",
        "create_space_parametric",
        "create_stair_parametric",
        "create_mep_equipment_parametric",
        "create_mep_segment_parametric",
        "create_mep_terminal_parametric",
    }
    actual = {name for (name,) in discovered}
    missing = expected_parametric_names - actual
    assert not missing, f"Missing parametric builders: {missing}"


@pytest.mark.parametrize(
    "file_name,fn_name,fn_body",
    _parametric_function_bodies(),
    ids=lambda v: v if isinstance(v, str) and v.endswith("_parametric") else None,
)
def test_no_fallback_chains_in_parametric_builder(
    file_name: str, fn_name: str, fn_body: str
):
    """Per the Slice 5 wide grep gate: every parametric builder must be
    free of fallback chains. The BuildingModel + ResolvedPlacement +
    ResolvedGeometry are authoritative."""
    matches = list(_FALLBACK_PATTERN.finditer(fn_body))
    if matches:
        snippets = [
            f"{file_name}::{fn_name} line offset {m.start()}: '{m.group(0)}'"
            for m in matches
        ]
        pytest.fail(
            f"{len(matches)} fallback-chain match(es) in {fn_name}:\n"
            + "\n".join(f"  - {s}" for s in snippets)
            + "\n\nIf the BuildingModel is missing data the parametric builder "
            "needs, escalate the domain-schema gap instead of adding a fallback."
        )


def test_legacy_functions_NOT_scanned():
    """Defensive: confirm the gate does not scan legacy `create_<x>` (no
    suffix). They're allowed to keep their fallback chains until Slice 7
    cleanup deletes the legacy path."""
    bodies = _parametric_function_bodies()
    for _file, fn_name, _body in bodies:
        assert fn_name.endswith("_parametric"), (
            f"Gate accidentally captured a non-parametric function: {fn_name}"
        )


def test_regex_does_match_known_legacy_fallback_patterns():
    """Self-test: the regex should fire on the legacy patterns we want to
    eliminate. If it doesn't fire on any of these examples, the gate is
    silently broken."""
    samples = [
        "thickness = props.thickness or 0.25",
        "length = props.length or 1.0",
        "height = props.height or 3.0",
        "diameter = props.diameter or 0.1",
        "cz = v0.z if v0.z else storey_elevation",
        "base_z = v0.z if v0.z else storey_elevation",
    ]
    for s in samples:
        assert _FALLBACK_PATTERN.search(s), (
            f"Regex failed to match expected legacy pattern: {s!r}"
        )
