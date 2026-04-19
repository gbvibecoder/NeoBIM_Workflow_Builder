# IFC Baseline Regeneration

> **Purpose:** practical guide for updating the Phase 1 Track D baseline when
> the IFC pipeline intentionally changes what it produces. Do NOT use this
> guide to make a failing test pass when the test surfaces a real regression.
> The whole point of the baseline is to catch regressions — only regenerate
> when the change is deliberate and reviewed.

## What the baseline guards

Two test suites, mirrored on either side of the TS↔Python boundary:

| File | Runs | What it asserts |
|---|---|---|
| `neobim-ifc-service/tests/test_baseline_quality.py` | pytest (CI: `ifc-baseline.yml`) | Schema validity, per-discipline entity floors, spatial-hierarchy connectivity, opening-wall relationships, material/pset coverage, file-size band |
| `tests/integration/ifc-ex-001-payload.test.ts` | vitest (CI: `ifc-baseline.yml` + `build.yml`) | Request URL, auth header, body shape (camelCase), richMode forwarding, Track C field preservation |
| `tests/integration/ifc-track-c-boundary.test.ts` | vitest | TS→wire field name contract (26 Track C fields, 13 new type literals, 8 new ifcType literals) |
| `neobim-ifc-service/tests/test_track_c_fields.py` | pytest | Wire→Python contract (Pydantic accepts all camelCase aliases without drop) |

Together these are the "best IFC" gate. A PR cannot merge if it reduces any
of these invariants.

## When to regenerate

| Scenario | Action |
|---|---|
| Test fails because you *actually* regressed quality | **Do not regenerate.** Fix the regression. |
| You intentionally added emitters for more entity types (e.g. rebar, curtain walls) — the output now has MORE entities | Floors are minimums, so most tests still pass. But if a *new* invariant is worth enforcing (e.g. "now IfcReinforcingBar ≥ N"), add it to the floor dict. |
| You intentionally grew the fixture (e.g. 3rd storey) — the output is larger | Update `FLOORS_*` in `test_baseline_quality.py` and `SIZE_BAND_BYTES`. Commit fixture + floor change together. |
| You renamed a Track C field | Update both `src/types/geometry.ts` AND the `alias=` in Python `request.py`. Both test suites should fail until aligned. |
| You dropped a capability (rare; usually means a builder got removed) | Lower the floor AND document the capability removal in the PR description. Reviewer should push back unless there's a clear why. |

## Step-by-step — updating the fixture

1. **Edit `neobim-ifc-service/tests/fixtures/baseline_building.json`** — add, remove, or modify elements. Use camelCase field names (they map to Python's snake_case via Pydantic aliases).

2. **Run Python baseline test locally** to see what the build now produces:
   ```bash
   cd neobim-ifc-service
   pip install -e ".[dev]"
   pytest tests/test_baseline_quality.py -v
   ```
   Expect some `test_entity_floors` failures if the fixture changed shape.

3. **Read the new actual counts** using the helper:
   ```bash
   python - <<'PY'
   import json, tempfile, ifcopenshell
   from pathlib import Path
   from app.models.request import ExportIFCRequest
   from app.services.ifc_builder import build_multi_discipline
   from scripts.count_ifc_entities import count_entities

   raw = json.loads(Path("tests/fixtures/baseline_building.json").read_text())
   raw.pop("_comment", None)
   for discipline, (data, _, failures) in build_multi_discipline(
       ExportIFCRequest.model_validate(raw)
   ).items():
       with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False) as t:
           t.write(data); t.flush()
           model = ifcopenshell.open(t.name)
       print(f"\n=== {discipline} ({len(data)} bytes, {len(failures)} failures) ===")
       for cls, n in count_entities(model).items():
           if n: print(f"  {cls}: {n}")
   PY
   ```

4. **Update `FLOORS_*` dicts** in `test_baseline_quality.py`. Set floors a
   little BELOW what you observe (e.g. observed 12 → set floor to 11 or 12)
   so small non-regression changes don't cause flapping, but meaningful drops
   still fail.

5. **Update `SIZE_BAND_BYTES`** if file sizes moved out of band. Give at
   least 1.5× headroom on the upper bound and 0.8× on the lower.

6. **Re-run the test.** All pass → commit fixture + test changes together in
   a single commit. Describe why the fixture changed in the commit body.

## Step-by-step — adding a new invariant (raising the floor)

When a new Phase lands an emitter that produces a new entity class, tighten
the gate so future regressions are caught:

1. Add the class to `FLOORS_COMBINED` (and whichever per-discipline dicts
   apply). Set floor to 1 initially.
2. If the class is an ifcopenshell 0.8+ addition, verify it's in
   `scripts/count_ifc_entities.BASELINE_CLASSES` so the helper surfaces it
   in reports.
3. If the class implies a new relationship (e.g. `IfcFlowTerminal` should
   be connected via `IfcRelConnectsPorts`), add an assertion that every
   instance is in at least one such relationship.
4. Run the baseline test to make sure it passes on the current fixture. If
   it doesn't, widen the fixture to include at least one sample of the new
   class.

## Do not

- **Do not silence a failing assertion** by lowering a floor without
  understanding why the number dropped. Investigate first.
- **Do not regenerate expected `.ifc` byte snapshots.** The baseline test
  intentionally avoids byte-level comparisons because GUIDs and timestamps
  vary per run. Assertions operate on parsed model counts and relationships.
- **Do not commit fixture + floor changes separately.** They must land
  together so CI doesn't transiently fail between commits.
- **Do not add floor entries for entity classes that are coincidentally
  present** (e.g. internal `IfcOwnerHistory` instances). Stick to classes
  that represent user-facing building content.

## Fail-loud expectations

The TS boundary tests (vitest) are fast (<1 s). The Python baseline runs
end-to-end IFC generation and parses back — budgeted at <10 s under CI,
typically 2-4 s. If the Python test takes >30 s, the fixture has grown too
large or a builder has become pathologically slow. Treat that as its own
regression and investigate.
