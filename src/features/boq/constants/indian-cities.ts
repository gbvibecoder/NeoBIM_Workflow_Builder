/**
 * Top 50 Indian cities for batch price cache warming.
 *
 * Used by /api/cron/refresh-prices to pre-populate MaterialPriceCache
 * so users get instant cached prices instead of waiting for live LLM search.
 *
 * Ordered by construction activity volume (metro first, then tier2, tier3).
 * Covers all 28 states + 3 UTs with significant construction markets.
 */

export interface IndianCity {
  name: string;
  state: string;
  tier: "metro" | "tier2" | "tier3";
}

export const INDIAN_CITIES: IndianCity[] = [
  // ── Metro (Tier 1) — 8 cities ──────────────────────────────────────────
  // Highest construction volume, most users, refresh first
  { name: "Mumbai", state: "Maharashtra", tier: "metro" },
  { name: "Delhi", state: "Delhi NCR", tier: "metro" },
  { name: "Bangalore", state: "Karnataka", tier: "metro" },
  { name: "Hyderabad", state: "Telangana", tier: "metro" },
  { name: "Chennai", state: "Tamil Nadu", tier: "metro" },
  { name: "Kolkata", state: "West Bengal", tier: "metro" },
  { name: "Pune", state: "Maharashtra", tier: "metro" },
  { name: "Ahmedabad", state: "Gujarat", tier: "metro" },

  // ── Tier 2 (Major) — 17 cities ─────────────────────────────────────────
  // State capitals and major commercial centers
  { name: "Jaipur", state: "Rajasthan", tier: "tier2" },
  { name: "Lucknow", state: "Uttar Pradesh", tier: "tier2" },
  { name: "Chandigarh", state: "Chandigarh", tier: "tier2" },
  { name: "Indore", state: "Madhya Pradesh", tier: "tier2" },
  { name: "Nagpur", state: "Maharashtra", tier: "tier2" },
  { name: "Bhopal", state: "Madhya Pradesh", tier: "tier2" },
  { name: "Visakhapatnam", state: "Andhra Pradesh", tier: "tier2" },
  { name: "Patna", state: "Bihar", tier: "tier2" },
  { name: "Vadodara", state: "Gujarat", tier: "tier2" },
  { name: "Coimbatore", state: "Tamil Nadu", tier: "tier2" },
  { name: "Kochi", state: "Kerala", tier: "tier2" },
  { name: "Thiruvananthapuram", state: "Kerala", tier: "tier2" },
  { name: "Guwahati", state: "Assam", tier: "tier2" },
  { name: "Bhubaneswar", state: "Odisha", tier: "tier2" },
  { name: "Dehradun", state: "Uttarakhand", tier: "tier2" },
  { name: "Ranchi", state: "Jharkhand", tier: "tier2" },
  { name: "Raipur", state: "Chhattisgarh", tier: "tier2" },

  // ── Tier 3 (Growing) — 25 cities ───────────────────────────────────────
  // Emerging construction markets, state secondaries, industrial hubs
  { name: "Surat", state: "Gujarat", tier: "tier3" },
  { name: "Nashik", state: "Maharashtra", tier: "tier3" },
  { name: "Aurangabad", state: "Maharashtra", tier: "tier3" },
  { name: "Jodhpur", state: "Rajasthan", tier: "tier3" },
  { name: "Udaipur", state: "Rajasthan", tier: "tier3" },
  { name: "Goa", state: "Goa", tier: "tier3" },
  { name: "Mysore", state: "Karnataka", tier: "tier3" },
  { name: "Hubli", state: "Karnataka", tier: "tier3" },
  { name: "Mangalore", state: "Karnataka", tier: "tier3" },
  { name: "Vijayawada", state: "Andhra Pradesh", tier: "tier3" },
  { name: "Warangal", state: "Telangana", tier: "tier3" },
  { name: "Madurai", state: "Tamil Nadu", tier: "tier3" },
  { name: "Salem", state: "Tamil Nadu", tier: "tier3" },
  { name: "Tiruchirappalli", state: "Tamil Nadu", tier: "tier3" },
  { name: "Agra", state: "Uttar Pradesh", tier: "tier3" },
  { name: "Varanasi", state: "Uttar Pradesh", tier: "tier3" },
  { name: "Kanpur", state: "Uttar Pradesh", tier: "tier3" },
  { name: "Allahabad", state: "Uttar Pradesh", tier: "tier3" },
  { name: "Amritsar", state: "Punjab", tier: "tier3" },
  { name: "Ludhiana", state: "Punjab", tier: "tier3" },
  { name: "Jalandhar", state: "Punjab", tier: "tier3" },
  { name: "Siliguri", state: "West Bengal", tier: "tier3" },
  { name: "Durgapur", state: "West Bengal", tier: "tier3" },
  { name: "Jammu", state: "Jammu & Kashmir", tier: "tier3" },
  { name: "Srinagar", state: "Jammu & Kashmir", tier: "tier3" },
];
