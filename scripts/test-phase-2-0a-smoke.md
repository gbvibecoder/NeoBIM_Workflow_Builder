# Phase 2.0a — Production Smoke Test

**Purpose:** Verify Phase 2.0a changes work in production before 
declaring success. Run AFTER merging feat/phase-2-0a-quick-wins 
to main and confirming Vercel deploy completed.

**Estimated time:** 10 minutes
**Cost:** ~$0.08 (one VIP generation)

---

## Pre-flight checks

- [ ] Vercel deploy for main branch shows green
- [ ] Deploy commit matches latest main HEAD
- [ ] No Vercel build warnings flagged
- [ ] /api/admin/vip-stats returns 200

---

## Test execution

### Step 1: Fresh session
- [ ] Open incognito browser window
- [ ] Navigate to https://trybuildflow.in/dashboard/floor-plan
- [ ] Redirected to login (expected — no session)

### Step 2: Admin login
- [ ] Log in as admin (email in VIP_ADMIN_OVERRIDE_EMAILS)
- [ ] Redirected back to /dashboard/floor-plan
- [ ] No console errors on page load

### Step 3: Trigger VIP generation
- [ ] Prompt: `3BHK 40x40 east facing vastu`
- [ ] Click Generate
- [ ] VERIFY: VipGenerationProgress overlay appears (NOT legacy 
      t1-strip-pack Review Modal)
- [ ] VERIFY: Progress climbs monotonically:
      5 → 10 → 20 → 35 → 45 → 60 → 75 → 85 → 100

### Step 3.5: Confirm VIP actually ran (NON-NEGOTIABLE)

Last night's stale closure bug had zero obvious symptoms — 
everything "worked," just via the wrong pipeline. This check 
is the only way to detect a regression of that class.

- [ ] Query the VipJob row just created
- [ ] Inspect resultProject.metadata.generation_model
- [ ] VERIFY: value is EXACTLY "vip-pipeline"
- [ ] FAIL IF: value is "t1-strip-pack", "pipeline-ref", null, 
      undefined, or any other string

If this check fails:
- UI may have appeared to work
- Progress overlay may have appeared
- Cost may look right
- BUT pipeline silently fell through to legacy
- EXACT symptom of last night's stale closure bug
- Roll back merge immediately
- Investigate before further testing

### Step 4: Monitor completion
- [ ] Completes in 55-130s
- [ ] Floor plan renders on Konva canvas without errors
- [ ] No "fell back to PIPELINE_REF" messages in any log

### Step 5: Database verification
- [ ] status = 'COMPLETED'
- [ ] errorMessage IS NULL
- [ ] retryCount = 0
- [ ] resultProject contains valid FloorPlanProject JSON
- [ ] result.images[] contains GPT Image 1.5 output
- [ ] result.images[] does NOT contain any model matching "imagen-*"

### Step 6: Cost verification
- [ ] generation_cost_usd is between $0.07 and $0.09
- [ ] Compare to VipJob cmo7josmp000004jpjt2al5gk (pre-2.0a) — 
      should be ~$0.04 less
- [ ] If cost > $0.10 → investigate, Imagen removal incomplete

### Step 7: Stage 1 schema verification
- [ ] Stage 1 LLM output contains EXACTLY 1 image_prompt field
- [ ] No Zod validation errors in Vercel logs
- [ ] If Zod rejected Stage 1 → check fallthrough to PIPELINE_REF 
      (Risk #1 of 2.0a report — deploy-window prompt cache)

---

## Acceptance

Merge is successful if ALL true:
- VIP overlay appeared (not legacy Review Modal)
- Progress strictly increasing
- generation_model === "vip-pipeline" (Step 3.5)
- VipJob status = COMPLETED with no errors
- Cost $0.07-$0.09
- Stage 1 returned 1 image prompt
- Floor plan rendered on Konva canvas
- No JavaScript console errors

---

## If anything fails

- **generation_model !== "vip-pipeline":** Stale closure regressed 
  or flag not read. Revert merge, investigate FloorPlanViewer refs.
- **VIP overlay missing → legacy modal:** Same class of bug. Revert.
- **Progress backwards:** Orchestrator regression. Check fireProgress().
- **Cost > $0.10:** Imagen removal incomplete. Grep stage-2-images.ts 
  and providers/ for leftover refs.
- **Zod rejects Stage 1:** Prompt cache issue expected during deploy 
  window (Risk #1). Retry after 5 min. If still failing, Stage 1 
  schema change has a bug.
- **Any other failure:** git revert <merge-commit> + redeploy. 
  Investigate on branch.

---

## Post-test

If ALL pass:
- [ ] Screenshot VipJob row from Prisma Studio
- [ ] Screenshot floor plan output
- [ ] Record cost + generation time
- [ ] Update memory: Phase 2.0a verified in production
- [ ] Proceed to Phase 2.0b

If ANY fail:
- [ ] Do NOT proceed to 2.0b
- [ ] Roll back merge
- [ ] Diagnose on branch before re-attempt

---

## Notes

This is n=1 smoke test. Full quality data collection is Phase 2.0b 
(10 generations, diverse prompts, pattern documentation). This 
test only verifies 2.0a didn't break anything — not whether 
output is good.
