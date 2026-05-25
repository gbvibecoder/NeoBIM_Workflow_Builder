"""KOS Phase 5C-3 PR 4 — annotation library invariants + Team2 contract."""

from __future__ import annotations

import dataclasses

import pytest

from app.services.kos_annotation_library import (
    AnnotationEntry,
    TEAM2_NON_OPENING_LABELS,
    TEAM2_OPENING_LIBRARY,
    get_opening_entry,
    is_non_opening_label,
    list_known_firms,
)


# ── frozen-dataclass + library shape invariants ──────────────────────────────


def test_annotation_entry_is_frozen():
    e = TEAM2_OPENING_LIBRARY[0]
    with pytest.raises(dataclasses.FrozenInstanceError):
        e.label = "X"  # type: ignore[misc]


def test_team2_library_nonempty():
    assert len(TEAM2_OPENING_LIBRARY) >= 3


def test_team2_library_invariants():
    """Per-entry sanity checks. If a future entry violates these, the suite
    fails immediately rather than degrading silently at runtime."""
    for entry in TEAM2_OPENING_LIBRARY:
        assert isinstance(entry, AnnotationEntry)
        assert entry.label, "label must be non-empty"
        assert entry.opening_type in ("door", "window", "sliding_door")
        assert entry.default_width_mm > 0, f"{entry.label}: width must be > 0"
        assert entry.default_height_mm > 0, f"{entry.label}: height must be > 0"
        assert entry.default_sill_height_mm >= 0, (
            f"{entry.label}: sill must be ≥ 0"
        )
        # door → sill=0; window → sill>0; sliding_door → sill=0 (floor-tracked)
        if entry.opening_type in ("door", "sliding_door"):
            assert entry.default_sill_height_mm == 0
        elif entry.opening_type == "window":
            assert entry.default_sill_height_mm > 0
        assert 0.0 <= entry.confidence_modifier <= 1.0


def test_team2_library_labels_unique():
    labels = [e.label for e in TEAM2_OPENING_LIBRARY]
    assert len(labels) == len(set(labels)), "duplicate label in library"


def test_team2_library_includes_sd_dw1_dw2():
    """v1 baseline must include the three Team2-confirmed labels."""
    labels = {e.label for e in TEAM2_OPENING_LIBRARY}
    assert labels >= {"SD", "DW1", "DW2"}


def test_non_opening_labels_nonempty():
    assert len(TEAM2_NON_OPENING_LABELS) >= 10


def test_no_overlap_between_opening_and_non_opening():
    """A label cannot be both an opening AND explicitly excluded."""
    opening_labels = {e.label for e in TEAM2_OPENING_LIBRARY}
    assert not (opening_labels & TEAM2_NON_OPENING_LABELS), (
        f"overlap: {opening_labels & TEAM2_NON_OPENING_LABELS}"
    )


# ── get_opening_entry ────────────────────────────────────────────────────────


@pytest.mark.parametrize("label,kind", [
    ("SD", "sliding_door"),
    ("DW1", "door"),
    ("DW2", "door"),
])
def test_get_opening_entry_known_labels(label, kind):
    e = get_opening_entry(label, firm="team2")
    assert e is not None
    assert e.opening_type == kind


@pytest.mark.parametrize("label", ["RWO", "CW5", "CFW1", "TD", "FW", "SK", "CO"])
def test_get_opening_entry_non_opening_returns_none(label):
    """Non-opening labels are NOT in the opening library."""
    assert get_opening_entry(label, firm="team2") is None


@pytest.mark.parametrize("label", ["XYZ", "FOO", "RANDOM_LABEL", "Door"])
def test_get_opening_entry_unknown_returns_none(label):
    """Unknown labels return None too (callers can't tell the difference
    via get_opening_entry alone — they must check is_non_opening_label)."""
    assert get_opening_entry(label, firm="team2") is None


def test_get_opening_entry_unknown_firm_returns_none():
    assert get_opening_entry("SD", firm="non_existent_firm") is None


def test_get_opening_entry_case_sensitive():
    """Labels are case-sensitive — 'sd' is NOT 'SD'."""
    assert get_opening_entry("sd", firm="team2") is None
    assert get_opening_entry("dw1", firm="team2") is None


# ── is_non_opening_label ─────────────────────────────────────────────────────


@pytest.mark.parametrize("label", [
    "RWO", "RWD", "TD", "FW", "SK", "CO", "IM", "STW", "DHW",
    "CW1", "CW5", "CW10", "CFW1", "CFW2", "CFW3", "PDFW", "CW",
    "EL", "SSL", "MIN", "MAX", "TBC", "DIM", "SLAB", "STEP", "UP",
    "LH", "JK", "TC", "MR", "RV",
])
def test_is_non_opening_label_excluded(label):
    assert is_non_opening_label(label, firm="team2")


@pytest.mark.parametrize("label", ["SD", "DW1", "DW2"])
def test_is_non_opening_label_for_openings_is_false(label):
    """An opening label is NOT excluded (else it could never be detected)."""
    assert not is_non_opening_label(label, firm="team2")


@pytest.mark.parametrize("label", ["XYZ", "FOO", "RANDOM"])
def test_is_non_opening_label_unknown_is_false(label):
    """Unknown labels return False — they're not explicitly excluded.
    (Detection still ignores them because get_opening_entry returns None.)"""
    assert not is_non_opening_label(label, firm="team2")


def test_is_non_opening_label_unknown_firm():
    assert not is_non_opening_label("RWO", firm="non_existent_firm")


# ── list_known_firms ─────────────────────────────────────────────────────────


def test_list_known_firms_contains_team2():
    assert "team2" in list_known_firms()
