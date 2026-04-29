# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev              # Start Next.js dev server
npm run build            # Production build (runs prisma generate first)
npm run lint             # ESLint (v9 flat config)
npm test                 # Run all tests (vitest)
npm run test:watch       # Tests in watch mode
npm run test:ui          # Vitest UI dashboard
npm run test:coverage    # Tests with coverage (70% threshold enforced)
npx vitest run path/to/file.test.ts  # Run a single test file
npx prisma generate      # Regenerate Prisma client (run after pulling changes)
npx prisma migrate dev --name <change-name>   # Create + apply a new migration locally
npx prisma migrate deploy                     # Apply pending migrations in CI / production
```

> **Schema changes use `prisma migrate`, NEVER `prisma db push`.** A previous
> `db push` accidentally dropped two drift columns from `users` (4 + 1 records
> lost). The project is now baselined under `prisma/migrations/0_baseline`;
> all schema changes must go through `migrate dev` so every change ends up as a
> reviewable, reversible SQL file.

## Architecture Overview

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript 5 (strict) · Tailwind CSS 4 · Prisma 7 (Neon PostgreSQL) · NextAuth v5 beta · Zustand · React Flow (@xyflow/react) · Vitest

**What it does:** A visual workflow builder for BIM (Building Information Modeling). Users drag-and-drop nodes onto a canvas to build pipelines that parse IFC files, run AI analysis, generate reports, and export results.

## Folder Structure Rules (MANDATORY)

This project uses a feature-based folder structure. Every developer (human or AI) MUST follow these rules. No exceptions.

### Where to put new files

**Step 1: Does this file belong to a single feature?**
- YES → Put it in `src/features/<feature-name>/<type>/`
- NO (used by 2+ features) → Put it in `src/shared/<type>/` or `src/lib/`

**Step 2: Pick the right subfolder by file type:**
- React components → `components/`
- Zustand stores → `stores/`
- Custom hooks → `hooks/`
- API/data services → `services/`
- Utility/helper functions → `lib/`
- TypeScript types/interfaces → `types/`
- Constants/config → `constants/`

**Example:** A new BOQ chart component → `src/features/boq/components/BOQChart.tsx`
**Example:** A new shared date formatter → `src/lib/format-date.ts`
**Example:** A new IFC parsing service → `src/features/ifc/services/ifc-parser-v2.ts`

### The 18 feature folders

```
src/features/
  3d-render/     — 3D rendering, video walkthroughs, GLB generation
  admin/         — Admin dashboard, analytics, user management
  ai/            — AI services (OpenAI, Claude), prompt handling, AI chat
  billing/       — Stripe, Razorpay, subscriptions, pricing
  boq/           — BOQ visualizer, cost estimation, quantity corrections
  brief-renders/ — Brief-to-Renders pipeline (PDF/DOCX → photoreal renders + editorial PDF)
  canvas/        — React Flow canvas, nodes, edges, panels, toolbar
  community/     — Community marketplace, video sharing
  dashboard/     — Dashboard home, sidebar, header, hero scenes
  execution/     — Execution engine, result showcase, execution store
  floor-plan/    — Floor plan editor, CAD tools, room layout
  ifc/           — IFC viewer, parser, BIM tools
  landing/       — Landing page sections
  marketing/     — Exit intent, promotional modals
  onboarding/    — User onboarding, tooltips, tours
  referral/      — Referral system
  support/       — Support chat, conversations
  workflows/     — Workflow CRUD, workflow store, prebuilt workflows
