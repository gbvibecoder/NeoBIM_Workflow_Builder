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

/**
 * Summary provenance for an entire BOQ (not per-line).
 * Aggregates across all line items to give overall picture.
 */
export interface BOQProvenanceSummary {
  /** Overall pricing source category */
  primarySource: "market_intelligence" | "cpwd_static" | "mixed";

  /** Market intelligence agent status */
  marketIntelligenceStatus: "success" | "partial" | "failed" | "timeout" | "skipped";

  /** Number of line items by method */
  methodBreakdown: Partial<Record<PriceMethod, number>>;

  /** Average confidence across all line items */
  averageConfidence: number;

  /** Freshness breakdown */
  freshnessBreakdown: Record<FreshnessLabel, number>;

  /** Oldest price data point (worst case) */
  oldestDataAgeDays: number;

  /** Most recent price data point (best case) */
  newestDataAgeDays: number;

  /** Static rate version used as fallback */
  staticRateVersion: string;

  /** Warning if prices are stale */
  staleDateWarning?: string;

  /** City and state used for pricing */
  cityUsed?: string;
  stateUsed?: string;

  /** Last time market data was refreshed for this city */
  lastMarketUpdate?: string;
}

/**
 * Enhanced MaterialPriceCache record with provenance fields.
 * Maps to the Prisma model + new fields from migration.
 */
export interface MaterialPriceCacheRecord {
  id: string;
  city: string;
  state: string;
  materialCode: string;
  price: number;
  unit: string;
  source: string;
  confidence: string;
  fetchedAt: Date;
  expiresAt: Date;

  // New provenance fields (from Sprint 1 migration)
  sourceUrl?: string | null;
  rawResponse?: Record<string, unknown> | null;
  confidenceScore?: number | null;
  method?: PriceMethod | null;
}
