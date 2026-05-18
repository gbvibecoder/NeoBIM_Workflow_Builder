/**
 * Archetype detector — maps a BriefSpec's `archetype` field to the
 * deterministic builder that should handle it.
 *
 * Phase G ships the `office` archetype only. Other archetypes throw
 * `ArchetypeNotSupportedError` and the caller falls back to the
 * agent loop.
 */

import type { BriefSpec } from "./types";

export class ArchetypeNotSupportedError extends Error {
  public readonly archetype: string;
  constructor(archetype: string) {
    super(
      `Deterministic builder not available for archetype "${archetype}". ` +
      `Supported: office. Falling back to agent loop.`,
    );
    this.name = "ArchetypeNotSupportedError";
    this.archetype = archetype;
  }
}

export type BuilderKind = "office";

const SUPPORTED_ARCHETYPES = new Set<string>(["office"]);

/**
 * Determine which deterministic builder to invoke for a given BriefSpec.
 *
 * @throws {ArchetypeNotSupportedError} if the archetype has no builder yet
 */
export function detectBuilderKind(brief: BriefSpec): BuilderKind {
  const archetype = brief.archetype ?? "other";
  if (SUPPORTED_ARCHETYPES.has(archetype)) {
    return archetype as BuilderKind;
  }
  throw new ArchetypeNotSupportedError(archetype);
}
