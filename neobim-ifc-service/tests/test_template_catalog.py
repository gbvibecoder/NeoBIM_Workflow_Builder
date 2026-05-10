"""Slice 2B.1 — TemplateDescriptor catalog regression tests.

Pin invariants the matcher prompt + dispatcher rely on:

* Exactly nine entries — one per Tier-2 builder.
* Every TemplateId enum value appears exactly once.
* Plot bounds are componentwise well-formed (min <= max, all positive).
* Each entry carries at least three few-shot brief examples — the
  matcher prompt embeds these, and a thin example pool degrades match
  quality on edge cases.
* (BHK family, form factor) pairs are unique — the matcher's
  classification space is exactly the 3 x 3 grid.
"""

from __future__ import annotations

import pytest

from app.services.design_agent import (
    CATALOG,
    TemplateDescriptor,
    TemplateId,
    descriptor_for,
)


def test_catalog_has_nine_entries() -> None:
    """The matcher classifies into exactly nine templates."""
    assert len(CATALOG) == 9, (
        f"catalog has {len(CATALOG)} entries; expected 9 "
        f"(3 BHK families x 3 form factors)"
    )


def test_catalog_template_ids_unique() -> None:
    """Every catalog row carries a distinct TemplateId."""
    ids = [d.template_id for d in CATALOG]
    assert len(ids) == len(set(ids)), (
        f"duplicate template_id in catalog: {ids}"
    )


def test_catalog_covers_every_template_id_enum_value() -> None:
    """Every TemplateId enum member has a matching catalog entry."""
    catalog_ids = {d.template_id for d in CATALOG}
    enum_ids = set(TemplateId)
    missing = enum_ids - catalog_ids
    extra = catalog_ids - enum_ids
    assert not missing, f"catalog missing template_id(s): {missing}"
    assert not extra, f"catalog has un-enum'd template_id(s): {extra}"


def test_catalog_plot_bounds_well_formed() -> None:
    """min plot dims must be componentwise <= max, all positive.

    The TemplateDescriptor model_validator catches this on construction;
    this is a belt-and-suspenders sentinel for any future descriptor
    that bypasses .build().
    """
    for d in CATALOG:
        min_w, min_l = d.typical_plot_min_m
        max_w, max_l = d.typical_plot_max_m
        assert min_w > 0 and min_l > 0, (
            f"{d.template_id}: min plot must be positive ({min_w}, {min_l})"
        )
        assert max_w > 0 and max_l > 0, (
            f"{d.template_id}: max plot must be positive ({max_w}, {max_l})"
        )
        assert min_w <= max_w, (
            f"{d.template_id}: min_w {min_w} > max_w {max_w}"
        )
        assert min_l <= max_l, (
            f"{d.template_id}: min_l {min_l} > max_l {max_l}"
        )


def test_catalog_each_entry_has_three_or_more_few_shot_examples() -> None:
    """Few-shot brief pool must be substantial enough to anchor the LLM."""
    for d in CATALOG:
        assert len(d.suitable_for_briefs_like) >= 3, (
            f"{d.template_id}: only {len(d.suitable_for_briefs_like)} "
            f"few-shot examples; need at least 3"
        )


def test_catalog_few_shot_examples_are_non_empty_strings() -> None:
    """No blank example strings — the matcher prompt embeds these
    verbatim and a blank string would degrade prompt quality.
    """
    for d in CATALOG:
        for i, example in enumerate(d.suitable_for_briefs_like):
            assert isinstance(example, str), (
                f"{d.template_id} example[{i}]: not a string"
            )
            assert example.strip(), (
                f"{d.template_id} example[{i}]: blank string"
            )


def test_catalog_bhk_form_factor_pairs_unique() -> None:
    """The 3 BHK families x 3 form factors classification space is
    exactly populated — no two catalog rows share both axes.
    """
    pairs = [(d.bhk_family, d.form_factor) for d in CATALOG]
    assert len(pairs) == len(set(pairs)), (
        f"duplicate (bhk_family, form_factor) pair: {pairs}"
    )
    expected = {
        (bhk, ff)
        for bhk in ("1BHK", "2BHK", "3BHK")
        for ff in ("house", "duplex", "tower")
    }
    assert set(pairs) == expected, (
        f"catalog (bhk, form_factor) coverage drift; "
        f"missing={expected - set(pairs)}; extra={set(pairs) - expected}"
    )


def test_catalog_tower_descriptions_mention_stilt_or_habitable() -> None:
    """Tower descriptors must mention the stilt-parking + habitable-floor
    pattern so the LLM learns to populate ``habitable_floor_count`` and
    ``has_stilt_parking`` on TemplateParameters.
    """
    tower_ids = {
        TemplateId.BHK1_PUNE_TOWER,
        TemplateId.BHK2_PUNE_TOWER,
        TemplateId.BHK3_PUNE_TOWER,
    }
    for d in CATALOG:
        if d.template_id in tower_ids:
            text = (d.description + d.floor_count).lower()
            assert "stilt" in text or "habitable" in text, (
                f"{d.template_id}: description / floor_count must "
                f"mention 'stilt' or 'habitable'; got "
                f"description={d.description!r} floor_count={d.floor_count!r}"
            )


def test_descriptor_for_returns_correct_descriptor() -> None:
    """``descriptor_for`` indexes correctly for each TemplateId."""
    for tid in TemplateId:
        d = descriptor_for(tid)
        assert isinstance(d, TemplateDescriptor)
        assert d.template_id == tid


def test_descriptor_for_unknown_template_id_raises() -> None:
    """Unknown TemplateId surfaces as KeyError — surfaces as a hard
    failure rather than silent None.

    We can't easily synthesise an enum value that's outside the closed
    enum set, so we patch the lookup directly to verify the error
    branch.
    """
    from app.services.design_agent import template_catalog as tc

    # Backup and remove a real id from the lookup to simulate a drift
    real_id = TemplateId.BHK2_PUNE_HOUSE
    saved = tc._BY_ID.pop(real_id)
    try:
        with pytest.raises(KeyError, match="No catalog descriptor"):
            tc.descriptor_for(real_id)
    finally:
        tc._BY_ID[real_id] = saved


def test_template_id_str_enum_values_match_function_names() -> None:
    """Each TemplateId value is the *exact* public function name in
    ``app.templates``. The dispatcher relies on this — and the cache
    files committed with this slice store the literal string value."""
    expected = {
        "build_1bhk_pune_house",
        "build_1bhk_pune_duplex",
        "build_1bhk_pune_tower",
        "build_2bhk_pune_house",
        "build_2bhk_pune_duplex",
        "build_2bhk_pune_tower",
        "build_3bhk_pune_house",
        "build_3bhk_pune_duplex",
        "build_3bhk_pune_tower",
    }
    assert {t.value for t in TemplateId} == expected
