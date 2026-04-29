# Brief-to-Renders pipeline

Feature folder for the "Brief-to-Renders" pipeline: PDF/DOCX architectural
brief → strict-faithfulness spec extraction → user approval → N
photorealistic interior renders → editorial multi-page PDF deliverable.

This README is a quick orientation. The architectural source-of-truth
lives in `temp_folder/BRIEF_TO_RENDERS_EXECUTION_PLAN.md` (the multi-phase
plan) and `BRIEF_TO_RENDERS_AUDIT_REPORT_2026-04-28.md` at the repo root
(the read-only codebase audit).

## Pipeline shape

```
┌─────────────────────────────────────────────────────────────────────┐
│  /dashboard/brief-renders   (single dashboard page, mirrors VIP)    │
│                                                                     │
│  S1  Spec Extract     pdf-parse / mammoth → Claude tool_use         │
│        ↓ BriefSpec (every leaf nullable — no invention possible)    │
│  S2  Prompt Gen       deterministic string assembly, NO LLM         │
│        ↓ status: AWAITING_APPROVAL — user reviews + clicks Approve  │
│  S3  Image Gen        per-shot worker, gpt-image-1.5 images.edit()  │
│        ↓ shots[i].imageUrl persisted incrementally                  │
│  S4  PDF Compile      jspdf editorial layout, German + English      │
│        ↓ pdfUrl on R2                                               │
│  COMPLETED                                                          │
└─────────────────────────────────────────────────────────────────────┘
```

## Strict-faithfulness contract (load-bearing)

Every leaf field on `BriefSpec` (see `types/brief-spec.ts`) is nullable.
The Phase 2 spec extractor's tool definition forces the LLM to set
fields to `null` rather than invent values when the brief is silent.
Phase 3 prompt-gen is deterministic — empty/null fields produce empty
prompt fragments, never hallucinated descriptors. Phase 4 image gen
uses `images.edit()` with `input_fidelity: "high"` and the brief's
embedded reference images (when present) so the renders honour the
brief's visual anchors.

Do not weaken this contract. Generic output is the failure mode it
prevents.

## Phase 1 surface (what's wired today)

- `prisma.BriefRenderJob` — DB row for one pipeline run.
- `services/brief-pipeline/types.ts` — canonical types (stubs only).
- `services/brief-pipeline/canary.ts` — `shouldUserSeeBriefRenders`
  master gate + allowlist, surfaced via `/api/config/feature-flags`.
- `services/brief-pipeline/env-check.ts` — lazy validator for
  required env vars (called by Phase 3+ workers).
- `POST /api/upload-brief` — 50 MB-cap PDF/DOCX upload to R2 with
  magic-byte validation. Mirrors `/api/upload-ifc`.
- `IN-002` picker — extended to accept `.pdf,.docx`.

Everything else (Phase 2's extractor, Phase 3's approval gate, Phase 4's
N-shot worker, Phase 5's editorial PDF, Phase 6's dashboard page and
canary rollout) is intentionally absent from this folder until its
phase ships.

## Folder layout

```
src/features/brief-renders/
├── README.md                                ← you are here
├── services/
│   └── brief-pipeline/
│       ├── types.ts                         ← canonical types
│       ├── canary.ts                        ← feature flag
│       └── env-check.ts                     ← env var validator
└── types/
    └── brief-spec.ts                        ← public type re-exports
```

Future phases add: `components/`, `hooks/`, `services/brief-pipeline/{schemas,prompts,extractors,providers,stage-N-*}.ts`,
`services/brief-pipeline/pdf-layout.ts`.
