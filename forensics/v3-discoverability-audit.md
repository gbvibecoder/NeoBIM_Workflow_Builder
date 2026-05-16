# v3 Discoverability Audit — 2026-05-16

Map of every surface where Brief-to-IFC v3 could/should be linked from,
and the current state. Drives Deliverables 2–5 of the shippability phase.

## State as of beast-mode closeout (commit `0e85f7fc`)

| Surface | v3 linked? | Gated on flag? | Notes / fix |
|---|---|---|---|
| **Sidebar nav** | ✅ YES (line 102–103 of `src/features/dashboard/components/Sidebar.tsx`) | ✅ YES (`briefToIfcV3Enabled`) | Currently uses `Zap` icon + label "AI IFC v3" + "Beta" badge. The prompt specifies `Sparkles` or `Cpu`; switching to `Sparkles` makes the AI flavour clearer and aligns with the dashboard card. |
| **Dashboard landing** (`/dashboard`) | ❌ NO | n/a | No Quick Start card. Add one (D3). |
| **Submit form** (`/dashboard/brief-to-ifc/v3/new`) | ✅ YES (page exists) | ✅ YES (server redirects to `/dashboard` if `shouldUseBriefToIfcV3` false) | Form works but lacks: (a) sample-brief launcher (D4), (b) cost transparency (D6). |
| **Results page** (`/dashboard/brief-to-ifc/v3/runs/[id]`) | ✅ YES (page exists) | ✅ YES (server check) | Needs Download/Share/Try Again buttons (D7). |
| **Canvas** (`/dashboard/[id]`) | ❌ NO v3 entry. Note: `EX-006` is labelled "AI IFC Generator" but routes to v2 (the script-runner approach), not v3 (agent loop). | n/a | Add new node entry (D5). Anticipated blocker: `REAL_NODE_IDS` lives inside the forbidden file `src/app/api/execute-node/route.ts` (line 20 — hard-coded `Set` literal). |
| **Prebuilt workflows / templates** | ❌ NO | n/a | Out of scope for this phase. |
| **Marketing / pricing pages** | ❌ NO | n/a | Out of scope. |
| **Feature flags API** | ✅ YES — `briefToIfcV3Enabled` exposed via `/api/config/feature-flags` | n/a | Working — `useFeatureFlags` returns the flag. |
| **`/dashboard/ifc-viewer`** | Indirect (any IFC URL can be loaded) | n/a | Results page should deep-link to the viewer with the R2 URL pre-loaded if the viewer supports a query param; otherwise a copy-link button is fine. |
| **Sidebar `/dashboard/feedback`** | n/a | n/a | Feature requests for v3 land here organically. |

## Canvas integration risk surface

The execute-node dispatcher in `src/app/api/execute-node/route.ts:20`
has `REAL_NODE_IDS` as a hard-coded `Set` literal:

```ts
const REAL_NODE_IDS = new Set([
  "TR-001","TR-003","TR-004","TR-005","TR-012", ... "EX-006"
]);
```

There is **no extension point** (no import, no registry merge). Adding
a node to handlers/index.ts is allowed (that file isn't forbidden), but
without the route.ts `REAL_NODE_IDS` entry the dispatcher rejects the
request with `NODE_NOT_IMPLEMENTED`.

**Plan for D5 given the obstacle:**

1. Add the catalogue entry (visible on canvas picker — purely client-side).
2. Create the handler file at `src/app/api/execute-node/handlers/gn-013-ai-ifc.ts`.
3. Register in `handlers/index.ts` (allowed).
4. **DEFER the `REAL_NODE_IDS` line** — surface it to Rutik as a one-line follow-up he can do in 30 seconds, rather than silently violate the forbidden-file rule.
5. Document the deferral clearly in the phase report.

The handler will be functional once the one-line gate is lifted; nothing
about the canvas integration depends on touching `route.ts` beyond
that one set-membership.

## Recommendations driving D2–D7

| Deliverable | Spec | Source surface |
|---|---|---|
| D2 | Sidebar icon `Sparkles` (AI flavour); label "AI IFC (beta)" (drop "v3" — leak of internal versioning into UX); position between existing items, not at top. | Sidebar |
| D3 | Quick Start card on `/dashboard` landing with title + subtitle + CTA → submit form. Gate on `briefToIfcV3Enabled`. | Dashboard landing |
| D4 | "Try a sample" disclosure with 5 buttons; click → pre-fill JSON tab. Don't make it the primary surface. | Submit form |
| D5 | New `GN-013` catalogue entry + handler + handlers/index.ts wire. Document `REAL_NODE_IDS` gap. | Canvas node picker |
| D6 | Cost estimate panel + "X / Y runs remaining this month" pulled from a new GET endpoint reading `BriefToIfcV3UserQuota`. | Submit form |
| D7 | Download IFC, Copy share link, Try another, Report bug buttons. | Results page |
