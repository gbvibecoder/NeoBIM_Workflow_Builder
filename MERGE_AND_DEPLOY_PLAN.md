# 🚀 MERGE & DEPLOY PLAN - DAY 2

**Situation:** 30+ feature branches, 1 current branch with uncommitted changes  
**Goal:** Clean merge strategy, zero conflicts, stable production  
**Timeline:** March 6, 2026, 8:00 AM - 6:00 PM

---

## 📊 CURRENT STATE

### Active Branch
```
* feature/overnight-ui-polish-final (CURRENT)
  - 757 lines changed (18 files)
  - Stripe integration complete
  - Pricing updated to $79/$199
  - Analytics foundation
  - Uncommitted changes
```

### Feature Branches (30+)
```
Local branches:
- docs/add-git-workflow
- feature/add-rate-limiting
- feature/admin-bypass-and-upgrade-flow
- feature/emergency-admin-bypass
- feature/fix-all-known-bugs
- feature/fix-history-loading-hotfix
- feature/fix-image-display
- feature/fix-loading-states
- feature/fix-rate-limit-admin-bypass
- feature/fix-run-button-always-visible-v2
- feature/fix-run-button-critical-v3
- feature/fix-run-button-text
- feature/fix-run-button-visibility
- feature/fix-toolbar-zindex
- feature/fix-tr003-follow-input
- feature/fix-tr007-quantity-extractor
- feature/fix-tr007-real-implementation
- feature/fix-tr007-zero-quantities
- feature/improve-all-5-nodes
- feature/improve-error-handling
- feature/improve-ex002-boq-exporter
- feature/improve-gn003-v2
- feature/improve-tr003-v2
- feature/improve-tr008-cost-mapper
- feature/overnight-api-fixes
- feature/polish-run-button
- feature/stripe-integration-foundation
- feature/ui-overhaul-canvas
- feature/ui-overhaul-final
- feature/ui-overhaul-pages
- fix/text-prompt-input-bug
- hotfix/missing-useeffect-import
- hotfix/text-prompt-stale-closure
- hotfix/tr003-force-user-input

Remote branches (similar list on origin)
```

---

## 🎯 MERGE STRATEGY

### Phase 1: IMMEDIATE (8:00 AM - 10:00 AM) - P0

**Priority:** Get Stripe to production ASAP.

#### Step 1.1: Commit & Push Current Branch (10 min)
```bash
cd /Users/rutikerole/Projects/NeoBIM\ Workflow\ Builder/workflow_builder

# Review changes
git status
git diff --stat

# Commit all changes
git add .
git commit -m "feat: Stripe integration + pricing update ($79 Pro / $199 Team)

- Stripe checkout, portal, webhook, subscription routes
- Database schema: 4 Stripe fields + StripeEvent model
- Pricing consistency across all files
- Analytics foundation (src/lib/analytics.ts)
- Competitive battle card
- Documentation for Govind (Stripe implementation guide)

See DELIVERY_SUMMARY.md for full details."

# Push to remote
git push origin feature/overnight-ui-polish-final
```

#### Step 1.2: Create & Merge PR (15 min)
```bash
# Create PR
gh pr create \
  --title "🔥 Stripe Integration + Pricing Update ($79/$199)" \
  --body "$(cat <<EOF
## Summary
Complete Stripe subscription integration + pricing standardization.

## What's Included
- ✅ Stripe checkout, portal, webhook, subscription routes
- ✅ Database schema updated (Prisma migration ready)
- ✅ Pricing: $79 Pro / $199 Team (100% consistency)
- ✅ Analytics foundation (src/lib/analytics.ts)
- ✅ Competitive positioning (vs TestFit, Finch3D)
- ✅ ROI messaging: "Save $2,000/project = 25x ROI"

## Files Changed
18 files, 757 lines (+544, -203)

## Testing Checklist
- [ ] Database migration runs successfully
- [ ] Stripe checkout flow works (test mode)
- [ ] Webhook signature verification passes
- [ ] User role upgrades after payment
- [ ] Customer portal accessible
- [ ] Rate limits respect subscription tier

## Documentation
- START_HERE_GOVIND.md (Quick start)
- STRIPE_INTEGRATION_PLAN.md (30 KB technical guide)
- DELIVERY_SUMMARY.md (Full breakdown)

## Next Steps
1. Merge to main
2. Deploy to production (auto-deploy on Vercel)
3. Configure Stripe webhook URL in dashboard
4. Run database migration
5. Test with Stripe test card (4242 4242 4242 4242)

See DELIVERY_SUMMARY.md for full implementation details.
EOF
)" \
  --assignee rutikerole \
  --label "feature" \
  --label "revenue-critical"

# Review PR (quick scan)
gh pr view --web

# Merge (squash)
gh pr merge --squash --delete-branch
```

