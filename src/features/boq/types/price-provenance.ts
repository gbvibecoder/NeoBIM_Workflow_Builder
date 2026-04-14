// ─── Price Provenance Types ──────────────────────────────────────────────────
// Every BOQ line item should be traceable back to its pricing source.
// This type system enables transparent, auditable cost estimates.

/**
 * How a price was obtained — ordered by trust level.
 */
export type PriceMethod =
  | "LIVE_WEB_SEARCH"     // Claude Haiku real-time web search (highest trust)
  | "DEALER_PORTAL"       // Direct from dealer/supplier website
  | "PWD_TENDER"          // State PWD Schedule of Rates (official)
  | "MATERIAL_CACHE"      // From MaterialPriceCache (prior fetch for this city)
  | "STATE_INTERPOLATED"  // Same state, different city — tier-adjusted
  | "NATIONAL_AVERAGE"    // Trimmed mean of all cached cities
  | "CPWD_STATIC"         // Hardcoded CPWD DSR 2025-26 rates
  | "USER_CORRECTION"     // QS professional override
  | "ESCALATED"           // Aged price + inflation escalation applied
  | "FALLBACK_ESTIMATE";  // Last resort, low confidence

/**
 * Freshness classification for cached prices.
 */
export type FreshnessLabel = "fresh" | "recent" | "stale" | "very_stale";

/**
 * Full provenance record for a single price data point.
 * Attached to each BOQ line item and market intelligence result.
 */
export interface PriceProvenance {
  /** How this price was obtained */
  method: PriceMethod;

  /** Human-readable source description (e.g., "SAIL TMT Tiscon dealer — Mumbai") */
  sourceDescription: string;

  /** URL where the price was found (if web search or portal) */
  sourceUrl?: string;

  /** When this price was originally fetched */
  fetchedAt: Date;

  /** How old is this data in days */
  dataAgeDays: number;

  /** Freshness classification */
  freshness: FreshnessLabel;

  /** Whether auto-escalation was applied to an aged price */
  escalationApplied: boolean;

  /** Escalation percentage applied (e.g., 3.2 means +3.2%) */
  escalationPercent?: number;

  /** The original price before escalation */
  originalPrice?: number;

  /** Confidence multiplier after freshness decay (0.40–1.00) */
  confidenceMultiplier: number;

  /** Priority level in the fallback chain (1 = best, 6 = worst) */
  fallbackLevel: 1 | 2 | 3 | 4 | 5 | 6;

  /** Human-readable note about this price point */
  note?: string;
}

// BOQProvenanceSummary and MaterialPriceCacheRecord removed — were only used
// by the deleted market-data-collector.ts. Re-add when collector is rebuilt.
