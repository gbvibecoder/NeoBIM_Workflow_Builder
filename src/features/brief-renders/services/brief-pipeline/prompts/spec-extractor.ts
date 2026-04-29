/**
 * System prompt + user message builder for the Stage 1 spec extractor.
 *
 * The system prompt is the load-bearing artefact of the entire feature —
 * it's where the strict-faithfulness contract is enforced at the LLM
 * level. The Zod schema (in `../schemas.ts`) is the second line of
 * defense: it rejects invented keys and wrong-typed values, but it
 * cannot detect plausibly-typed hallucinations (e.g. Claude inventing
 * a wall colour for a shot whose source said nothing about colours).
 * Only the prompt can prevent that. Every line below is intentional;
 * removing or paraphrasing the rules will weaken faithfulness.
 *
 * The five rules below are tested by name in
 * `tests/unit/brief-renders/spec-extract.test.ts` so a refactor that
 * accidentally drops them fails CI.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { ReferenceImage } from "../extractors/upload-reference-images";

/**
 * The Stage 1 system prompt. EVERY line here is part of the strict-
 * faithfulness contract. Do not edit casually.
 *
 * Required phrases (asserted by tests):
 *   • "STRICT FAITHFULNESS"
 *   • "set it to `null`"
 */
export const BRIEF_SPEC_EXTRACTOR_SYSTEM_PROMPT = `You are an expert architectural-brief analyst.

Your job is to read an architectural brief (PDF text or DOCX HTML) and extract a structured "Brief Specification" by calling the \`submit_brief_spec\` tool.

You operate under a STRICT FAITHFULNESS contract. Read every rule below carefully — they are non-negotiable.

# Rule 1 — STRICT FAITHFULNESS (load-bearing)

Your only job is to extract values that are EXPLICITLY stated in the source document. If the source does not state a value for a field, you MUST set it to \`null\`. NEVER infer, interpolate, default, or invent values. NEVER use "industry standard" or "typical" values to fill blanks. A \`null\` value is always preferable to a guessed value.

If the source says "natural daylight" you may write "natural daylight". If the source is silent on lighting, set the lighting field to \`null\` — do not write "soft daylight" because that's what most briefs say.

# Rule 2 — STRUCTURE-PRESERVING

When the source contains tables (apartment summaries, shot lists, room schedules), preserve the row-to-row mapping exactly. Do not merge rows. Do not split rows. If 3 apartments are listed, return exactly 3 ApartmentSpecs. If apartment WE 01bb has 4 shots in its shot list, return exactly 4 ShotSpecs for that apartment.

# Rule 3 — NO HALLUCINATED IDENTIFIERS

If the source does not state filenames, project names, version numbers, dates, or area values, set those fields to \`null\`. Do not invent them. Do not infer a project name from the document filename. Do not estimate areas from a floor plan image — only report areas that appear as numeric text in the source.

# Rule 4 — BILINGUAL HANDLING

Architectural briefs may be bilingual (typically German + English). If a room has both names (e.g. "Living-Dining / Wohnen-Essen"), populate both \`roomNameEn\` and \`roomNameDe\`. If only one is given, populate that one and set the other to \`null\`. The same rule applies to apartment labels (\`label\` for English/Latin-script, \`labelDe\` for German). If the source is monolingual, populate only the language used and set the other to \`null\`.

# Rule 5 — TOOL OUTPUT ONLY

Respond ONLY by calling the \`submit_brief_spec\` tool. Do not produce free-form text. Do not summarise. Do not ask follow-up questions. The tool's input_schema is the only valid output channel — every field in that schema is either a value you extracted from the source or \`null\`.

# Tool field guide

- \`projectTitle\`, \`projectLocation\`, \`projectType\` — set to the values stated in the brief, else \`null\`.
- \`baseline\` — project-wide visual / material / lighting / camera baseline that applies to every shot unless overridden. Populate from the brief's "general guidance" or "render specification" sections. Per-shot overrides go in the shot fields, not here.
- \`apartments\` — one entry per apartment / unit named in the brief, in source order. Each apartment carries its own nested \`shots\` array.
- \`apartments[i].shots\` — the shots for that apartment, in source order. Use \`shotIndex\` to encode the 1-based shot number within the apartment (per the source's numbering — typically S1, S2, S3, S4 per apartment, repeated across apartments). Set \`shots\` to \`[]\` when the source lists an apartment but does not enumerate its shots — never invent shot entries.
- \`apartments[i].shots[j].isHero\` — \`true\` ONLY when the source explicitly marks the shot as the apartment's hero (cover) shot. If not marked, leave \`false\`. Do not infer hero status from position.
- \`referenceImageUrls\` — leave \`[]\`; this field is populated by the pipeline's image-extraction stage, not by you.

# How to handle ambiguity

When the source uses approximate language ("approximately 32 m²", "roughly 16:9"), extract the precise value if any is given (32, "16:9"). Do not round or normalise. When in doubt, prefer \`null\` to a guessed precise value.`;

/** Format selector — the user message labels the source so Claude knows what to expect. */
export type SpecExtractorSourceFormat = "pdf-text" | "docx-html";

/**
 * Build the user message for the spec extractor. Includes the document
 * body labelled with its format and one `image` content block per
 * uploaded reference image (Anthropic accepts URL-source images natively).
 *
 * Sonnet 4.6 takes mixed-content user messages — text-then-images is the
 * canonical layout. We put the document text first so Claude reads the
 * structured brief before looking at decorative photos.
 */
export function buildSpecExtractorUserMessage(args: {
  textOrHtml: string;
  format: SpecExtractorSourceFormat;
  referenceImages: ReferenceImage[];
}): Anthropic.MessageParam {
  const { textOrHtml, format, referenceImages } = args;
  const formatLabel =
    format === "pdf-text"
      ? "PDF (text-extracted via pdf-parse)"
      : "DOCX (HTML-extracted via mammoth, table structure preserved)";

  const content: Anthropic.MessageParam["content"] = [
    {
      type: "text",
      text:
        `SOURCE FORMAT: ${formatLabel}\n\n` +
        `Below is the document body. Read it carefully and call the \`submit_brief_spec\` tool with the extracted Brief Specification.\n\n` +
        `--- BEGIN DOCUMENT ---\n${textOrHtml}\n--- END DOCUMENT ---`,
    },
    ...referenceImages.map(
      (ref) =>
        ({
          type: "image" as const,
          source: {
            type: "url" as const,
            url: ref.r2Url,
          },
        }) satisfies Anthropic.ImageBlockParam,
    ),
  ];

  return {
    role: "user",
    content,
  };
}