#### Step 1.3: Verify Deployment (5 min)
```bash
# Vercel auto-deploys on main push
# Wait 2-3 minutes, then check

# Visit production
open https://neobim.com

# Check deployment logs
vercel logs
```

**Success Criteria:**
- ✅ PR merged to main
- ✅ Vercel deployment successful
- ✅ Production site loads
- ✅ No build errors

---

### Phase 2: CRITICAL FIXES (10:00 AM - 12:00 PM) - P0

**Priority:** Merge bug fixes that improve stability.

#### Branches to Merge (Priority Order):

**2.1. Rate Limiting (CRITICAL)**
```bash
# Merge: feature/add-rate-limiting
git checkout main
git pull
git merge origin/feature/add-rate-limiting --no-ff
git push origin main
```
**Why:** Protects API from abuse, enforces subscription tiers  
**Risk:** Low (isolated feature)  
**Test:** Verify rate limits work for FREE/PRO/TEAM

**2.2. Admin Bypass (CRITICAL)**
```bash
# Merge: feature/emergency-admin-bypass
git checkout main
git pull
git merge origin/feature/emergency-admin-bypass --no-ff
git push origin main
```
**Why:** Admins need unrestricted access for testing/support  
**Risk:** Low (admin-only)  
**Test:** Admin can bypass rate limits

**2.3. Error Handling (IMPORTANT)**
```bash
# Merge: feature/improve-error-handling
git checkout main
git pull
git merge origin/feature/improve-error-handling --no-ff
git push origin main
```
**Why:** Better user experience on failures  
**Risk:** Low (improves existing code)  
**Test:** Trigger errors, verify user-friendly messages

---

### Phase 3: UI POLISH (12:00 PM - 3:00 PM) - P1

**Priority:** Visual improvements, no logic changes.

#### Branches to Merge (Priority Order):

**3.1. UI Overhaul**
```bash
# Merge: feature/ui-overhaul-final
git checkout main
git pull
git merge origin/feature/ui-overhaul-final --no-ff
git push origin main
```
**Why:** Professional UI for launch  
**Risk:** Medium (visual changes, test thoroughly)  
**Test:** All pages render correctly

**3.2. Loading States**
```bash
# Merge: feature/fix-loading-states
git checkout main
git pull
git merge origin/feature/fix-loading-states --no-ff
git push origin main
```
**Why:** Better UX during async operations  
**Risk:** Low  
**Test:** Spinners show during API calls

**3.3. Canvas UI**
```bash
# Merge: feature/ui-overhaul-canvas
git checkout main
git pull
git merge origin/feature/ui-overhaul-canvas --no-ff
git push origin main
```
**Why:** Better workflow editor UX  
**Risk:** Medium (canvas is complex)  
**Test:** Create workflow, drag nodes, verify zoom/pan

---

### Phase 4: NODE IMPROVEMENTS (3:00 PM - 6:00 PM) - P1

**Priority:** Improve workflow execution quality.

#### Branches to Merge:

**4.1. TR-003 Improvements**
```bash
# Merge: feature/improve-tr003-v2
git checkout main
git pull
git merge origin/feature/improve-tr003-v2 --no-ff
git push origin main
```
**Why:** Better text prompt parsing  
**Risk:** Low  
**Test:** TR-003 with "7-story Berlin apartment" → verify output

**4.2. All 5 Nodes**
```bash
# Merge: feature/improve-all-5-nodes
git checkout main
git pull
git merge origin/feature/improve-all-5-nodes --no-ff
git push origin main
```
**Why:** Quality improvements across node types  
**Risk:** Medium (affects all nodes)  
**Test:** Run workflow with all 5 node types

**4.3. GN-003 Image Generator**
```bash
# Merge: feature/improve-gn003-v2
git checkout main
git pull
git merge origin/feature/improve-gn003-v2 --no-ff
git push origin main
```
**Why:** Better image generation  
**Risk:** Low (isolated node)  
**Test:** Generate images, verify quality

---

### Phase 5: CLEANUP (Evening) - P2

**Priority:** Delete stale/redundant branches.

#### Branches to DELETE (Not Merge):

