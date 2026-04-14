/**
 * Indian cities database for construction pricing.
 *
 * Used by:
 * - /api/cron/refresh-prices — batch price cache warming
 * - market-data-collector.ts — background city price collection
 * - price-fallback-chain.ts — city tier adjustments
 *
 * Covers all 28 states + 8 UTs with significant construction markets.
 * Ordered by construction activity volume (metro first, then tier2, tier3).
 *
 * @field nearestMetro — fallback city for price interpolation when data missing
 * @field latitude/longitude — for future transport cost / quarry proximity features
 */

export interface IndianCity {
  name: string;
  state: string;
  tier: "metro" | "tier2" | "tier3";
  latitude: number;
  longitude: number;
  nearestMetro: string;
}

export const INDIAN_CITIES: IndianCity[] = [
  // ── Metro (Tier 1) — 8 cities ──────────────────────────────────────────
  { name: "Mumbai",    state: "Maharashtra",   tier: "metro", latitude: 19.076, longitude: 72.878, nearestMetro: "Mumbai" },
  { name: "Delhi",     state: "Delhi NCR",     tier: "metro", latitude: 28.614, longitude: 77.209, nearestMetro: "Delhi" },
  { name: "Bangalore", state: "Karnataka",     tier: "metro", latitude: 12.972, longitude: 77.595, nearestMetro: "Bangalore" },
  { name: "Hyderabad", state: "Telangana",     tier: "metro", latitude: 17.385, longitude: 78.487, nearestMetro: "Hyderabad" },
  { name: "Chennai",   state: "Tamil Nadu",    tier: "metro", latitude: 13.083, longitude: 80.271, nearestMetro: "Chennai" },
  { name: "Kolkata",   state: "West Bengal",   tier: "metro", latitude: 22.573, longitude: 88.364, nearestMetro: "Kolkata" },
  { name: "Pune",      state: "Maharashtra",   tier: "metro", latitude: 18.520, longitude: 73.857, nearestMetro: "Pune" },
  { name: "Ahmedabad", state: "Gujarat",       tier: "metro", latitude: 23.023, longitude: 72.571, nearestMetro: "Ahmedabad" },

  // ── Tier 2 (Major) — 17 cities ─────────────────────────────────────────
  { name: "Jaipur",             state: "Rajasthan",         tier: "tier2", latitude: 26.912, longitude: 75.787, nearestMetro: "Delhi" },
  { name: "Lucknow",            state: "Uttar Pradesh",     tier: "tier2", latitude: 26.847, longitude: 80.947, nearestMetro: "Delhi" },
  { name: "Chandigarh",         state: "Chandigarh",        tier: "tier2", latitude: 30.734, longitude: 76.779, nearestMetro: "Delhi" },
  { name: "Indore",             state: "Madhya Pradesh",    tier: "tier2", latitude: 22.720, longitude: 75.858, nearestMetro: "Mumbai" },
  { name: "Nagpur",             state: "Maharashtra",       tier: "tier2", latitude: 21.146, longitude: 79.089, nearestMetro: "Mumbai" },
  { name: "Bhopal",             state: "Madhya Pradesh",    tier: "tier2", latitude: 23.260, longitude: 77.413, nearestMetro: "Mumbai" },
  { name: "Visakhapatnam",      state: "Andhra Pradesh",    tier: "tier2", latitude: 17.687, longitude: 83.219, nearestMetro: "Hyderabad" },
  { name: "Patna",              state: "Bihar",             tier: "tier2", latitude: 25.612, longitude: 85.145, nearestMetro: "Kolkata" },
  { name: "Vadodara",           state: "Gujarat",           tier: "tier2", latitude: 22.307, longitude: 73.182, nearestMetro: "Ahmedabad" },
  { name: "Coimbatore",         state: "Tamil Nadu",        tier: "tier2", latitude: 11.017, longitude: 76.956, nearestMetro: "Chennai" },
  { name: "Kochi",              state: "Kerala",            tier: "tier2", latitude: 9.932,  longitude: 76.267, nearestMetro: "Chennai" },
  { name: "Thiruvananthapuram", state: "Kerala",            tier: "tier2", latitude: 8.525,  longitude: 76.941, nearestMetro: "Chennai" },
  { name: "Guwahati",           state: "Assam",             tier: "tier2", latitude: 26.144, longitude: 91.736, nearestMetro: "Kolkata" },
  { name: "Bhubaneswar",        state: "Odisha",            tier: "tier2", latitude: 20.297, longitude: 85.825, nearestMetro: "Kolkata" },
  { name: "Dehradun",           state: "Uttarakhand",       tier: "tier2", latitude: 30.317, longitude: 78.032, nearestMetro: "Delhi" },
  { name: "Ranchi",             state: "Jharkhand",         tier: "tier2", latitude: 23.344, longitude: 85.310, nearestMetro: "Kolkata" },
  { name: "Raipur",             state: "Chhattisgarh",      tier: "tier2", latitude: 21.251, longitude: 81.630, nearestMetro: "Mumbai" },

  // ── Tier 3 (Growing) — 25 cities ───────────────────────────────────────
  { name: "Surat",             state: "Gujarat",           tier: "tier3", latitude: 21.170, longitude: 72.831, nearestMetro: "Ahmedabad" },
  { name: "Nashik",            state: "Maharashtra",       tier: "tier3", latitude: 19.998, longitude: 73.790, nearestMetro: "Mumbai" },
  { name: "Aurangabad",        state: "Maharashtra",       tier: "tier3", latitude: 19.876, longitude: 75.343, nearestMetro: "Mumbai" },
  { name: "Jodhpur",           state: "Rajasthan",         tier: "tier3", latitude: 26.239, longitude: 73.024, nearestMetro: "Delhi" },
  { name: "Udaipur",           state: "Rajasthan",         tier: "tier3", latitude: 24.586, longitude: 73.712, nearestMetro: "Ahmedabad" },
  { name: "Goa",               state: "Goa",               tier: "tier3", latitude: 15.300, longitude: 74.000, nearestMetro: "Mumbai" },
  { name: "Mysore",            state: "Karnataka",         tier: "tier3", latitude: 12.296, longitude: 76.639, nearestMetro: "Bangalore" },
  { name: "Hubli",             state: "Karnataka",         tier: "tier3", latitude: 15.350, longitude: 75.124, nearestMetro: "Bangalore" },
  { name: "Mangalore",         state: "Karnataka",         tier: "tier3", latitude: 12.914, longitude: 74.856, nearestMetro: "Bangalore" },
  { name: "Vijayawada",        state: "Andhra Pradesh",    tier: "tier3", latitude: 16.506, longitude: 80.648, nearestMetro: "Hyderabad" },
  { name: "Warangal",          state: "Telangana",         tier: "tier3", latitude: 17.978, longitude: 79.600, nearestMetro: "Hyderabad" },
  { name: "Madurai",           state: "Tamil Nadu",        tier: "tier3", latitude: 9.925,  longitude: 78.120, nearestMetro: "Chennai" },
  { name: "Salem",             state: "Tamil Nadu",        tier: "tier3", latitude: 11.664, longitude: 78.146, nearestMetro: "Chennai" },
  { name: "Tiruchirappalli",   state: "Tamil Nadu",        tier: "tier3", latitude: 10.791, longitude: 78.705, nearestMetro: "Chennai" },
  { name: "Agra",              state: "Uttar Pradesh",     tier: "tier3", latitude: 27.177, longitude: 78.008, nearestMetro: "Delhi" },
  { name: "Varanasi",          state: "Uttar Pradesh",     tier: "tier3", latitude: 25.318, longitude: 83.010, nearestMetro: "Delhi" },
  { name: "Kanpur",            state: "Uttar Pradesh",     tier: "tier3", latitude: 26.450, longitude: 80.350, nearestMetro: "Delhi" },
  { name: "Allahabad",         state: "Uttar Pradesh",     tier: "tier3", latitude: 25.431, longitude: 81.846, nearestMetro: "Delhi" },
  { name: "Amritsar",          state: "Punjab",            tier: "tier3", latitude: 31.634, longitude: 74.872, nearestMetro: "Delhi" },
  { name: "Ludhiana",          state: "Punjab",            tier: "tier3", latitude: 30.901, longitude: 75.857, nearestMetro: "Delhi" },
  { name: "Jalandhar",         state: "Punjab",            tier: "tier3", latitude: 31.326, longitude: 75.576, nearestMetro: "Delhi" },
  { name: "Siliguri",          state: "West Bengal",       tier: "tier3", latitude: 26.707, longitude: 88.430, nearestMetro: "Kolkata" },
  { name: "Durgapur",          state: "West Bengal",       tier: "tier3", latitude: 23.520, longitude: 87.320, nearestMetro: "Kolkata" },
  { name: "Jammu",             state: "Jammu & Kashmir",   tier: "tier3", latitude: 32.726, longitude: 74.857, nearestMetro: "Delhi" },
  { name: "Srinagar",          state: "Jammu & Kashmir",   tier: "tier3", latitude: 34.084, longitude: 74.797, nearestMetro: "Delhi" },
];

