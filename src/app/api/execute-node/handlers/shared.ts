/**
 * Shared helpers extracted from the original execute-node/route.ts.
 * These are used by multiple node handlers, so they live in a shared module
 * rather than being duplicated.
 *
 * NOTE: pure copy from route.ts — no logic changes.
 */

// Detect region/city from text for cost estimation
export function detectRegionFromText(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  const regionMap: Array<[string[], string]> = [
    [["mumbai", "pune", "maharashtra"], "Mumbai, India"],
    [["delhi", "ncr", "noida", "gurgaon"], "Delhi, India"],
    [["bangalore", "bengaluru", "karnataka"], "Bangalore, India"],
    [["chennai", "tamil nadu"], "Mumbai, India"],
    [["hyderabad", "telangana"], "Bangalore, India"],
    [["kolkata", "west bengal"], "Mumbai, India"],
    [["london", "manchester", "birmingham", "edinburgh", "uk", "united kingdom"], "London, UK"],
    [["new york", "manhattan", "brooklyn"], "New York City, NY (USA)"],
    [["san francisco", "bay area"], "San Francisco, CA (USA)"],
    [["los angeles", "la"], "Los Angeles, CA (USA)"],
    [["chicago"], "Chicago, IL (USA)"],
    [["houston", "texas", "dallas"], "Houston, TX (USA)"],
    [["berlin", "hamburg"], "Berlin, Germany"],
    [["munich", "münchen"], "Munich, Germany"],
    [["paris", "lyon", "marseille", "france"], "Paris, France"],
    [["amsterdam", "rotterdam", "netherlands"], "Amsterdam, Netherlands"],
    [["tokyo", "osaka", "japan"], "Tokyo, Japan"],
    [["dubai", "abu dhabi", "uae"], "Dubai, UAE"],
    [["singapore"], "Singapore"],
    [["sydney", "melbourne", "brisbane", "australia"], "Sydney, Australia"],
    [["toronto", "vancouver", "montreal", "canada"], "Toronto, Canada"],
    [["são paulo", "sao paulo", "rio", "brazil"], "São Paulo, Brazil"],
    [["mexico city", "mexico"], "Mexico City, Mexico"],
  ];
  for (const [keywords, regionName] of regionMap) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return regionName;
    }
  }
  return null;
}

/** Extract building type from free-form text content */
export function extractBuildingTypeFromText(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  const types = [
    "office tower", "office building", "residential tower", "residential apartment",
    "mixed-use complex", "mixed-use building", "mixed-use tower", "mixed use",
    "warehouse", "industrial", "retail", "commercial", "hospital", "hotel",
    "school", "university", "museum", "gallery", "cultural center",
    "shopping mall", "data center", "parking garage",
  ];
  for (const t of types) {
    if (lower.includes(t)) return t.split(" ").map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
  }
  // Fallback: look for common single-word types
  const singleMatch = lower.match(/\b(office|residential|commercial|industrial|retail|hotel|hospital)\b/);
  if (singleMatch) return singleMatch[1][0].toUpperCase() + singleMatch[1].slice(1) + " Building";
  return null;
}

export function formatBuildingDescription(d: {
  projectName: string;
  buildingType: string;
  floors: number;
  totalArea: number;
  structure: string;
  facade: string;
  sustainabilityFeatures: string[];
  programSummary: string;
  estimatedCost: string;
  constructionDuration: string;
  narrative?: string;
}): string {
  // If narrative exists (TR-003 v2), use it as the primary output
  if (d.narrative) {
    return `# ${d.projectName}\n\n${d.narrative}\n\n---\n\n**Quick Facts**\nType: ${d.buildingType} | Floors: ${d.floors} | Area: ${d.totalArea.toLocaleString()} m²\nCost: ${d.estimatedCost} | Duration: ${d.constructionDuration}`;
  }

  // Fallback to legacy format if no narrative
  return d.projectName.toUpperCase() + " — BUILDING DESCRIPTION\n\nType: " + d.buildingType + "\nFloors: " + d.floors + " | Total Area: " + d.totalArea.toLocaleString() + " m²\nEstimated Cost: " + d.estimatedCost + " | Duration: " + d.constructionDuration + "\n\n" + d.programSummary + "\n\nStructure: " + d.structure + "\nFacade: " + d.facade + "\n\nSustainability: " + (d.sustainabilityFeatures.join(", ") || "TBD");
}