```

### Shared code locations

```
src/shared/components/ui/   — Reusable UI primitives (Button, Card, Badge, etc.)
src/shared/components/      — Cross-cutting components (ErrorBoundary, CookieConsent, etc.)
src/shared/services/        — Cross-cutting services (email, email-templates)
src/shared/stores/          — Cross-cutting stores (ui-store only)
```

### Cross-cutting hotspots (DO NOT MOVE)

These files are imported by 15-75+ files. They stay where they are:

```
src/lib/db.ts, auth.ts, rate-limit.ts, user-errors.ts, utils.ts, r2.ts, logger.ts, i18n.ts, validation.ts
src/hooks/useLocale.ts, useAvatar.ts, useFeatureFlags.ts
src/types/workflow.ts, execution.ts, nodes.ts, floor-plan-cad.ts
src/constants/limits.ts, design-tokens.ts
```

### Rules that MUST NOT be violated

1. **NEVER create files directly in `src/components/`** — this directory no longer exists. Use `src/features/<feature>/components/` or `src/shared/components/`.
2. **NEVER create feature-specific files in `src/lib/`** — `src/lib/` is for cross-cutting utilities only. Feature-specific logic goes in `src/features/<feature>/lib/`.
3. **NEVER create feature-specific stores in `src/stores/`** — feature stores go in `src/features/<feature>/stores/`. Only `ui-store` lives in `src/shared/stores/`.
4. **NEVER create feature-specific services in `src/services/`** — use `src/features/<feature>/services/`.
5. **NEVER import from one feature into another feature** (e.g., `features/canvas/` importing from `features/floor-plan/`). If two features need the same code, move it to `src/shared/` or `src/lib/`.
6. **API routes stay in `src/app/api/`** — Next.js requires this. Import feature logic from `src/features/`.
7. **Pages stay in `src/app/`** — Next.js requires this. Import feature components from `src/features/`.
8. **New Prisma models** go in `prisma/schema.prisma`. Always use `prisma migrate dev --name <descriptive_name>`. Never use `prisma db push`.
9. **New constants** — if used by one feature, put in `features/<feature>/constants/`. If used by 2+ features, put in `src/constants/`.
10. **New types** — if used by one feature, put in `features/<feature>/types/`. If shared, put in `src/types/`.

### Database rules

- All data persistence goes through Prisma → PostgreSQL (Neon). No localStorage for user data (floor-plan persistence is a known exception being migrated).
- Execution UI state (quantity overrides, video progress, regen counts) persists via `Execution.metadata` JSONB column through `PATCH /api/executions/[id]/metadata`.
- Community likes are tracked per-user via `CommunityVideoLike` join table. The `CommunityVideo.likes` counter is denormalized and maintained transactionally.
- Rate limiting uses Upstash Redis. Never use in-memory Maps for rate limiting.
- Regen limits are server-enforced via atomic Prisma transaction in `/api/execute-node`. Client-side counts are UX hints only.

### Before creating any file, ask yourself:

1. Which feature does this belong to?
2. Is it a component, service, store, hook, type, constant, or lib utility?
3. Is it feature-specific or shared across features?
4. Does a similar file already exist in that feature folder?

If unsure, default to the feature folder. It's easier to move something to shared/ later than to untangle a misplaced shared file.

### Key Architectural Patterns

**Env validation:**
- `src/lib/env.ts` — Zod-validated env schema with REQUIRED / RECOMMENDED / OPTIONAL tiers
- `instrumentation.ts` — Calls `validateEnv()` on Node.js boot via Next.js instrumentation hook
- Required vars throw at startup; recommended vars warn loudly via `console.warn`
- Tests don't trigger validation (it runs only in instrumentation, not at module import)

**Node handler decomposition:**
- `src/app/api/execute-node/route.ts` — Thin dispatcher (~280 lines): auth, rate limit, validation, then dispatch to a handler
- `src/app/api/execute-node/handlers/` — One file per `catalogueId` (TR-001, GN-009, etc.), 23 handlers total
- `handlers/types.ts` — `NodeHandler` type and `NodeHandlerContext` interface
- `handlers/index.ts` — Registry mapping `catalogueId` → handler function
- `handlers/deps.ts` — Aggregated re-exports of dependencies handlers need
- `handlers/shared.ts` — Helper functions used by multiple handlers
- Adding a new node: create `handlers/<id>.ts`, register it in `handlers/index.ts`, add to `REAL_NODE_IDS` in `route.ts`

**Showcase Error Boundaries:**
- `src/features/execution/components/result-showcase/index.tsx` wraps each tab (`OverviewTab`, `MediaTab`, `DataTab`, `ModelTab`, `ExportTab`) in the shared `ErrorBoundary` from `src/shared/components/ErrorBoundary.tsx`. A crash in one tab does not tear down the showcase or block users from switching to a working tab.

**Image generation:**
- All image generation uses **OpenAI `gpt-image-1.5`** via a single canonical module: `src/features/ai/services/image-generation.ts`. The exported `OPENAI_IMAGE_MODEL` constant is the only model literal that should appear anywhere in the codebase. The `scripts/check-no-deprecated-image-models.sh` lint guard (wired into `npm run lint`) blocks accidental re-introduction of `dall-e-3` or bare `gpt-image-1` literals.
- **Architectural rule:** when a reference image (sketch / floor plan / photo / PDF page) is available at the call site, it MUST be passed via `images.edit()` with `input_fidelity` tuned for the use case — never described in text and submitted to `images.generate()`. Generic output is the failure mode this rule prevents. The `floor-plan-rasterizer.ts` module is the canonical way to convert room data into a reference PNG.
- **Emergency rollback:** set `IMAGE_MODEL_OVERRIDE=gpt-image-1` in production env to revert without redeploy. The override logs a `[image-gen]` warning at boot when active so it doesn't silently control production. Permanent escape hatch by design.
- `normalizeImageResponse()` is the canonical handler for OpenAI image responses (handles both URL and `b64_json` shapes; uploads to R2 when present, falls back to data URI).

**Auth (split config pattern):**
- `src/lib/auth.config.ts` — Lightweight, edge-safe config used by middleware
- `src/lib/auth.ts` — Full config with Prisma adapter and providers (Google OAuth + Credentials)
- `middleware.ts` — NextAuth edge middleware protecting `/dashboard` routes

**State management (Zustand stores):**
- `src/features/workflows/stores/workflow-store.ts` — Nodes, edges, undo/redo (50-step history), save state
- `src/features/execution/stores/execution-store.ts` — Execution results and artifacts
- `src/shared/stores/ui-store.ts` — UI state (modals, panels, sidebar)
- `src/features/floor-plan/stores/floor-plan-store.ts` — Floor-plan editor state
- `src/features/support/stores/support-store.ts` — Support chat state
- `src/stores/index.ts` is a re-export barrel pointing at the new locations — `useWorkflowStore`, `useExecutionStore`, `useUIStore` can still be imported from `@/stores`.

**API error handling:** All API routes return errors as structured `UserError` objects via `formatErrorResponse()` from `src/lib/user-errors.ts`. Error codes are namespaced: AUTH_001, VAL_001, RATE_001, OPENAI_001, NODE_001, NET_001, FORM_001, BILL_001.

**Node catalogue:** `src/features/workflows/constants/node-catalogue.ts` defines all available workflow nodes with categories: input (blue), transform (purple), generate (green), export (amber). IDs follow pattern: `IN-001`, `TR-001`, `GE-001`, `EX-001`.

**Rate limiting:** Upstash Redis sliding window — 5/month (FREE), 10/month (MINI), 30/month (STARTER), 100/month (PRO). TEAM_ADMIN/PLATFORM_ADMIN bypass limits. Admin emails bypass limits. Per-node-type metered limits (video, 3D, render) use atomic Redis INCR with monthly auto-expiry. Logic in `src/lib/rate-limit.ts`.

**Brief-to-Renders pipeline (`src/features/brief-renders/`):**
A self-contained PDF/DOCX → photoreal-renders + editorial PDF flow that
deliberately bypasses the canvas. Mounted at `/dashboard/brief-renders`
(server component, canary-gated) and lives under its own API namespace
`/api/brief-renders/`.

- **Stages** (one orchestrator file each, names mirror VIP):
  1. `stage-1-spec-extract.ts` — Anthropic Sonnet 4.6 `tool_use` parses
     the brief into a strict-faithfulness-contracted `BriefSpec`. Every
     leaf is nullable; the prompt forbids invention.
  2. `stage-2-prompt-gen.ts` — Pure deterministic. No `Math.random` /
     `Date.now`. Empty source → empty fragment, never a placeholder.
  3. `stage-3-image-gen.ts` — Per-shot worker. Mutex via Upstash Redis
     SET-NX-EX with Lua-script value-matched release. Calls
     `images.edit()` with `input_fidelity:"high"` when reference
     images are present. Atomic `jsonb_set` on the shots array
     (avoids lost-update races). Adaptive 5/15/45 s backoff schedule.
  4. `stage-4-pdf-compile.ts` — Editorial layout via `jspdf`. Inter
     font with Helvetica fallback. Cover + per-shot pages.
     Deterministic R2 key `briefs-pdfs-{jobId}.pdf`.
- **State machine:** QUEUED → RUNNING (`spec_extracting`) →
  AWAITING_APPROVAL → RUNNING (`rendering` → `awaiting_compile` →
  `compiling`) → COMPLETED. Cancel transitions to CANCELLED from any
  non-terminal state via conditional `updateMany`.
- **Canary rollout:** `services/brief-pipeline/canary.ts` — pure
  function `shouldUserSeeBriefRenders(email, userId)` reads
  `PIPELINE_BRIEF_RENDERS=true` (master), `BRIEF_RENDERS_BETA_EMAILS`,
  and `BRIEF_RENDERS_ADMIN_OVERRIDE_EMAILS`. Surfaced to the client
  via `GET /api/config/feature-flags`. Sidebar entry, templates promo
  card, and the dashboard page are all gated on the same boolean.
- **Quota:** `getBriefRendersMonthlyLimit(role)` in
  `src/features/billing/lib/stripe.ts`. FREE=1, MINI=2, STARTER=5,
  PRO=20, TEAM/PLATFORM_ADMIN=unlimited. Enforced server-side in
  `POST /api/brief-renders` (returns 402 on exceed).
- **Idempotency:** `crypto.randomUUID()` minted client-side in
  `useBriefRenderUpload`, persisted to localStorage so a refresh
  during upload retries with the same key. Cleared on success.
- **R2 keys (deterministic, idempotency-safe):**
  - Briefs: `briefs/<date-prefixed>/<random>.pdf`
  - Shots: `briefs-shots-{jobId}-{ai}-{si}.png`
  - PDFs:  `briefs-pdfs-{jobId}.pdf`
- **Rollback:** flip `PIPELINE_BRIEF_RENDERS` off — every nav entry,
  promo card, and API route hides immediately for everyone except
  emergency admin overrides.

### Source Layout

> Phase 3 reorganized the codebase into feature folders. The authoritative
> rules for **where new files go** live in **"## Folder Structure Rules
> (MANDATORY)"** above. The tree below is a snapshot of the resulting
> layout — read it together with those rules, not instead of them.

```
src/
├── app/                                # Next.js routes (REQUIRED to live here)
│   ├── (auth)/                         # Login/register (public)
│   ├── dashboard/                      # Main app (protected), [id]/ for workflow detail
│   ├── demo/                           # Public demo (no auth)
│   ├── admin/                          # Admin console
│   └── api/
│       ├── auth/                       # NextAuth + registration
│       ├── workflows/                  # CRUD + [id] routes
│       ├── execute-node/               # Single node execution + handlers/
│       ├── executions/[id]/metadata/   # Execution.metadata persistence
│       ├── parse-ifc/                  # BIM file parsing
│       ├── ai-chat/                    # OpenAI chat
│       ├── stripe/                     # Billing webhooks & checkout
│       ├── brief-renders/               # Brief→Renders pipeline endpoints + workers
│       └── user/                       # Profile/settings
│
├── features/                           # 18 feature folders (see rules above)
│   ├── 3d-render/    {constants, lib, services}
│   ├── admin/        {components}
│   ├── ai/           {components, services}
│   ├── billing/      {lib}                                  # stripe, razorpay
│   ├── boq/          {components, constants, lib, services} # BOQ visualizer + costing
│   ├── brief-renders/{components, hooks, services/brief-pipeline} # Brief→Renders flow
│   ├── canvas/       {components/{artifacts,edges,modals,nodes,panels,toolbar}}
│   ├── community/    {components}
│   ├── dashboard/    {components}                           # hero scenes, sidebar, header
│   ├── execution/    {components/result-showcase, hooks, services, stores}
│   ├── floor-plan/   {components/{panels,renderers}, lib, services, stores, types}
│   ├── ifc/          {components, services}
│   ├── landing/      {components, lib}
│   ├── marketing/    {components}
│   ├── onboarding/   {components}
│   ├── referral/     {components}
│   ├── support/      {components, services, stores}
│   └── workflows/    {components, constants, stores}        # workflow-store, prebuilt-workflows, node-catalogue
│
├── shared/                             # Cross-cutting code (used by 2+ features)
│   ├── components/
│   │   ├── ui/                         # Button, Card, Badge, CommandPalette, …
│   │   ├── providers/                  # SessionProvider
│   │   └── (root)                      # ErrorBoundary, CookieConsent, MobileGate, TrackingScripts, UTMCapture
│   ├── services/                       # email, email-templates, email-weekly-digest
│   └── stores/                         # ui-store
│
├── lib/                                # Cross-cutting hotspots (DO NOT MOVE — see rules)
│                                       # db, auth, auth.config, rate-limit, env, env-check,
│                                       # validation, user-errors, utils, r2, logger, i18n,
│                                       # analytics, api, share, track, utm, gamification,
│                                       # admin-auth, admin-server, award-xp, cookie-consent,
│                                       # form-validation, meta-pixel, referral, safe-error,
│                                       # temp-image-store, ui-constants, webhook-idempotency,
│                                       # workflow-logger
├── hooks/                              # useAvatar, useLocale + index.ts barrel
│                                       # (useExecution lives in features/execution/hooks/)
├── stores/                             # index.ts barrel ONLY — re-exports from features/ + shared/
├── services/                           # pdf-report.ts, pdf-report-server.ts (only)
├── constants/                          # design-tokens.ts, limits.ts (only)
├── types/                              # workflow, execution, nodes, sam3d, geometry,
│                                       # ifc-viewer, support, architectural-viewer,
│                                       # floor-plan-cad, gtag.d, index.ts barrel
│                                       # (feature-specific types live under features/<f>/types/)
└── styles/
```

**Path alias:** `@/*` → `./src/*`. Imports in this codebase use absolute paths almost exclusively (e.g. `@/features/boq/services/boq-intelligence`); relative imports are reserved for tightly-coupled siblings inside the same directory.

### API Route Conventions

- Protected routes: get session via `await auth()`, check `session?.user?.id`, return 401 if missing
- Dynamic routes: accept `params` as `Promise<{id: string}>` and `await` it
- Always verify resource ownership: `findFirst({ where: { id, ownerId: session.user.id } })`
- Rate limit authenticated routes with `checkEndpointRateLimit(userId, "endpoint-name", limit, "1 m")`
- All errors returned via `formatErrorResponse()` with appropriate status codes
- Analytics calls are fire-and-forget: `.catch(() => {})`

### Database (Prisma)

Schema: `prisma/schema.prisma`. All models use CUID IDs and `@@map()` for snake_case table names.

Key models: `User` (roles: FREE/MINI/STARTER/PRO/TEAM_ADMIN/PLATFORM_ADMIN, Stripe fields, XP/level), `Workflow` (tileGraph JSON for edges+nodes), `TileInstance` (node on canvas), `Execution` (status: PENDING/RUNNING/SUCCESS/PARTIAL/FAILED), `Artifact` (output types: TEXT/JSON/IMAGE/THREE_D/FILE/TABLE/KPI), `CommunityPublication`, `Review`.

### Type Conventions

- `WorkflowNode` / `WorkflowEdge` — canvas elements
- `NodeCatalogueItem` — node definition from catalogue
- `NodeCategory` — `"input" | "transform" | "generate" | "export"`
- `NodeStatus` — `"idle" | "running" | "success" | "error"`
- Prisma uses CUID (25 chars, starts with 'c'); client-generated temp IDs are 7 chars. Use `isPersistedId()` to distinguish.

### Path Alias

`@/*` maps to `./src/*` (configured in tsconfig.json).

## Environment Variables

Requires `.env.local` (not committed). See `.env.example` for a template. Key vars: `DATABASE_URL`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`. Set `NEXT_PUBLIC_ENABLE_MOCK_EXECUTION=true` for local dev without API keys.

## Testing

- Framework: Vitest with `@testing-library/react`
- Setup file: `tests/setup.ts` (mocks all env vars before tests)
- Test dirs: `tests/unit/`, `tests/integration/`, `tests/mocks/`
- Test environment: `happy-dom` (configured in `vitest.config.ts`)
- Coverage thresholds: 70% (lines, functions, branches, statements)

## Infrastructure

**Cloudflare R2 (next.config.ts rewrites):** 3D models and textures are proxied through `/r2-models/` and `/r2-textures/` routes to avoid CORS. Presigned URL uploads go through `/r2-upload/`. Falls back to `R2_PUBLIC_URL` env var or a public CDN default.

**Sentry:** Only active when `NEXT_PUBLIC_SENTRY_DSN` is set — config wrapping is conditional to avoid runtime crashes without it.

**Image optimization:** AVIF/WebP prioritized, 1-year cache TTL. External sources whitelisted: Unsplash, Google, Azure Blob, Picsum.

**Bundle optimization:** `next.config.ts` explicitly optimizes imports for `lucide-react`, Radix UI components, and `framer-motion` to reduce bundle size.

## Security

- CSP headers configured in `next.config.ts` — `unsafe-eval` is intentional for Three.js shader compilation in blob iframes
- Input sanitization with DOMPurify
- Password hashing: bcryptjs (12 rounds)
- Server action body limit: 2MB
