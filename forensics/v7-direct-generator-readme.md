# v7 Direct-Generator CLI

`scripts/forensics/run-brief-direct.ts` — the permanent autonomous-testing capability shipped in commit `a4c980df`'s follow-up. Bypasses HTTP / NextAuth / Prisma / Pusher / QStash, calling the v3 generator function in-process so forensic phases can run with one command and no cookie.

---

## Why this exists

Previous forensic phases (v6 multi-brief audit) required a cookie copied from the browser dev tools. That made automated regression slow and gated on a human paste. After v7 backend surgery added the `add_door`/`add_window` helpers + irregular-footprint polygon support, the natural next step was empirical verification across 9 diverse briefs. Re-paste the cookie 9 times? No. The CLI is the durable fix.

---

## What it does

1. Loads `.env.local` (and pulls `IFC_SERVICE_API_KEY` from a file path or env var)
2. Reads a brief text file
3. Calls `enrichBrief()` (Layer 1) — raw text → `BriefSpec`
4. Calls `runGenerator()` (Layer 2) — `BriefSpec` → agent loop → IFC at R2 URL
5. Fetches the IFC bytes from R2
6. Saves five artifacts per run: `<label>.ifc`, `<label>-briefspec.json`, `<label>-agent-turns.json`, `<label>-summary.json`

No HTTP server, no DB writes, no NextAuth, no Pusher, no QStash — just the agent loop in Node calling Anthropic + the Railway sandbox.

---

## Required environment

`.env.local` must have:

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Layer 1 enrichBrief + Layer 2 agent's Anthropic calls |
| `IFC_SERVICE_URL` | Railway Python sandbox URL |
| `IFC_SERVICE_API_KEY` | Bearer token for the sandbox |

If `IFC_SERVICE_API_KEY` isn't in your `.env.local` (it isn't in the default Vercel pull), you can supply it via a temp file:

```bash
echo 'your-bearer-token' > /tmp/.bf_ifc_key
chmod 600 /tmp/.bf_ifc_key
BUILDFLOW_IFC_KEY_FILE=/tmp/.bf_ifc_key npx tsx scripts/forensics/run-brief-direct.ts ...
```

The CLI reads `BUILDFLOW_IFC_KEY_FILE` if set and primes `process.env.IFC_SERVICE_API_KEY` from it before importing the v3 modules.

---

## Usage

```bash
npx tsx scripts/forensics/run-brief-direct.ts \
  --brief <path/to/brief.txt> \
  --out-dir <path/to/output/dir> \
  --label <unique-name> \
  [--project-type <exhibition_booth|office|residential|retail>] \
  [--max-turns <int>] \
  [--cost-cap <float>]
```

The `--project-type` hint matters for Layer 1 enrichment. When omitted, the v3 default is `exhibition_booth`. For residential or office briefs, pass the appropriate value or Layer 1 may produce a malformed BriefSpec (observed empirically — see `forensics/multi-brief-accuracy-v7-2026-05-18.md` §5 for the home-office / bedroom failure mode and resolution).

---

## Output layout

```
<out-dir>/
├── <label>.ifc                  ← final IFC bytes (fetched from R2)
├── <label>-briefspec.json       ← Layer 1 output snapshot
├── <label>-agent-turns.json     ← per-turn agent trace + ledger + finalValidation
└── <label>-summary.json         ← top-level metrics (cost, duration, entity count, KPIs)
```

Pair with `scripts/forensics/ifc-inspect.py` for entity-level analysis (it auto-detects the `<label>-briefspec.json` sibling and runs polygon-vs-AABB checks) and `scripts/forensics/ifc-render-preview.py --out-dir <dir>` for top + iso PNG renders.

---

## Typical session

```bash
# Step 1 — refresh the sandbox key
echo 'cd17...' > /tmp/.bf_ifc_key && chmod 600 /tmp/.bf_ifc_key

# Step 2 — run a brief
BUILDFLOW_IFC_KEY_FILE=/tmp/.bf_ifc_key \
  npx tsx scripts/forensics/run-brief-direct.ts \
    --brief scripts/forensics/briefs/v7-b-2bedroom.txt \
    --out-dir prod-eval-outputs-v7/postfix \
    --label v7-b-2bedroom \
    --project-type residential

# Step 3 — inspect
python3 scripts/forensics/ifc-inspect.py prod-eval-outputs-v7/postfix/v7-b-2bedroom.ifc

# Step 4 — render
python3 scripts/forensics/ifc-render-preview.py \
  --out-dir prod-eval-outputs-v7/postfix \
  prod-eval-outputs-v7/postfix/v7-b-2bedroom.ifc

# Step 5 — clean up
shred -uvz /tmp/.bf_ifc_key
```

---

## Typical cost & latency

From the v7 9-brief run on 2026-05-18:

| Brief size | Cost | Duration | Turns | Entities |
|---|---|---|---|---|
| Bathroom (213 chars) | $0.18 | 69 s | 6 | 380 |
| Bedroom (158 chars) | $0.18 | 58 s | 7 | 357 |
| Home office (228 chars) | $0.21 | 78 s | 9 | 434 |
| Clinic reception (300 chars) | $0.24 | 83 s | 9 | 542 |
| L-shape office (370 chars) | $0.40 | 140 s | 12 | 950 |
| Co-working (471 chars) | $0.36 | 120 s | 9 | 1001 |
| SOL booth (903 chars) | $0.35 | 121 s | 9 | 895 |
| V7-A L-shape (379 chars) | $0.29 | 95 s | 8 | 735 |
| V7-B 2-bedroom (350 chars) | $0.22 | 74 s | 6 | 676 |

**Mean: $0.27 per brief, 93 s wall-clock, 8 agent turns, 663 entities.**

The 9-brief verification cost $3.02 total. Future regression sweeps after a prompt or helper change are similar.

---

## Extending for new forensic phases

To run a new brief:
1. Write the brief text to `scripts/forensics/briefs/<label>.txt`
2. Pick a `--project-type` matching the brief intent
3. Run with `--label <stem>` matching the .txt filename stem
4. Inspect + render with the existing tools

To extend the CLI itself (e.g., add a new agent option):
- Edit `scripts/forensics/run-brief-direct.ts`
- The function imports are dynamic so dotenv runs first — keep that pattern when adding new v3 modules
- The CLI is intentionally Node-only; it should never depend on browser-only React or Next runtime

---

## Limitations

- **R2 access is via public URLs.** The sandbox uploads completed IFCs to R2 with public-read keys; the CLI fetches without further auth. If R2 ACLs change, the fetch step needs to use signed URLs.
- **No retry loop.** A single Anthropic glitch (observed twice in 9 runs as `INVALID_BRIEF_SPEC`) fails the run. Re-invoke the CLI manually. Future improvement: add a `--retries 2` flag.
- **Layer 1 has been observed failing on simple briefs without an explicit `--project-type` hint.** Always pass `--project-type` for residential / office / retail briefs.
- **No streaming feedback** beyond per-turn stdout. For live progress observation use the cookie path against `/api/brief-to-ifc/v3/runs` which has Pusher streaming.
