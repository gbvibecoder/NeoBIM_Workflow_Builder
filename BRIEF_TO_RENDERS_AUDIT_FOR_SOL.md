# Brief-to-Renders Pipeline Audit — Feasibility for SOL Properties

> **Read-only audit.** Zero code changes. Question: can the existing
> Brief-to-Renders pipeline render the SOL Properties exhibition stand if
> we reformat the SOL brief into the Marxstraße-12 structured-brief format?
>
> Source input audited: `Rendering_Brief_v2_Marxstrasse12 ( Inputs ).docx`
> Pipeline audited: `src/features/brief-renders/**` (read-only)

---

## Section 1 — Marxstraße-12 input DOCX schema (verbatim structure)

The DOCX is the canonical input the pipeline was built for. Its structure:

### 1.1 Document order

```
RENDERING-BRIEFING v2                          ← title line
Marxstraße 12, 76571 Gaggenau                  ← address line
12 Architektur-Visualisierungen · unmöbliert…  ← scope line

[METADATA TABLE]  (8 key→value rows)
  Projekt | Substanz | Sanierung | Umfang | Stil | Zweck |
  Plangrundlage | Briefing-Version

1. Projekt-Kontext            ← prose, project narrative
2. Stil & Prinzipien
   2.1 Stil-Intention         ← bullet list
   2.2 Was wird gezeigt       ← bullet list (positive)
   2.3 Was NICHT gezeigt wird ← bullet list (negative)
   2.4 Architektonische Baseline   ← TABLE (Bauteil | Ausführung)
   2.5 Lichtstrategie         ← bullet list
   2.6 Kamera-Vorgaben        ← bullet list
3. Küchen-Markierung — Detail-Spec   ← TABLE (Element | Spec)
4. Bad-Vorinstallationen — Detail-Spec ← TABLE (Element | Sichtbarkeit)

WE 01bb — 93,99 m²            ← UNIT heading: "<label> — <area> m²"
3-Zimmer + Ankleide           ← unit descriptor line
Shot-Liste — 4 Renderings     ← shot-count line
   Shot 1 — Kochen / Essen (32,54 m²) — Hauptraum   ← SHOT heading
   [SHOT TABLE]  (Spec | Vorgabe — 6 rows)
   Shot 2 — Wohnen (19,24 m²)
   [SHOT TABLE]
   Shot 3 — Bad (7,59 m²)
   [SHOT TABLE]
   Shot 4 — Schlafen (12,03 m²) mit Blick zur Ankleide (6,72 m²)
   [SHOT TABLE]

WE 02bb — 95,36 m²   … 4 shots …
WE 03bb — 48,50 m²   … 4 shots …

5. Deliverables, Format, Timeline
   5.1 Dateiformate je Shot
   5.2 Datei-Benennung  → MARX12_[WE]_[SHOT]_[RAUM]_[VERSION].[ext]
   5.3 Review-Meilensteine  ← TABLE
   5.4 Quellunterlagen
   5.5 Rechte
6. Sign-off  ← TABLE (Rolle | Name | Datum)
```

### 1.2 The per-shot table — the load-bearing structure

Each shot is a heading + a **2-column table** (`Spec | Vorgabe`) with **exactly 6 rows**, in fixed order:

| Row label (verbatim) | Content |
|---|---|
| **Kamera & Komposition** | Standpoint, focal length (`~35 mm äquivalent`), perspective (`Zwei-Punkt-Perspektive`), eye height (`Augenhöhe 1,40 m`), framing notes |
| **Licht** | Time-of-day + colour temperature (`Späte Nachmittagssonne` / `5000–5500 K`), shadow behaviour |
| **Architektur-Fokus** | What the frame must show — materials, proportions, details (the substantive creative direction) |
| **Küchen-Markierung** | Per-shot relevance of the kitchen-marking spec, or `Nicht relevant` |
| **Möblierung** | Furnishing instruction — almost always `Komplett leer` |
| **Format** | `Querformat 3:2` (landscape) or `Hochformat 2:3` (portrait) |

