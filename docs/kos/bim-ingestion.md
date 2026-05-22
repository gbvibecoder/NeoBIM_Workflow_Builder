# KOS BIM Ingestion (Week 5A)

How Dincel/Kalzen Revit family (`.rfa`) and AutoCAD (`.dwg`) files become
structured panel/accessory/assembly SKUs in the KOS database, via the
Autodesk Platform Services (APS) Model Derivative API.

> **Scope.** Week 5A builds the infrastructure and verifies it end-to-end
> on **5 sample files** using FREE APS credits. Bulk ingestion of all 77
> files is **Week 5B** — it reuses everything here unchanged.

---

## 1. Why APS

`.rfa` / `.rvt` are Autodesk-proprietary binary formats. There is no
open parser. The APS **Model Derivative** API translates them to **SVF2**
(geometry) plus a **properties manifest** (the parameter values we need:
width, height, thickness, material, …). We never parse the binary
ourselves — we push it to APS, poll for the translation, and read the
structured output back.

## 2. Pipeline architecture

```
                         ┌──────────────────────────────────────────────┐
 local .rfa/.dwg         │              Autodesk Platform Services        │
       │                 │                                                │
       │ 1. SHA-256      │   ┌─────────┐   ┌──────────────────────────┐   │
       ├───────────────► │   │  OSS    │   │   Model Derivative       │   │
       │ (idempotency)   │   │ bucket  │   │   (SVF2 + properties)    │   │
       │                 │   └────▲────┘   └──────────▲───────────────┘   │
       │ 2. KOS S3       │        │ signed-S3         │ job + manifest    │
       │   (original)    │        │ 3-step upload     │ poll              │
       ▼                 └────────┼───────────────────┼───────────────────┘
 ┌───────────┐                    │                   │
 │  KOS S3   │   ◄── 3. upload    │                   │
 │ ap-south-1│       original     │                   │
 └───────────┘                    │                   │
       │                          │                   │
       │  4. uploadFileToAps ─────┘                   │
       │  5. startTranslationJob ─────────────────────┘
       │  6. pollTranslationStatus  (→ READY / FAILED)
       │  7. getTranslationMetadata + getTranslationManifest
       │  8. cache manifest.json → KOS S3
       ▼
 ┌──────────────────────────────────────────────────────────┐
 │ Postgres (Neon)                                            │
 │  KosBimFamily ──┬── KosBimPanelType  ── KosBimGeometry     │
 │   (1 per file)  ├── KosBimAccessory  ── KosBimGeometry     │
 │                 └── KosBimAssembly   ── KosBimGeometry     │
 │  KosBracingRule (created empty — populated in a later phase)│
 └──────────────────────────────────────────────────────────┘
```

### APS call sequence (one file)

| Step | Call | Endpoint |
|------|------|----------|
| Auth | `getApsAccessToken` | `POST /authentication/v2/token` (Client Credentials) |
| Bucket | `ensureApsBucketExists` | `GET/POST /oss/v2/buckets[/<key>/details]` |
| Upload 1 | request signed URLs | `GET /oss/v2/buckets/<key>/objects/<obj>/signeds3upload?parts=N` |
| Upload 2 | PUT each 5 MB chunk | the returned pre-signed **S3** URLs (ETag per part) |
| Upload 3 | finalize | `POST /oss/v2/buckets/<key>/objects/<obj>/signeds3upload` → `objectId` |
| Translate | `startTranslationJob` | `POST /modelderivative/v2/designdata/job` (`x-ads-force: true`) |
| Poll | `pollTranslationStatus` | `GET /modelderivative/v2/designdata/<urn>/manifest` |
| Metadata | `getTranslationMetadata` | `GET .../<urn>/metadata` then `.../<guid>/properties` |

The `objectId` is encoded to the Model Derivative **`urn`** as URL-safe
base64 **without padding** (`+`→`-`, `/`→`_`, strip `=`).

## 3. Files

| File | Role |
|------|------|
| `src/features/kos/lib/kos-bim-constants.ts` | Endpoints, scopes, limits, MIME map |
| `src/features/kos/lib/kos-bim-naming.ts` | Pure SKU / category / accessory-type classifiers |
| `src/features/kos/lib/aps-http.ts` | `fetchWithRetry` + backoff/jitter/Retry-After |
| `src/features/kos/services/aps-auth.ts` | 2-legged OAuth + token cache |
| `src/features/kos/services/aps-bucket.ts` | Bucket ensure/list |
| `src/features/kos/services/aps-translation.ts` | Upload + translate + poll + metadata |
| `src/features/kos/services/kos-bim-ingestion.ts` | `ingestSingleFamily` orchestrator |
| `src/features/kos/types/bim.ts` | APS response shapes |
| `scripts/kos-bim-test-ingest.ts` | CLI test driver |

## 4. Schema

`KosBimFamily` is one row per source file. The structured SKU rows
(`KosBimPanelType` / `KosBimAccessory` / `KosBimAssembly`) hang off it,
and each can carry a `KosBimGeometry` pointer. Geometry is a **separate
table** so the heavy mesh reference loads only on demand and a SKU can
later carry multiple LODs.

**Idempotency** is enforced at the DB level by
`@@unique([tenantId, sourceFileHash])` — the same file content within a
tenant can only ever be one row.

## 5. Folder → category mapping

