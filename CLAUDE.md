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
npx prisma db push       # Push schema changes to DB
```

## Architecture Overview

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript 5 (strict) · Tailwind CSS 4 · Prisma 7 (Neon PostgreSQL) · NextAuth v5 beta · Zustand · React Flow (@xyflow/react) · Vitest

**What it does:** A visual workflow builder for BIM (Building Information Modeling). Users drag-and-drop nodes onto a canvas to build pipelines that parse IFC files, run AI analysis, generate reports, and export results.

### Key Architectural Patterns

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
- Test environment: `node` (configured in `vitest.config.ts`)
- Coverage thresholds: 70% (lines, functions, branches, statements)

## Security

- CSP headers configured in `next.config.ts`
- Input sanitization with DOMPurify
- Password hashing: bcryptjs (12 rounds)
- Server action body limit: 2MB
