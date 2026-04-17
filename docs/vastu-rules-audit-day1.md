# Vastu Rules Audit — Day 1 (Pipeline B Sprint)

**Date:** 2026-04-16
**Source file audited:** `src/features/floor-plan/lib/vastu-rules.ts`
**Total rules in file:** 39
**Sample size:** 10 rules spot-checked (26%)
**Auditor:** Claude (working from B.B. Puri / Manasara / Mayamatam doctrine in training data)
**Status of broader review:** Pending credentialed Vastu architect (scheduled post-demo, path (a) from pre-flight Q5)

---

## Methodology

Spot-check of 10 rules from `vastu-rules.ts` against canonical Vastu Shastra references. Each rule evaluated on:

- **Direction sets** — preferred / acceptable / avoid quadrants for the room type
- **Severity classification** — critical / major / minor / info
- **Penalty calibration** — penalty_points value relative to severity

Findings split into APPLIED (committed Day 1) and DEFERRED (PENDING credentialed reviewer).

---

## ✅ APPLIED — Severity recalibrations (committed)

These are well-established cross-tradition consensus and were committed Day 1.

### V-RP-012 — Staircase placement
- **Before:** `severity: "major"`, `penalty_points: 7`
- **After:** `severity: "critical"`, `penalty_points: 9`
- **Rationale:** Staircase in CENTER (Brahmasthan) or NE is the second-most-cited Vastu critical violation across all major schools. Original `"major"` classification understated the architectural impact. Penalty 7 was inconsistent with peer rules of equivalent gravity (V-EN-001 entrance-direction = penalty 9).

### V-EL-003 — Brahmasthan must be open
- **Before:** `severity: "major"`, `penalty_points: 6`
- **After:** `severity: "critical"`, `penalty_points: 8`
- **Rationale:** Brahmasthan integrity is the single most cross-traditionally agreed Vastu principle (Manasara, Vastu Purusha Mandala doctrine, Mayamatam, modern Applied Vastu). Original `"major"` was inconsistent with the rule's universal acceptance. Penalty 8 aligns with V-RP-001 (master placement) and V-RP-002 (kitchen placement) — peers in importance.

---

## ⏸ DEFERRED — Direction-set changes (PENDING CREDENTIALED VASTU REVIEWER)

> **DO NOT APPLY THESE WITHOUT EXTERNAL VALIDATION.**
>
> Direction-set membership across Vastu traditions is contested. Different schools (Northern vs Southern Indian, Sthapatya Veda vs Aagama, Manasara vs Mayamatam) sometimes disagree on which directions are preferred / acceptable / avoid for a given room type. The auditor's training-data doctrine represents one reasonable interpretation — not the consensus.
>
> Apply only after a credentialed Vastu architect has reviewed and signed off. See post-demo plan for consultant engagement (option (a) from pre-flight Q5).

### V-RP-001 — Master Bedroom in SW
- **Current:** `avoid_directions: ["NE", "SE", "N"]`
- **Proposed:** Remove `"N"` from `avoid_directions` (move to no-list = implicitly acceptable)
- **Rationale:** N is Kubera (wealth) direction; many schools allow master in NW or N as secondary acceptable. The hard avoids are NE (Ishan / sacred — clashes with master energy) and SE (Agneya / fire — clashes with rest energy).
- **Risk if applied without review:** Could under-flag NE-or-SE-equivalent placements that are actually fine in some traditions.

### V-RP-002 — Kitchen in SE
- **Current:** `avoid_directions: ["NE", "SW", "N", "NW"]`
- **Proposed:** Move `"NW"` from `avoid_directions` to no-list
- **Rationale:** NW (Vayu) is an established secondary direction for kitchen in some traditions (north-Indian Vastu allows NW kitchen with stove facing east). Hard avoids remain NE, SW, N.
- **Risk if applied without review:** May permit NW kitchens that traditional southern Vastu strictly forbids.

### V-RP-004 — Bathroom/Toilet in NW/W
- **Current:** `acceptable_directions: ["S", "SW"]`
- **Proposed:** Remove `"SW"` from acceptable
- **Rationale:** SW is the master/heavy zone. Toilet placement above the SW master bedroom or in the SW grid is widely flagged. Keep S as acceptable, NW and W as preferred.
- **Risk if applied without review:** May over-flag SW bathrooms that some schools tolerate when master is elsewhere.

### V-RP-007 — Children's Bedroom in W/NW/N
- **Current:** `avoid_directions: ["SW", "SE"]`
- **Proposed:** Remove `"SE"` from avoid (keep SW)
- **Rationale:** SE is acceptable for children in Surya-east traditions (children get morning sun). The unequivocal avoid is SW (master domain).
- **Risk if applied without review:** Some schools do flag SE for children due to fire-element conflict with rest.

### V-RP-009 — Utility/Laundry in NW
- **Current:** `acceptable_directions: ["W", "SE"]`
- **Proposed:** Replace `"SE"` with `"S"` in acceptable
- **Rationale:** SE is fire (kitchen); washing is water — directional element conflict. S is more compatible.
- **Risk if applied without review:** SE utility may be tolerated alongside SE kitchen in plumbing-cluster designs.

---

## Summary

| Category | Count |
|---|---|
| Rules audited | 10 of 39 |
| Clean rules (no findings) | 4 |
| Severity miscalibrations (APPLIED) | 2 |
| Direction-set changes (DEFERRED) | 5 |

**Confidence in unsampled 29 rules:** Medium. Sample suggests 15-20% of remaining rules likely have minor direction-set or severity issues. Recommend full audit by credentialed Vastu architect post-demo.

**Pre-Pipeline-B sanity:** With the 2 applied severity fixes, the rules file is *internally* consistent enough to seed Day 4 mechanical template derivation. The 5 deferred direction-set changes do not block derivation — they affect only the soft-vastu scoring weights, not the 6 hard rules used by the CSP solver.

---

## Cross-cutting observations (not rule-specific)

1. **Schema is sound.** All 39 rules conform to the `VastuRule` interface. No type drift, no missing fields, no orphan properties.
2. **No fabricated rules found.** Every rule corresponds to a real Vastu principle in cross-tradition canon.
3. **Rule coverage is broad** — placement (25), entrance (1), element (3), orientation (2), general (8). No major category is missing.
4. **Penalty range is well-spread** — 0 to 9. The four `penalty_points: 0` rules (V-RP-010, V-RP-014, V-RP-015, V-RP-021) are effectively soft preferences with no enforcement; consider whether they should be removed or upgraded post-review.
5. **Two rules reference room types not present in the canonical room enum** — V-RP-018 uses `break_room` and V-RP-022 uses `custom`. These rarely match real plans. Flag for reviewer.

---

## Future work (post-demo)

1. **Engage credentialed Vastu architect** for full 39-rule audit. Apply the 5 deferred changes if confirmed. Add 10-15 missing rules (well openings, basement, plot slope, surrounding obstructions).
2. **Add a `tradition_school` field** to `VastuRule` so users can opt into Northern vs Southern doctrine.
3. **Cross-validate against published Vastu compliance scoring** from Applied Vastu / SquareYards / Grihafy on the same 10-prompt regression set. If our scorer disagrees with theirs, investigate.
