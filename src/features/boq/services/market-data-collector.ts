// ─── Background Market Data Collector ────────────────────────────────────────
// Proactive price fetching for all Indian cities.
//
// CURRENT MODEL (Reactive):
//   User runs BOQ → TR-015 calls Claude Haiku LIVE per city → 3-10s wait
//   → timeout risk → hallucinated prices for tier-3 → inconsistent runs
//
// NEW MODEL (Proactive):
//   Background job (cron) → fetches prices for ALL cities in batches
//   → stores in MaterialPriceCache with source + timestamp + confidence
//   → User runs BOQ → instant DB lookup → shows provenance badge per line
//
// This file is a SERVICE SKELETON. It defines the interface and batch logic.
// The actual cron trigger lives at /api/cron/refresh-prices (already exists).

import { INDIAN_CITIES, type IndianCity } from "@/features/boq/constants/indian-cities";
import type { PriceMethod } from "@/features/boq/types/price-provenance";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CollectorResult {
  city: string;
  state: string;
  materialCode: string;
  price: number;
  unit: string;
  source: string;
  sourceUrl?: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  confidenceScore: number;
  method: PriceMethod;
  fetchedAt: Date;
}

export interface BatchResult {
  city: string;
  state: string;
  materialsCollected: number;
  totalDurationMs: number;
  status: "success" | "partial" | "failed";
  errors: string[];
  results: CollectorResult[];
}

export interface CollectorProgress {
  totalCities: number;
  completed: number;
  failed: number;
  currentCity: string | null;
  startedAt: Date;
  estimatedCompletion: Date | null;
}

// ── Configuration ────────────────────────────────────────────────────────────

/** Materials to collect for each city */
const MATERIAL_CODES = [
  "steel_per_tonne",
  "cement_per_bag",
  "sand_per_cft",
  "aggregate_20mm_per_cft",
  "m_sand_per_cft",
  "labor_mason_per_day",
  "labor_helper_per_day",
  "labor_electrician_per_day",
  "labor_plumber_per_day",
  "labor_carpenter_per_day",
  "benchmark_residential_per_sqm",
  "benchmark_commercial_per_sqm",
] as const;

/** How many cities to process in parallel (avoid rate limits) */
const BATCH_SIZE = 3;

/** Delay between batches in ms (respect API rate limits) */
const BATCH_DELAY_MS = 2000;

/** Maximum age before a city's prices need refresh (in days) */
export const MAX_CACHE_AGE_DAYS = 30;

/** How old before data gets amber warning */
export const STALE_WARNING_DAYS = 30;

/** How old before data gets red warning + heavy escalation */
export const CRITICAL_AGE_DAYS = 90;

// ── Priority ordering ────────────────────────────────────────────────────────
// Metros refresh first (most users), then tier-2, then tier-3.

function getCityRefreshOrder(): IndianCity[] {
  const metros = INDIAN_CITIES.filter(c => c.tier === "metro");
  const tier2 = INDIAN_CITIES.filter(c => c.tier === "tier2");
  const tier3 = INDIAN_CITIES.filter(c => c.tier === "tier3");
  return [...metros, ...tier2, ...tier3];
}

// ── Core collection logic ────────────────────────────────────────────────────

/**
 * Check which cities need refreshing based on cache age.
 * Returns cities whose most recent cache entry is older than MAX_CACHE_AGE_DAYS.
 */
export async function getCitiesNeedingRefresh(
  prisma: { materialPriceCache: { findFirst: (args: unknown) => Promise<{ fetchedAt: Date } | null> } }
): Promise<IndianCity[]> {
  const cities = getCityRefreshOrder();
  const cutoff = new Date(Date.now() - MAX_CACHE_AGE_DAYS * 24 * 60 * 60 * 1000);
  const needsRefresh: IndianCity[] = [];

  for (const city of cities) {
    const latest = await prisma.materialPriceCache.findFirst({
      where: { city: city.name, state: city.state, fetchedAt: { gte: cutoff } },
      orderBy: { fetchedAt: "desc" },
      select: { fetchedAt: true },
    } as unknown);

    if (!latest) {
      needsRefresh.push(city);
    }
  }

  return needsRefresh;
}