**Duplicate Fix Attempts (Keep Latest Only):**
- feature/fix-run-button-text ❌ DELETE
- feature/fix-run-button-visibility ❌ DELETE
- feature/fix-run-button-always-visible-v2 ❌ DELETE
- feature/fix-run-button-critical-v3 ✅ KEEP (latest)
- feature/polish-run-button ✅ KEEP (most recent)

**Superseded Hotfixes:**
- hotfix/missing-useeffect-import ❌ DELETE (already merged)
- hotfix/text-prompt-stale-closure ❌ DELETE (already merged)
- hotfix/tr003-force-user-input ❌ DELETE (already merged)

**Superseded Features:**
- feature/stripe-integration-foundation ❌ DELETE (completed in overnight-ui-polish-final)
- feature/fix-all-known-bugs ❌ DELETE (vague, likely superseded)

**Commands:**
```bash
# Delete local branches
git branch -D feature/fix-run-button-text
git branch -D feature/fix-run-button-visibility
git branch -D feature/fix-run-button-always-visible-v2
git branch -D hotfix/missing-useeffect-import
git branch -D hotfix/text-prompt-stale-closure
git branch -D hotfix/tr003-force-user-input
git branch -D feature/stripe-integration-foundation
git branch -D feature/fix-all-known-bugs

# Delete remote branches
git push origin --delete feature/fix-run-button-text
git push origin --delete feature/fix-run-button-visibility
git push origin --delete feature/fix-run-button-always-visible-v2
git push origin --delete hotfix/missing-useeffect-import
git push origin --delete hotfix/text-prompt-stale-closure
git push origin --delete hotfix/tr003-force-user-input
git push origin --delete feature/stripe-integration-foundation
git push origin --delete feature/fix-all-known-bugs
```

---

## 🧪 TESTING SEQUENCE

**After EVERY merge:**

### 1. Build Test (5 min)
```bash
npm run build
```
**Success:** Zero TypeScript errors, build completes

### 2. Local Test (5 min)
```bash
npm run dev
# Visit http://localhost:3000
# Quick smoke test: sign up, create workflow, run
```
**Success:** Core features work

### 3. Deploy & Production Test (10 min)
```bash
# Push to main (triggers auto-deploy)
git push origin main

# Wait 2-3 min
# Visit https://neobim.com
# Repeat smoke test
```
**Success:** Production stable

### 4. Rollback Plan (If Needed)
```bash
# If merge breaks production
git revert HEAD
git push origin main

# Or reset to last known good commit
git reset --hard <commit-hash>
git push origin main --force
```

---

## 🚨 CONFLICT RESOLUTION

### Expected Conflicts

**High Risk Areas:**
1. `package.json` / `package-lock.json` (dependency versions)
2. `prisma/schema.prisma` (database schema changes)
3. `src/app/dashboard/page.tsx` (UI changes)
4. `.env.example` (environment variables)

### Conflict Resolution Protocol

**When conflict occurs:**
```bash
# 1. Check which files
git status

# 2. For each conflicted file
git diff <file>

# 3. Resolve conflicts (prefer newer code)
code <file>  # Edit manually

# 4. Mark resolved
git add <file>

# 5. Complete merge
git commit -m "merge: resolve conflicts in <file>"
git push origin main
```

**If unsure:**
- Prefer `main` branch code (production-tested)
- If feature is critical, prefer feature branch
- Ask Rutik for UI/UX decisions
- Test immediately after resolving

---

## 📊 MERGE TRACKING

### Progress Checklist

**Phase 1 (IMMEDIATE - P0):**
- [ ] feature/overnight-ui-polish-final → main ✅ TARGET: 8:30 AM

**Phase 2 (CRITICAL FIXES - P0):**
- [ ] feature/add-rate-limiting → main ✅ TARGET: 10:30 AM
- [ ] feature/emergency-admin-bypass → main ✅ TARGET: 11:00 AM
- [ ] feature/improve-error-handling → main ✅ TARGET: 11:30 AM

**Phase 3 (UI POLISH - P1):**
- [ ] feature/ui-overhaul-final → main ✅ TARGET: 1:00 PM
- [ ] feature/fix-loading-states → main ✅ TARGET: 2:00 PM
- [ ] feature/ui-overhaul-canvas → main ✅ TARGET: 3:00 PM

