/**
 * Reference floor plan library — 30+ architect-designed Indian residential
 * plans with normalized (0-1) coordinates for universal scaling.
 *
 * Coverage: 1-5 BHK × 4 facings × multiple plot sizes/styles.
 * Each plan encodes real architectural knowledge: zoning, adjacency,
 * proportions, flow, and privacy gradients.
 */
import type { ReferenceFloorPlan } from "@/features/floor-plan/lib/reference-types";
import { PLANS_1BHK } from "./1bhk-plans";
import { PLANS_2BHK } from "./2bhk-plans";
import { PLANS_3BHK } from "./3bhk-plans";
import { PLANS_4BHK } from "./4bhk-plans";
import { PLANS_5BHK } from "./5bhk-plans";

export const REFERENCE_LIBRARY: ReferenceFloorPlan[] = [
  ...PLANS_1BHK,
  ...PLANS_2BHK,
  ...PLANS_3BHK,
  ...PLANS_4BHK,
  ...PLANS_5BHK,
];

/** Quick index: how many plans per BHK type. */
export const LIBRARY_STATS = {
  total: REFERENCE_LIBRARY.length,
  byBHK: {
    1: PLANS_1BHK.length,
    2: PLANS_2BHK.length,
    3: PLANS_3BHK.length,
    4: PLANS_4BHK.length,
    5: PLANS_5BHK.length,
  },
} as const;