| Folder | Category | Derived row |
|--------|----------|-------------|
| `profiles/` | `PANEL` | `KosBimPanelType` |
| `vertical/` | `ACCESSORY` | `KosBimAccessory` |
| `horizontal/` | `ACCESSORY` | `KosBimAccessory` |
| `systems/` | `ASSEMBLY` | `KosBimAssembly` |
| root `*.dwg` | `REFERENCE` | none (family row only) |
| anything else | `OTHER` | none |

## 6. SKU extraction

`extractSkuFromFilename` strips an optional `<Word>_` prefix (only when
immediately followed by `DIN`) and normalises the `DIN_` separator to
`DIN-`:

| Filename | SKU |
|----------|-----|
| `Profile_DIN-200P-1.rfa` | `DIN-200P-1` |
| `Track_DIN-110P-EG.rfa` | `DIN-110P-EG` |
| `Corner_DIN_110P-3.rfa` | `DIN-110P-3` |
| `EndCap_DIN_200P-EC.rfa` | `DIN-200P-EC` |
| `DIN-200P-Standard.rfa` | `DIN-200P-Standard` |
| `Finishes_DIN.rfa` | `DIN` |

`detectAccessoryType` maps the prefix: `Track_`→TRACK, `Finishes_`→FINISH,
`Voids_`→VOID, `Corner_`→CORNER, `Joiner_`→JOINER, `EndCap_`→END_CAP,
`StopEnd_`→STOP_END, `Spacer_`→SPACER, `Angle_`→ANGLE, else OTHER.

## 7. Idempotency

1. Compute SHA-256 of the file bytes (streaming).
2. Look up `KosBimFamily` by `(tenantId, sourceFileHash)`.
3. `READY` / `TRANSLATING` → **skip** (no APS credits spent).
4. `FAILED` / `PENDING` / `UPLOADING` → **reuse the row** and re-ingest.
5. Derived rows are **upserted** on `(tenantId, skuCode)` so a re-run is
   clean.

`--force` re-ingests even a `READY` family (re-spends credits).

## 8. Credit estimation (rough)

| Type | Estimate |
|------|----------|
| `.rfa` / `.rvt` | `50 + 10/MB` above 50 MB |
| `.dwg` | `30 + 5/MB` |
| `.ifc` | `50` |

This is a planning figure only — APS bills on its own meter. SVF2
translation is effectively free on current APS pricing; the estimate is
deliberately conservative so the run summary surfaces a non-zero number.

## 9. Error codes

| Code | Meaning | Fix |
|------|---------|-----|
| `KOS_APS_001` | Bad / missing credentials | Check `APS_CLIENT_ID` / `APS_CLIENT_SECRET`; confirm the app uses the Client Credentials grant |
| `KOS_APS_002` | Auth transport / unexpected response | Transient — retried automatically; persistent = APS outage |
| `KOS_APS_003` | Bucket op failed | See body in the error message |
| `KOS_APS_003_BUCKET_TAKEN` | Bucket name globally taken | Change `APS_BUCKET_KEY` (keys are global across all of Autodesk) |
| `KOS_APS_004` | Upload failed | See body; check network / object key |
| `KOS_APS_004_TOO_LARGE` | File > size limit (~200 MB) | Reduce file or raise `KOS_BIM_MAX_FILE_SIZE_MB` |
| `KOS_APS_005` | Translation submission failed | See body |
| `KOS_APS_006` | Manifest / metadata fetch failed | Usually transient |
| `KOS_APS_006_TIMEOUT` | Translation > 10 min | Try a smaller file, or re-run (re-submitting resumes) |
| `KOS_BIM_001` | Tenant not found | Run `npm run seed:kos` |
| `KOS_BIM_002` | Unsupported extension | Only `.rfa .dwg .rvt .ifc` are accepted |

## 10. Operations

### First-time setup

1. Create a **Server-to-Server** app at <https://aps.autodesk.com> with
   the **Client Credentials** grant.
2. Add to `.env.local`:
   ```
   APS_CLIENT_ID=...
   APS_CLIENT_SECRET=...
   APS_BUCKET_KEY=kos-buildflow-bim-dev   # must be globally unique
   APS_BUCKET_POLICY=transient
   ```
3. `npx prisma migrate deploy && npx prisma generate`

### Run the test pipeline

```bash
# categorisation only — no credentials, no APS calls:
npm run kos:bim-test-ingest -- --tenant=kalzen --dry-run

# real 5-file run:
npm run kos:bim-test-ingest -- --tenant=kalzen --limit=5
```

Flags: `--tenant`, `--path`, `--limit`, `--concurrency` (default 1, serial
is safest for APS), `--dry-run`, `--force`, `--filter="<glob>"`.

### Add new families

Drop files into `package_a/<folder>/` and re-run the script. Idempotency
(SHA-256) skips anything already ingested, so re-running the whole package
is safe and cheap.

### Re-translate a single file

Either pass `--force`, or delete the `KosBimFamily` row and re-run.

## 11. Known limitations / deferred to 5B+

- **Bulk ingestion** of all 77 files is 5B.
- **`KosBracingRule`** is created empty; spacing rules come from the
  Dincel installation manuals in a later phase.
- **`componentPanelSkus`** on assemblies is left empty — assembly→panel
  composition isn't reliably encoded in `.rfa` properties; a later phase
  resolves it from assembly geometry.
- **Empty geometry** is expected for some `.rfa` families (a Revit family
  often needs to be loaded into a project before geometry extracts). We
  log a warning and store the SKU without a geometry pointer rather than
  failing.
- **Geometry pointer** is the APS URN (`aps://<urn>`) for now; caching an
  extracted OBJ/glTF to S3 is a future optimisation.