**Phase 4 (NODE IMPROVEMENTS - P1):**
- [ ] feature/improve-tr003-v2 → main ✅ TARGET: 4:00 PM
- [ ] feature/improve-all-5-nodes → main ✅ TARGET: 5:00 PM
- [ ] feature/improve-gn003-v2 → main ✅ TARGET: 6:00 PM

**Phase 5 (CLEANUP - P2):**
- [ ] Delete 8 stale branches ✅ TARGET: 8:00 PM

---

## 🎯 SUCCESS METRICS

**End of Day 2:**
- ✅ 10+ branches merged to main
- ✅ 8+ stale branches deleted
- ✅ Zero unresolved conflicts
- ✅ Production stable (no rollbacks)
- ✅ Stripe fully deployed & tested
- ✅ All P0 merges complete

**Branch Count:**
- **Start:** 34 branches
- **End:** < 20 branches
- **Reduction:** 40%+

---

## 🔧 DEPLOYMENT CONFIGURATION

### Vercel Settings
**Current Setup:**
- Auto-deploy on `main` push ✅
- Build command: `npm run build` ✅
- Environment variables: Configured ✅
- Domain: neobim.com ✅

**Post-Merge Checklist:**
1. ✅ Database migration runs (Prisma)
2. ✅ Stripe webhook URL configured
3. ✅ Environment variables updated (.env.production)
4. ✅ Analytics tracking codes added
5. ✅ Sentry error tracking configured

### Database Migration
```bash
# After merging schema changes
npx prisma migrate deploy

# Verify
npx prisma studio
# Check: User table has new Stripe fields
```

### Stripe Webhook Setup
```bash
# Get production URL
echo "https://neobim.com/api/stripe/webhook"

# Add in Stripe Dashboard:
# Developers → Webhooks → Add Endpoint
# URL: https://neobim.com/api/stripe/webhook
# Events: 
#   - checkout.session.completed
#   - customer.subscription.created
#   - customer.subscription.updated
#   - customer.subscription.deleted
#   - invoice.payment_failed

# Copy webhook secret → .env.production
STRIPE_WEBHOOK_SECRET="whsec_..."
```

---

## 🔥 EXECUTION CHECKLIST

**DevOps GOAT (assigned to this task):**

### Pre-Merge
- [ ] Review current git status
- [ ] Backup database (just in case)
- [ ] Note last known good commit hash
- [ ] Ensure Vercel deployment is stable

### During Merge
- [ ] Follow phase order (P0 → P1 → P2)
- [ ] Test after EVERY merge
- [ ] Document conflicts (if any)
- [ ] Monitor Vercel deployment logs

### Post-Merge
- [ ] Run database migration
- [ ] Configure Stripe webhook
- [ ] Production smoke test
- [ ] Update MERGE_PROGRESS.md (track completion)

### Rollback Triggers
- [ ] Build fails (TypeScript errors)
- [ ] Production site down (500 errors)
- [ ] Critical feature broken (signup, workflows)
- [ ] Database migration fails

**If rollback needed:**
1. Announce immediately
2. Revert last commit
3. Investigate offline
4. Fix → re-merge

---

## 📞 COMMUNICATION

**Announce in Telegram:**

**At start:**
"🚀 Starting merge plan. Phase 1: Stripe integration → main. ETA: 8:30 AM."

**After each phase:**
"✅ Phase 1 complete. Stripe deployed. Moving to Phase 2: Critical fixes."

**If conflict:**
"⚠️ Merge conflict in `schema.prisma`. Resolving. ETA: +15 min."

**At end:**
"🎉 Day 2 merges complete. 10 branches merged, 8 deleted. Production stable. Stripe live."

---

## 🏆 FINAL STATE (End of Day 2)

**main branch includes:**
- ✅ Stripe subscription system (full)
- ✅ Pricing: $79 Pro / $199 Team
- ✅ Rate limiting (FREE/PRO/TEAM tiers)
- ✅ Admin bypass
- ✅ Error handling
- ✅ UI polish (landing, dashboard, canvas)
- ✅ Node improvements (TR-003, GN-003, all 5)
- ✅ Analytics foundation

**Deleted branches:**
- ✅ 8+ stale/duplicate branches

**Production:**
- ✅ Deployed
- ✅ Tested
- ✅ Stable
- ✅ Revenue-ready

---

**This is the path from chaos to clarity.** 🔥

---

**CREATED:** March 6, 2026, 12:00 AM IST  
**OWNER:** DevOps GOAT + Chhawa  
**STATUS:** Ready to execute at 8:00 AM sharp
