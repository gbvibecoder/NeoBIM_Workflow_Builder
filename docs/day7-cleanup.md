# Day 7 Cleanup TODO List

This file is the pre-demo hygiene queue. Items here are low-priority bugs and minor improvements surfaced during Pipeline B development that **do not affect Pipeline B trajectory** and would muddle delta interpretation if applied mid-sprint.

**Day 7 morning:** review, triage, ship as one or more cleanup commits, re-baseline both pipelines.

**Rules for adding items here:**
- Item must NOT block Pipeline B (verify it doesn't touch CSP solver, parser, templates, or orchestrator)
- Item must NOT regress Pipeline A by ≥ 2 points on the regression set
- Item must be small (≤ 2 commits worth of work)
- If it's bigger or risky, it's a separate ticket — not Day 7

---

## Pipeline A hallucination cleanup (carried over from Day 1)

### A1 — `Drawing Room` slot in `TEMPLATE_5BHK_VILLA`
- **File/line:** `src/features/floor-plan/lib/typology-templates.ts:1335`
- **Symptom:** P01 output contains "Drawing Room" even though the prompt does not mention it. Source is the typology template's `id: 'drawing', label: 'Drawing Room'` slot — fires whenever the matcher selects the 5BHK villa template.
- **Fix options:**
  - Make the slot optional (`required: false`) AND remove the slot's hard `Drawing Room` label, falling back to whatever program room gets assigned.
  - Or: rename slot label to a generic "Living Room 2" / "Family Room" — less prejudicial.
- **Estimated effort:** 5 minutes (~3 line change)
- **Risk:** Low — affects 5BHK Pipeline A scoring on P01 only. Improves it.
- **Surfaced by:** Day 1 hallucination strip diagnostic; only +1 P01 delta despite SYSTEM_PROMPT cleanup.

### A2 — `Walk-in Closet` canonical naming in regex fallback
- **File/line:** `src/features/floor-plan/lib/ai-room-programmer.ts` `specialtyRooms` table (search for `"Walk-in Closet"`)
- **Symptom:** When prompt says "walk-in wardrobe", regex fallback's specialty-rooms scan injects a room named "Walk-in Closet" (the canonical name in the table). Then `findMissingRooms` audit sees "Walk-in Wardrobe" missing from output and injects a SECOND room — duplicate. Real-AI path also occasionally produces "Walk-in Closet" instead of "Walk-in Wardrobe".
- **Fix:** Change the canonical entry from `"Walk-in Closet"` to `"Walk-in Wardrobe"` (matches Indian usage and matches what `extractMentionedRooms` produces). Update both the fallback table and the room-vocabulary aliases (Day 2 Pipeline B work) so they agree.
- **Estimated effort:** 10 minutes
- **Risk:** Low — affects naming consistency only.
- **Surfaced by:** Day 1 P01 audit showed BOTH "Walk-in Closet" and "Walk-in Wardrobe" in output.

---

## Determinism / observability

### A3 — AI sampling variance in scorecard runs
- **Symptom:** Day 2 real-AI baselines showed P03 and P05 fluctuating ±1 point between runs even at `temperature: 0`. OpenAI's deterministic-best-effort sampling is not bit-stable.
- **Mitigation options for Day 7:**
  - Document the variance in `tests/floor-plan/README.md` so future engineers don't chase ghosts.
  - OR implement parser caching by `prompt_id` for the regression harness only (per pre-flight Q B amendment) — would lock all subsequent harness runs to the first observed parse.
- **Estimated effort:** 15 min (docs only) or 1 hour (caching)
- **Risk:** Low.

---

## Pipeline B follow-ups (only if surfaced during Days 3-6)

> Anything that emerges during parser/CSP work that is NOT on the critical path goes here. Examples might include:
> - Better room-vocabulary entries discovered from prompt failures
> - Performance tuning for the SA polish pass
> - Prettier wall thickness rendering at corners
> - Better UNSAT explanation prose
>
> Add inline as discovered — empty for now.

---

## Demo polish (Day 7-only items)

> Items intended to be applied only after the regression set passes ≥ 90%:
> - Loading state animations during the 8s+ Pipeline B latency
> - "How it works" tooltip explaining the 2-pipeline architecture
> - Telemetry on which pipeline ran for each prompt (already partially in place via `pipelineUsed` field)
>
> Add inline as needed.
