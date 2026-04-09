# Security

## Reporting a vulnerability

Please email security findings privately rather than opening a public issue.
Add details once a contact is established for the project.

## Accepted-risk vulnerabilities

After Phase 2 Task 7's `npm audit` triage, the following vulnerabilities
remain in the dependency tree because they are either (a) not upstream-fixed
or (b) only fixable via a destructive downgrade. Each one was evaluated and
accepted with the rationale below.

### `xlsx` (high) — no upstream fix

| Field | Value |
|---|---|
| Package | `xlsx` (a.k.a. SheetJS) |
| Direct dep | yes (`^0.18.5`) |
| Advisories | [GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) (Prototype Pollution), [GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9) (ReDoS) |
| Used by | `src/app/api/execute-node/handlers/ex-002.ts` (BOQ → Excel export) |
| Fix available | **No** — the free npm `xlsx` distribution has been semi-abandoned for security patches. SheetJS Pro (CDN tarball) has fixes but is not on npm. |

**Why we accept this risk:**
- The handler **writes** xlsx files based on internal BOQ data — it does **not** parse user-supplied xlsx files.
- Prototype Pollution requires attacker-controlled object keys flowing into a `_.unset`-style sink. EX-002 builds plain objects from typed BOQ data; there is no path for attacker-controlled keys to reach SheetJS internals.
- ReDoS requires attacker-controlled regex inputs. EX-002 doesn't accept user regex patterns.
- The handler runs server-side only — `xlsx` is never bundled to the client.

**Mitigations to consider for Phase 3+:**
1. **Switch to `exceljs`** — actively maintained alternative, similar API, ~50–100 LOC rewrite of `ex-002.ts`.
2. **Pin to SheetJS CDN tarball** — `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.x/xlsx-0.20.x.tgz"`. Patched but breaks reproducible-build conventions.
3. **Generate XLSX server-side without SheetJS** — possible for simple BOQ shapes via raw Office Open XML, but loses zero-dep convenience.

### Prisma 7.x transitive chain (3 × moderate)

| Package | Severity | Path |
|---|---|---|
| `@hono/node-server <1.19.13` | moderate | `prisma → @prisma/dev → @hono/node-server` |
| `@prisma/dev` | moderate | `prisma → @prisma/dev` |
| `prisma >=6.20.0-dev.1` | moderate | direct dep, indirect vuln via the chain above |

**Advisory:** [GHSA-92pp-h63x-v22m](https://github.com/advisories/GHSA-92pp-h63x-v22m) — `@hono/node-server` middleware bypass via repeated slashes in `serveStatic`.

**Why we accept this risk:**
- `@prisma/dev` is the **local Prisma development server** used during `prisma migrate dev` workflows. It is **not** part of the production runtime — production uses `@prisma/client`, which doesn't pull in `@prisma/dev` or `@hono/node-server`.
- The advisory targets a static-file middleware path that this codebase doesn't expose externally.
- The only `npm audit fix` that resolves this would **downgrade** prisma from `^7.5.0` to `6.19.3` — a major version downgrade that would lose v7 features (including the migration improvements this project depends on).
- Waiting for upstream Prisma to release a patch that bumps their internal `@hono/node-server` dep is the correct path.

**Re-check on**: every Prisma minor release. If `prisma` ships a version that bumps `@hono/node-server` past 1.19.13, run `npm audit fix` again to clear this group.

## Re-triage cadence

`npm audit` should be re-run on:
- Every npm package upgrade
- Every Prisma minor release
- Quarterly at minimum

The accepted-risk list above should be reviewed and either reduced (when upstream fixes land) or expanded with new entries.

## What was fixed in Phase 2 Task 7

`npm audit` count went from **22 → 4** across two commits:
1. `chore(deps): npm audit fix` — in-range bumps for jspdf, happy-dom, prisma, @prisma/client, plus ~10+ transitive cascades (lodash/chevrotain chain, picomatch, vite, fast-xml-parser, brace-expansion, flatted, defu, and others).
2. `chore(deps): bump next 16.1.6 → 16.2.3` — manual bump past the exact pin to fix 5 moderate Next.js advisories.

The remaining 4 are documented above.