Shot heading syntax: `Shot <N> — <Room name> (<area> m²)[ — <tag>]` where `<tag>` is e.g. `Hauptraum` (hero/main room).

Unit heading syntax: `WE <id> — <area> m²`, followed by a descriptor line (`3-Zimmer + Ankleide`) and `Shot-Liste — <N> Renderings`.

### 1.3 Mandatory vs optional (as the pipeline consumes it)

**Effectively mandatory** (without these, the pipeline produces nothing or near-nothing):
- At least one **unit heading** + at least one **shot** under it. (Zero shots → `EmptyBriefSpecError`, hard stop.)
- Per shot: a **room name** in the heading (becomes the prompt's subject).

**Optional but high-value** (each maps to a free-text prompt fragment — omitted = fragment dropped, never invented):
- Unit `area`, descriptor line; shot `area`, `Format`, `Licht`, `Kamera & Komposition`, `Architektur-Fokus`.
- The whole metadata table + sections 1–4 → feed the project-wide **baseline**.

**Ignored by the pipeline** (no schema field exists for them):
- `Küchen-Markierung` and `Möblierung` rows — **there is no `ShotSpec` field for these.** They survive only if the LLM folds them into `materialNotes`, or if the same instruction also appears in a baseline section (which is why "unmöbliert" worked for Marx12 — it's *also* in §2.3).
- Sections 5 (deliverables/timeline) and 6 (sign-off) — not rendered, not used for image gen.

---

## Section 2 — Brief-to-Renders pipeline walk-through

Four stages. Files under `src/features/brief-renders/services/brief-pipeline/`.

### 2.1 Stage 1 — Spec Extract (`stage-1-spec-extract.ts`)

1. SSRF-guards the brief URL → downloads (50 MB cap) → classifies PDF vs DOCX by **magic bytes** (`%PDF-` / `PK\x03\x04`).
2. Text: PDF → `extractPdfText`; DOCX → `extractDocxText` (mammoth, **HTML preferred** — preserves table structure).
3. `extractEmbeddedImages(buffer, mime)` → `uploadReferenceImages(...)` → reference images on R2.
4. Calls **Claude Sonnet 4.6** with a forced `tool_use` (`submit_brief_spec`), system prompt = `BRIEF_SPEC_EXTRACTOR_SYSTEM_PROMPT`.
5. Validates the tool payload against `BriefSpecSchema` (Zod, `.strict()`).
6. Returns `{ spec, referenceImages, pageCount, costUsd, tokensIn, tokensOut }`.

**The validation schema** (`schemas.ts` / `types.ts`):

```
BriefSpec {
  projectTitle:     string | null
  projectLocation:  string | null
  projectType:      string | null
  baseline: BaselineSpec {
    visualStyle, materialPalette, lightingBaseline,
    cameraBaseline, qualityTarget, additionalNotes   ← all string | null
  }
  apartments: ApartmentSpec[] {
    label, labelDe:    string | null
    totalAreaSqm:      number | null
    bedrooms:          number | null      ← nullable — safe to leave null
    bathrooms:         number | null      ← nullable — safe to leave null
    description:       string | null
    shots: ShotSpec[] {
      shotIndex:           number | null
      roomNameEn, roomNameDe: string | null
      areaSqm:             number | null
      aspectRatio:         string | null   ← "3:2" | "2:3" | "1:1" | "16:9" | "9:16"
      lightingDescription: string | null
      cameraDescription:   string | null
      materialNotes:       string | null
      isHero:              boolean (defaults false)
    }
  }
  referenceImageUrls: string[]            ← Claude told to leave []
}
```

Key schema facts:
- **Every leaf is `.nullable()`.** Nothing is structurally required except the arrays themselves.
- **`.strict()` on every object** → it rejects *invented keys*, not unusual *values*. There is **no room-type enum, no `isResidential` flag, no validation that the content is an apartment.** `bedrooms`/`bathrooms` are nullable and ignorable.
- The schema is *named* residential but is *structurally* a generic `project → units → shots` tree.

### 2.2 The "never invent" contract — where it is enforced

`prompts/spec-extractor.ts` — `BRIEF_SPEC_EXTRACTOR_SYSTEM_PROMPT`, five named rules (asserted by tests):

1. **STRICT FAITHFULNESS** — *"If the source does not state a value … you MUST set it to `null`. NEVER infer, interpolate, default, or invent."*
2. **STRUCTURE-PRESERVING** — *"If 3 apartments are listed, return exactly 3 ApartmentSpecs … If apartment WE 01bb has 4 shots … return exactly 4 ShotSpecs."*
3. **NO HALLUCINATED IDENTIFIERS** — no invented names/areas/filenames.
4. **BILINGUAL HANDLING** — populate `roomNameEn`/`roomNameDe` (and `label`/`labelDe`) per language present.
5. **TOOL OUTPUT ONLY** — respond only via the tool.

**What it rejects:** invented values (via the prompt) and invented *keys* / wrong types (via Zod `.strict()`). **What it does NOT reject:** a non-residential brief. The contract is a *faithfulness* gate, not a *domain* gate. Crucially — **a brief that states every field explicitly has nothing to "invent," so strict faithfulness becomes an asset, not an obstacle.**

### 2.3 Stage 2 — Prompt Gen (`stage-2-prompt-gen.ts` + `prompts/image-prompt-template.ts`)

Pure, deterministic, no LLM. Walks `apartments[].shots[]`, calls `buildImagePrompt()` per shot. Throws `EmptyBriefSpecError` if **zero shots total**.

**`buildImagePrompt()` — verbatim assembly logic** (`prompts/image-prompt-template.ts`):

The prompt is a fixed-order sentence list; `null` fields are silently skipped:

```
 1. "Photorealistic interior render of {roomNameEn || 'interior space'}."   ← HARD-CODED prefix, ALWAYS first
 2. "Apartment: {apartment.label}."                  (if label present)
 3. "{apartment.description}"                         (verbatim, if present)
 4. "Total apartment area {totalAreaSqm} m²."         (if present)
 5. "Shot area {areaSqm} m²."                         (if present)
 6. "Lighting: {shot.lightingDescription}."           (if present)
 7. "Camera: {shot.cameraDescription}."               (if present)
 8. "Materials: {shot.materialNotes}."                (if present)
 9. "Baseline: {non-null baseline fields, comma-joined}."   (if any present)
10. "Hero shot of the apartment."                     (if isHero === true)
11. "Editorial photography style, magazine-quality, professional architectural visualization."   ← HARD-CODED closer, ALWAYS last
```

**Every hard-coded phrase** in the template:
- `"Photorealistic interior render of "` — fixed prefix
- `"interior space"` — fallback room label
- `"Apartment: "`, `"Total apartment area "` — labels (fire only if those fields are populated)
- `"Shot area "`, `"Lighting: "`, `"Camera: "`, `"Materials: "`, `"Baseline: "` — value labels
- `"Hero shot of the apartment."` — fires only if `isHero === true`
- `"Editorial photography style, magazine-quality, professional architectural visualization."` — fixed closer

**Rigidity verdict:** the scaffolding is **two thin hard-coded sentences (≈15 words) bracketing 100% source-derived content.** Sentences 2–10 are *entirely* fed from the brief's free-text fields. The only genuinely domain-leaning tokens are the word **"interior"** in sentence 1 and the literal **"apartment"** in sentences 2/4/10 — and 2/4/10 only fire when those fields are populated, and they merely *label* whatever value you put there. **It is NOT hard-locked to apartment interiors.** `aspectRatio` falls back to `3:2` when null (structural default).

### 2.4 Stage 3 — Image Gen (`stage-3-image-gen.ts` + `providers/gpt-image.ts`)

Per-shot worker. Renders one shot, Redis-mutexed. Calls `generateShotImage()`:
- Model `gpt-image-1.5`, `quality: "high"`, sizes `1536x1024` / `1024x1536` / `1024x1024`.
- **If `referenceImageUrls.length > 0`** → `images.edit()` with `input_fidelity: "high"` (anchors the render on the reference photos).
- **Else** → `images.generate()` (text-only).

`stage-3-image-gen.ts:219-220` sources those URLs:
```ts
const referenceImageUrls =
  ((fresh.specResult as BriefSpec | null)?.referenceImageUrls ?? []);
```

### 2.5 ⚠️ MATERIAL FINDING — the reference-image wire is disconnected

The reference-image path is **built end-to-end but never connected**:

| Step | Status |
|---|---|
| `extractEmbeddedImages()` pulls raster images from the brief DOCX/PDF | ✅ works (DOCX: **all** embedded images, no size filter; PDF: only ≥200 px) |
| `uploadReferenceImages()` uploads them to R2, returns `ReferenceImage[]` | ✅ works |
| `runStage1SpecExtract` returns `{ spec, referenceImages }` as **separate** fields | ✅ |
| Orchestrator persists the spec: `specResult: stage1.spec` (`orchestrator.ts:207`) | ❌ **drops `stage1.referenceImages` on the floor** |
| Claude was told to leave `spec.referenceImageUrls = []` | → it stays `[]` **forever** |
| Stage 3 reads `specResult.referenceImageUrls` → always `[]` | → **always takes the `images.generate()` branch** |

`grep -rn "referenceImageUrls" src/features/brief-renders/` confirms: **nothing ever writes** `referenceImages[].r2Url` into `spec.referenceImageUrls`. The `images.edit()` + `input_fidelity:"high"` path in `generateShotImage` is **dead code in practice.** Reference photos embedded in the brief are extracted, uploaded (R2 cost spent), then never reach the image model.

### 2.6 Stage 4 — PDF Compile (`stage-4-pdf-compile.ts` + `pdf-layout/*`)

jsPDF, A4 portrait. Cover page + one page per shot + chrome on every page.

**Cover page** (`pdf-layout/cover.ts`) — top to bottom:
- Top strip: `"Confidential — for client review"` (`page-chrome.ts` `DEFAULT_CONFIDENTIALITY_TEXT`)
- Centered masthead: `projectTitle` (split at first comma), subtitle = `projectLocation · projectType`
- Section header — **verbatim** (`labels.ts`): `` `${numberToWord(N)} PHOTOREALISTIC INTERIOR RENDERINGS` `` → e.g. `"TWELVE PHOTOREALISTIC INTERIOR RENDERINGS"`
- Body paragraph: first ≤220 chars of `baseline.additionalNotes`
- **Apartment summary table** — headers verbatim: `APARTMENT | LAYOUT | AREA | PERSONA | SHOTS`. `LAYOUT` cell = `"{bedrooms}BR/{bathrooms}BA"` (empty if both null). `PERSONA` cell = `apartment.description`.
- **Baseline block** — header verbatim: `` `BASELINE — APPLIED TO ALL ${numberToWord(N)} RENDERINGS` ``; body = baseline leaves as `"Visual style — … Material palette — … Lighting — … Camera — … Quality — …"`

**Per-shot page** (`pdf-layout/per-shot-page.ts`) — top to bottom:
- Row 1: `apartment.label` (bold) | gold **`HERO SHOT`** badge (drawn when `shotIndexInApartment === 0` — i.e. the **first shot of each unit always gets the badge**, independent of the `isHero` field)
- Row 2: `"{first sentence of description} • {area} m² • {persona}"` | right: `` `Shot ${n} of ${m}` ``
- Shot title: `roomNameEn` (bold, large); subtitle: `roomNameDe` (italic)
- **`VISUAL NOTES`** paragraph (verbatim label) = `materialNotes` + `cameraDescription`, em-dash joined, capped 4 lines
- Full-width image (height from `aspectRatio`)
- 3-column metadata, verbatim labels: `ROOM AREA | ASPECT | LIGHTING`
- Filename block, verbatim label: `"FILENAME (PER BRIEF §3.2)"`; value auto-composed `{label}_{S#}_{RoomName}` (e.g. `MARX12_WE01bb_S1_KitchenDining`)

**Footer on every page** (`page-chrome.ts` + `labels.ts`) — verbatim:
- Left: `"Confidential — for client review"`
- Centre: `` `Page ${n} of ${N}` `` (backfilled in a 2nd pass)
- Right: `` `v${version} — M3 Full Draft` `` (e.g. `"v01 — M3 Full Draft"`)

**Note:** the cover always says **"PHOTOREALISTIC INTERIOR RENDERINGS"** and the filename label always says **"PER BRIEF §3.2"** — these chrome strings are hard-coded and *not* sourced from the brief.

---

## Section 3 — Feasibility answers

### (a) Can the parser accept booth zones as "units" and booth views as "rooms"?

**YES.** The schema is *structurally* a generic `project → units → shots` tree:
- `apartments[]` ← booth zones. `label` = zone name, `totalAreaSqm` = zone m², `description` = zone context. `bedrooms`/`bathrooms` are nullable → leave null.
- `shots[]` ← booth views. `roomNameEn` = view name, `areaSqm`, `aspectRatio`, `lightingDescription`, `cameraDescription`, `materialNotes`, `isHero`.
- `.strict()` rejects invented *keys*, never unusual *values*. There is **no residential validation, no room-type enum.** The spec-extractor prompt even says *"one entry per apartment / **unit**"*.

**Caveat:** the spec-extractor system prompt is *framed* around "architectural brief / apartment summaries / room schedules." This is guidance, not a gate — Sonnet 4.6 will map a structurally-identical booth brief — but the brief must be authored in the exact `unit → shot → 6-row table` shape from §1.2, and every field stated explicitly (strict faithfulness means silence → `null`, not a guess).

### (b) Will the hard-coded scaffolding produce booth-looking or apartment-looking renders?

**Mostly booth-looking — conditional on authoring.** The scaffolding is two thin sentences around 100% source-derived content (§2.3). Risk factors and mitigations:
- `"Photorealistic interior render of {roomNameEn}"` — set `roomNameEn` to something explicit like *"SOL exhibition stand — hero entrance view, full 15×15 m island booth"* and the prefix works *for* you. The word "interior" is mild — exhibition stands are shot as interiors.
- `"Apartment: {label}"`, `"Total apartment area …"`, `"Hero shot of the apartment."` — the literal word "apartment" leaks in. It's a cosmetic wart in the prompt text, not a render-breaker (the *values* dominate the model's interpretation), but it is a real residual bias.
- **The real lever is `materialNotes` + `cameraDescription` + `description` + `baseline.*`** — pack these with dominant, explicit booth language (materials, floor-supported structures, 4.5 m limit, Marriott-tier tone) and a ~300-word source-derived body easily out-weighs ~15 hard-coded words.

**Verdict: workable, but text-only authoring leaves the "interior/apartment" wording in the prompt.** Acceptable; not ideal.

### (c) Can we override the scaffolding via brief content WITHOUT modifying pipeline code?

**YES.** `roomNameEn`, `materialNotes`, `cameraDescription`, `lightingDescription`, `apartment.description`, and all six `baseline.*` fields are source-derived free text with **no length cap** (`image-prompt-template.ts` removed the cap — see `PROMPT_LENGTH_OBSERVABILITY_THRESHOLD`, informational only). A richly-authored brief produces a prompt body that dominates the two hard-coded sentences. No code change needed to *override* — the scaffolding is already content-driven.

### (d) Can we feed reference images (luxury exhibition-stand photos)?

**Partially — the capability exists but is DISCONNECTED (see §2.5).**
- The *mechanism* to get reference images in is: **embed them directly inside the brief DOCX** (DOCX path captures *all* embedded images, no size filter; there is **no separate user-facing reference-image upload** — `grep` of components/routes confirms none).
- They get extracted → uploaded to R2 → returned as `stage1.referenceImages`.
- **But the orchestrator never writes them into `spec.referenceImageUrls`** (`orchestrator.ts:207` persists `stage1.spec` only). So Stage 3 always sees `[]` and always uses `images.generate()` — **`images.edit()` with `input_fidelity:"high"` never fires.**
- **As-is: NO, reference images do not anchor the renders.** With a **1-line orchestrator fix** (merge `stage1.referenceImages.map(r => r.r2Url)` into the persisted `specResult.referenceImageUrls`): **YES**, fully — and that fix benefits every brief, not just SOL.

### (e) Minimum change required if (a)/(b) reject SOL?

(a) and (b) **do not reject** SOL — the parser accepts the structure and the scaffolding is overridable. So **no code change is strictly required to get booth renders.** However, the audit surfaced two *small, single-file, low-risk* changes worth making:

1. **Reference-image wire (1 line, `orchestrator.ts` ~line 207)** — merge `stage1.referenceImages` into `spec.referenceImageUrls` before persisting. Fixes the disconnected `images.edit()` path (§2.5). This is a genuine latent bug, not a SOL-specific hack — it unlocks photo-anchored renders for *all* briefs.
2. *(Optional)* **Configurable prompt lead-in (~3 lines, `image-prompt-template.ts`)** — make the `"Photorealistic interior render of"` prefix read from `baseline.visualStyle` (already a field) instead of being hard-coded, so the literal word "interior" isn't forced. No schema change needed. Only worth it if a first render pass shows residual apartment bias.

No new "exhibition mode" flag and no schema extension are needed — the schema is already generic enough.

---

## Section 4 — Recommended path

### ✅ Recommended: **PATH B** — reformat the SOL brief **+** the 1-line reference-image wire fix

**Reasoning:**

1. **PATH A genuinely works for structure** — reformatting the SOL brief into the §1.2 `unit → shot → 6-row table` shape makes the parser produce a valid multi-shot `BriefSpec`, and the prompt scaffolding (§2.3) is thin enough that rich `materialNotes`/`description`/`baseline` content drives booth-looking renders. If the goal were "zero code changes, ship today," PATH A is a legitimate fallback — it would produce booth renders, **text-only**.

2. **But the whole SOL objective is luxury-aesthetic anchoring** (Marriott/Fairmont tone, walnut/travertine/bronze, floor-supported structures). The single strongest lever for that — reference-image anchoring via `images.edit()` + `input_fidelity:"high"` — is **built but disconnected** (§2.5). Shipping PATH A means shipping text-only renders with the aesthetic lever dead in the box.

3. The fix is **one line in one file** (`orchestrator.ts`), it carries near-zero risk, and it is **a real latent bug fix that benefits every brief** — not a SOL-specific kludge. That makes PATH B barely more work than PATH A while removing the biggest quality risk.

4. PATH C (concierge script) stays the right call *only if* you want fully manual prompt control or can't touch pipeline code at all. But Brief-to-Renders gives you the editorial multi-page PDF deliverable for free — which is exactly the format SOL would expect — so falling back to the concierge script throws away real infrastructure.

**PATH B execution outline (for a later, separate work item — not done here):**
- **Reformat** the SOL brief into a Marxstraße-shaped DOCX: title/scope lines → metadata table → §1–4 style/baseline sections (global booth rules: 4.5 m limit, floor-supported branding, luxury-developer tone, the walnut/travertine/bronze palette) → 3–4 **"WE" = booth zones**, each with 2–4 **shots** = booth views, each shot a 6-row table (Camera, Light, **Architektur-Fokus = the booth visual direction**, Format, etc.). Name `roomNameEn` explicitly ("hero entrance view", "models hall", "reception + coffee", "Fairmont feature").
- **Embed 2–4 luxury exhibition-stand reference photos** directly into the DOCX (DOCX path captures all of them).
- **Apply the 1-line `orchestrator.ts` wire fix** so those embedded photos actually reach `images.edit()`.
- *(Hold the optional `image-prompt-template.ts` lead-in tweak in reserve — only apply if a first pass shows apartment bias.)*
- Run the pipeline; the AWAITING_APPROVAL gate lets you review the extracted spec before any image spend.

**Cosmetic residue to accept either way:** the PDF cover will say "PHOTOREALISTIC INTERIOR RENDERINGS" and the filename label will say "PER BRIEF §3.2" — hard-coded chrome strings, not brief-sourced. Minor; not worth a code change for a single concierge deliverable.

---

*Audit complete. Read-only. No files under `src/`, `prisma/`, `tests/`, `public/`, or `.env*` were modified.*