// ── Lookup helpers ───────────────────────────────────────────────────────────

/** Find a city by name (case-insensitive, fuzzy-matches common variants) */
export function findCity(name: string): IndianCity | undefined {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return undefined;

  // Exact match first
  const exact = INDIAN_CITIES.find(c => c.name.toLowerCase() === normalized);
  if (exact) return exact;

  // Common aliases
  const aliases: Record<string, string> = {
    "bengaluru": "bangalore",
    "bombay": "mumbai",
    "calcutta": "kolkata",
    "madras": "chennai",
    "trivandrum": "thiruvananthapuram",
    "trichy": "tiruchirappalli",
    "vizag": "visakhapatnam",
    "baroda": "vadodara",
    "prayagraj": "allahabad",
    "panaji": "goa",
    "noida": "delhi",
    "gurgaon": "delhi",
    "gurugram": "delhi",
    "navi mumbai": "mumbai",
    "thane": "mumbai",
    "new delhi": "delhi",
  };

  const aliased = aliases[normalized];
  if (aliased) return INDIAN_CITIES.find(c => c.name.toLowerCase() === aliased);

  // Partial match (startsWith)
  return INDIAN_CITIES.find(c => c.name.toLowerCase().startsWith(normalized));
}

/** Get the nearest metro for a city (for price interpolation) */
export function getNearestMetro(cityName: string): IndianCity | undefined {
  const city = findCity(cityName);
  if (!city) return undefined;
  return INDIAN_CITIES.find(c => c.name === city.nearestMetro && c.tier === "metro");
}

/** Get all cities in a state */
export function getCitiesByState(state: string): IndianCity[] {
  const normalized = state.trim().toLowerCase();
  return INDIAN_CITIES.filter(c => c.state.toLowerCase() === normalized);
}
