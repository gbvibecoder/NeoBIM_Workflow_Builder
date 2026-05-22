/**
 * scripts/lib/dincel-categorize.ts
 *
 * Filename → KosDocType categoriser for the Dincel "Package C" builder
 * compliance pack. Pure, no I/O — safe to unit-test or call from the
 * bulk-ingest dry-run.
 *
 * WHY PAC for certificates/test-reports: in this KOS deployment "PAC"
 * is the compliance / accreditation bucket (the system prompt's worked
 * example is `"show me the BMTPC certificate" → docTypes=["PAC"]`).
 * The CERTIFICATE enum value exists but is not what the bot filters on
 * for compliance lookups, so the spec deliberately routes CodeMark /
 * UTS / structural certificates to PAC, not CERTIFICATE.
 *
 * MATCH SEMANTICS: case-insensitive substring, first rule wins. The
 * rule order below is deliberate — the distinctive multi-word
 * CASE_STUDY phrases are checked BEFORE the broad/short PAC codes
 * (`asc`, `fas`, `fco`, `scc`, `voc`) so a short code can never
 * pre-empt a more meaningful classification. Validated against the
 * 26-file Package C batch (see kos_dincel_ingestion_report.md):
 *   PAC = 20, CASE_STUDY = 6, OTHER = 0.
 *
 * The short codes are intentionally permissive per the spec. They are
 * safe for THIS batch; a future drop-in that happens to contain "fas"
 * or "scc" as an incidental substring would be mis-binned — re-validate
 * the breakdown whenever the source pack changes.
 */

import type { KosDocType } from "@prisma/client";

export interface DincelCategory {
  docType: KosDocType;
  /** Provenance tag. Constant for this pack — used by the bulk-ingest
   *  script for the title prefix, logging, and the run summary. */
  source: "dincel";
}

interface CategoryRule {
  docType: KosDocType;
  /** Lower-cased substrings; any match assigns this rule's docType. */
  patterns: string[];
}

/**
 * Ordered rule table. First matching rule wins. See the file header
 * for why CASE_STUDY phrases precede the broad PAC short codes.
 */
const RULES: CategoryRule[] = [
  // ── CASE_STUDY (peer reviews, NCC reports, independent testing) ──
  {
    docType: "CASE_STUDY",
    patterns: [
      "elsevier_-_peer_review",
      "wiley_-_peer_review",
      "peer_review",
      "uts_testing",
      "report-to-ncc",
      "fabric-first",
      "better-building",
    ],
  },
  // ── PAC — distinctive multi-word / unambiguous patterns ──────────
  {
    docType: "PAC",
    patterns: [
      "codemark",
      "self_compacting_concrete",
      "unsw-dincel-structural",
      "best_environmental_practice",
      "bep-pvc",
      "fire_compliance",
      "fire_compliant",
      "report_by_grove",
      "uts_certificate",
      "as_3600",
      "eurocode",
      "acoustic",
      "earthquake",
      "structural",
      "certification",
      "certificate",
      "_certificate",
    ],
  },
  // ── PAC — broad / short codes (checked last; permissive by spec) ─
  {
    docType: "PAC",
    patterns: [
      "voc",
      "scc",
      "asc",
      "fas",
      "fco",
      "cv071106",
      "7147101",
      "7191127",
    ],
  },
];

/**
 * Categorise a Dincel Package C filename.
 *
 * @param filename Bare filename (with or without extension/path).
 * @returns `{ docType, source: "dincel" }`. Unmatched → docType OTHER.
 */
export function categorizeDincelDoc(filename: string): DincelCategory {
  const haystack = filename.toLowerCase();
  for (const rule of RULES) {
    if (rule.patterns.some((p) => haystack.includes(p))) {
      return { docType: rule.docType, source: "dincel" };
    }
  }
  return { docType: "OTHER", source: "dincel" };
}