/**
 * Collect prices for a single city.
 * This is the core function that TR-015's market intelligence wraps.
 * In the background collector, we call this WITHOUT user-facing timeout pressure.
 *
 * @param city - City data
 * @param fetchFn - The actual price fetching function (injected for testability)
 */
export async function collectCityPrices(
  city: IndianCity,
  fetchFn: (city: string, state: string, materials: readonly string[]) => Promise<CollectorResult[]>,
): Promise<BatchResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let results: CollectorResult[] = [];

  try {
    results = await fetchFn(city.name, city.state, MATERIAL_CODES);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Unknown fetch error");
  }

  const durationMs = Date.now() - startTime;

  return {
    city: city.name,
    state: city.state,
    materialsCollected: results.length,
    totalDurationMs: durationMs,
    status: results.length >= MATERIAL_CODES.length * 0.7
      ? "success"
      : results.length > 0
      ? "partial"
      : "failed",
    errors,
    results,
  };
}

/**
 * Run the full batch collection for all cities needing refresh.
 * Processes in batches of BATCH_SIZE with delays between.
 *
 * @param citiesToRefresh - Cities that need price updates
 * @param fetchFn - Price fetching function
 * @param onProgress - Optional callback for progress tracking
 */
export async function runBatchCollection(
  citiesToRefresh: IndianCity[],
  fetchFn: (city: string, state: string, materials: readonly string[]) => Promise<CollectorResult[]>,
  onProgress?: (progress: CollectorProgress) => void,
): Promise<BatchResult[]> {
  const results: BatchResult[] = [];
  const startedAt = new Date();
  let completed = 0;
  let failed = 0;

  for (let i = 0; i < citiesToRefresh.length; i += BATCH_SIZE) {
    const batch = citiesToRefresh.slice(i, i + BATCH_SIZE);

    // Process batch in parallel
    const batchResults = await Promise.allSettled(
      batch.map(city => collectCityPrices(city, fetchFn))
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
        if (result.value.status === "failed") failed++;
      } else {
        failed++;
        results.push({
          city: batch[results.length % batch.length]?.name ?? "unknown",
          state: batch[results.length % batch.length]?.state ?? "unknown",
          materialsCollected: 0,
          totalDurationMs: 0,
          status: "failed",
          errors: [result.reason?.message ?? "Unknown error"],
          results: [],
        });
      }
      completed++;
    }

    // Report progress
    onProgress?.({
      totalCities: citiesToRefresh.length,
      completed,
      failed,
      currentCity: batch[batch.length - 1]?.name ?? null,
      startedAt,
      estimatedCompletion: completed > 0
        ? new Date(startedAt.getTime() + ((Date.now() - startedAt.getTime()) / completed) * citiesToRefresh.length)
        : null,
    });

    // Rate limit delay between batches
    if (i + BATCH_SIZE < citiesToRefresh.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  return results;
}

/**
 * Persist batch results to MaterialPriceCache.
 *
 * @param results - Collected price data
 * @param prisma - Prisma client instance
 */
export async function persistBatchResults(
  results: BatchResult[],
  prisma: { materialPriceCache: { createMany: (args: unknown) => Promise<{ count: number }> } },
): Promise<{ totalPersisted: number; totalFailed: number }> {
  let totalPersisted = 0;
  let totalFailed = 0;

  for (const batch of results) {
    if (batch.results.length === 0) {
      totalFailed++;
      continue;
    }

    try {
      const expiresAt = new Date(Date.now() + MAX_CACHE_AGE_DAYS * 24 * 60 * 60 * 1000);

      const { count } = await prisma.materialPriceCache.createMany({
        data: batch.results.map(r => ({
          city: r.city,
          state: r.state,
          materialCode: r.materialCode,
          price: r.price,
          unit: r.unit,
          source: r.source,
          confidence: r.confidence,
          fetchedAt: r.fetchedAt,
          expiresAt,
          sourceUrl: r.sourceUrl ?? null,
          confidenceScore: r.confidenceScore,
          method: r.method,
        })),
        skipDuplicates: true,
      } as unknown);

      totalPersisted += count;
    } catch {
      totalFailed++;
    }
  }

  return { totalPersisted, totalFailed };
}
