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
- `src/components/canvas/result-showcase/index.tsx` wraps each tab (`OverviewTab`, `MediaTab`, `DataTab`, `ModelTab`, `ExportTab`) in the shared `ErrorBoundary` from `src/components/ErrorBoundary.tsx`. A crash in one tab does not tear down the showcase or block users from switching to a working tab.

**Auth (split config pattern):**
- `src/lib/auth.config.ts` — Lightweight, edge-safe config used by middleware
- `src/lib/auth.ts` — Full config with Prisma adapter and providers (Google OAuth + Credentials)
- `middleware.ts` — NextAuth edge middleware protecting `/dashboard` routes

**State management (Zustand stores):**
- `src/stores/workflow-store.ts` — Nodes, edges, undo/redo (50-step history), save state
- `src/stores/execution-store.ts` — Execution results and artifacts
- `src/stores/ui-store.ts` — UI state (modals, panels, sidebar)

**API error handling:** All API routes return errors as structured `UserError` objects via `formatErrorResponse()` from `src/lib/user-errors.ts`. Error codes are namespaced: AUTH_001, VAL_001, RATE_001, OPENAI_001, NODE_001, NET_001, FORM_001, BILL_001.

**Node catalogue:** `src/constants/node-catalogue.ts` defines all available workflow nodes with categories: input (blue), transform (purple), generate (green), export (amber). IDs follow pattern: `IN-001`, `TR-001`, `GE-001`, `EX-001`.

**Rate limiting:** Upstash Redis sliding window — 5/month (FREE), 10/month (MINI), 30/month (STARTER), 100/month (PRO). TEAM_ADMIN/PLATFORM_ADMIN bypass limits. Admin emails bypass limits. Per-node-type metered limits (video, 3D, render) use atomic Redis INCR with monthly auto-expiry. Logic in `src/lib/rate-limit.ts`.

### Source Layout

```
src/
├── app/
│   ├── (auth)/           # Login/register (public routes)
│   ├── dashboard/        # Main app (protected), [id]/ for workflow detail
│   ├── demo/             # Public demo (no auth required)
│   └── api/
│       ├── auth/         # NextAuth + registration
│       ├── workflows/    # CRUD + [id] routes
│       ├── execute-node/ # Single node execution
│       ├── parse-ifc/    # BIM file parsing
│       ├── ai-chat/      # OpenAI chat
│       ├── stripe/       # Billing webhooks & checkout
│       └── user/         # Profile/settings
├── components/
│   ├── canvas/           # React Flow canvas, nodes/, edges/, artifacts/, panels/, toolbar/
│   ├── dashboard/        # Header, Sidebar, FloatingNav
│   ├── ui/               # CommandPalette (⌘K), shared widgets
│   ├── community/        # Community workflow marketplace
│   └── landing/          # Marketing/landing page
├── stores/               # Zustand stores (workflow, execution, ui)
├── services/             # OpenAI client, IFC parser, mock executor, PDF generation
├── hooks/                # useExecution, useLocale
├── lib/                  # Auth, DB, rate limiting, errors, validation, analytics, i18n
├── types/                # nodes.ts, workflow.ts, execution.ts
└── constants/            # node-catalogue, prebuilt-workflows, unit-rates
```

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
