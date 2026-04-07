import {
  NextResponse,
  analyzeSite,
  generateId,
  formatErrorResponse,
} from "./deps";
import type { NodeHandler } from "./types";

/**
 * TR-012 — Site Analysis (real geographic + climate data, with synthetic fallback)
 * Pure copy from execute-node/route.ts (lines 887-1060 of the pre-decomposition file).
 */
export const handleTR012: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;
  // Site Analysis — real geographic + climate data from free APIs
  // Location Input (IN-006) sends structured JSON like {"country":"India","state":"Maharashtra","city":"Pune",...}
  // Extract a geocodable address from it, or fall back to raw string
  let address = inputData?.content ?? inputData?.prompt ?? inputData?.address ?? "";
  if (typeof address === "string" && address.trim().startsWith("{")) {
    try {
      const locJson = JSON.parse(address.trim()) as Record<string, string>;
      const parts = [locJson.city, locJson.state, locJson.country].filter(Boolean);
      if (parts.length > 0) address = parts.join(", ");
    } catch { /* not valid JSON, use as-is */ }
  }
  // Also handle when inputData itself has city/state/country fields directly
  if ((!address || address.trim().startsWith("{")) && (inputData?.city || inputData?.state || inputData?.country)) {
    const parts = [inputData.city, inputData.state, inputData.country].filter(Boolean);
    if (parts.length > 0) address = parts.join(", ");
  }

  if (!address || typeof address !== "string" || address.trim().length < 3) {
    return NextResponse.json(
      formatErrorResponse({
        title: "No location provided",
        message: "Enter an address or location name using the Location Input node.",
        code: "NO_LOCATION",
      }),
      { status: 400 }
    );
  }

  // Try real geocoding, fall back to synthetic location-aware data if it fails
  let siteData;
  let siteDataSource = "real";
  try {
    siteData = await analyzeSite(address.trim());
  } catch (siteErr) {
    console.warn(`[TR-012] analyzeSite failed for "${address}", generating synthetic data:`, siteErr);
    siteDataSource = "synthetic";

    // Parse location parts from the address for climate estimation
    const addressLower = address.toLowerCase();
    const isIndia = addressLower.includes("india");
    const isTropical = isIndia || addressLower.includes("singapore") || addressLower.includes("thailand") || addressLower.includes("malaysia") || addressLower.includes("indonesia");
    const isArid = addressLower.includes("dubai") || addressLower.includes("riyadh") || addressLower.includes("qatar") || addressLower.includes("saudi");
    const isNordic = addressLower.includes("stockholm") || addressLower.includes("oslo") || addressLower.includes("copenhagen") || addressLower.includes("finland");

    // Generate climate zone based on location keywords
    let climateZone = "temperate";
    let avgSummer = 28;
    let avgWinter = 5;
    let rainfall = 800;
    const designImplications: string[] = [];

    if (isIndia) {
      // Indian climate varies by region
      const isNorthIndia = addressLower.includes("delhi") || addressLower.includes("uttar pradesh") || addressLower.includes("haryana") || addressLower.includes("punjab") || addressLower.includes("rajasthan");
      const isNEIndia = addressLower.includes("assam") || addressLower.includes("guwahati") || addressLower.includes("meghalaya") || addressLower.includes("manipur") || addressLower.includes("mizoram") || addressLower.includes("nagaland") || addressLower.includes("tripura") || addressLower.includes("arunachal") || addressLower.includes("sikkim");
      const isSouthIndia = addressLower.includes("kerala") || addressLower.includes("tamil nadu") || addressLower.includes("karnataka") || addressLower.includes("andhra") || addressLower.includes("telangana") || addressLower.includes("chennai") || addressLower.includes("bangalore") || addressLower.includes("hyderabad");
      const isWestIndia = addressLower.includes("maharashtra") || addressLower.includes("mumbai") || addressLower.includes("pune") || addressLower.includes("goa") || addressLower.includes("gujarat");

      if (isNEIndia) {
        climateZone = "tropical monsoon (humid subtropical)";
        avgSummer = 32; avgWinter = 14; rainfall = 2500;
        designImplications.push("Deep overhangs and covered walkways for heavy monsoon rainfall (2000-3000mm/year)");
        designImplications.push("Cross-ventilation design for hot humid summers (30-35°C)");
        designImplications.push("Raised plinth level for flood resilience during monsoon");
        designImplications.push("Use of local materials — bamboo screens, laterite stone, timber accents");
        designImplications.push("Lush tropical landscaping with native species — areca palms, bamboo, banana");
      } else if (isNorthIndia) {
        climateZone = "hot semi-arid / composite";
        avgSummer = 40; avgWinter = 8; rainfall = 700;
        designImplications.push("High thermal mass walls for extreme temperature range (5-45°C)");
        designImplications.push("Shaded courtyards and jaalis for passive cooling");
        designImplications.push("Double-wall or cavity wall construction for insulation");
        designImplications.push("Dust and pollution resistant facade materials");
      } else if (isSouthIndia) {
        climateZone = "tropical wet-dry";
        avgSummer = 35; avgWinter = 22; rainfall = 1200;
        designImplications.push("Sun shading devices on west and south facades");
        designImplications.push("Natural ventilation corridors for warm humid conditions");
        designImplications.push("Rainwater harvesting system (mandatory in many southern cities)");
        designImplications.push("Tropical vegetation and shade trees in landscape design");
      } else if (isWestIndia) {
        climateZone = "tropical wet-dry / semi-arid";
        avgSummer = 36; avgWinter = 16; rainfall = 1100;
        designImplications.push("Monsoon-responsive design with covered terraces and deep balconies");
        designImplications.push("Cross-ventilation for hot-humid pre-monsoon period");
        designImplications.push("Earthquake-resistant design (Seismic Zone III)");
        designImplications.push("Use of locally available materials — basalt, laterite, Mangalore tiles");
      } else {
        climateZone = "tropical / composite";
        avgSummer = 34; avgWinter = 15; rainfall = 1000;
        designImplications.push("Climate-responsive facade with sun shading");
        designImplications.push("Monsoon drainage and waterproofing design");
        designImplications.push("Natural ventilation strategies for warm conditions");
      }
    } else if (isArid) {
      climateZone = "hot arid desert";
      avgSummer = 42; avgWinter = 18; rainfall = 80;
      designImplications.push("Solar shading and low-E glazing for intense desert sun");
      designImplications.push("High-performance thermal insulation for extreme heat");
      designImplications.push("Sand/dust-resistant facade materials and sealed systems");
    } else if (isNordic) {
      climateZone = "cold maritime / subarctic";
      avgSummer = 18; avgWinter = -3; rainfall = 600;
      designImplications.push("Heavy insulation and triple glazing for cold winters");
      designImplications.push("Passive solar orientation maximizing winter sun exposure");
      designImplications.push("Snow load consideration for roof design");
    } else if (isTropical) {
      climateZone = "tropical humid";
      avgSummer = 32; avgWinter = 24; rainfall = 2000;
      designImplications.push("Cross-ventilation and natural cooling strategies");
      designImplications.push("Deep overhangs for tropical rain and sun protection");
    }

    if (designImplications.length === 0) {
      designImplications.push("Climate-responsive facade design", "Energy-efficient building envelope", "Local material palette");
    }

    siteData = {
      location: { address: address.trim(), lat: 0, lon: 0, displayName: address.trim() },
      elevation: { value: 500, unit: "m" },
      climate: {
        zone: climateZone,
        avgTempSummer: avgSummer,
        avgTempWinter: avgWinter,
        annualRainfall: rainfall,
        currentTemp: null,
        currentWeather: null,
      },
      solar: { summerNoonAltitude: 75, winterNoonAltitude: 45, equinoxNoonAltitude: 60 },
      designImplications,
    };
  }

  // Build KPI metrics for display
  const kpiMetrics = [
    { label: "Latitude", value: siteData.location.lat.toString(), unit: "°" },
    { label: "Longitude", value: siteData.location.lon.toString(), unit: "°" },
    { label: "Elevation", value: siteData.elevation.value.toString(), unit: "m" },
    { label: "Avg Summer", value: siteData.climate.avgTempSummer.toString(), unit: "°C" },
    { label: "Avg Winter", value: siteData.climate.avgTempWinter.toString(), unit: "°C" },
    { label: "Annual Rain", value: siteData.climate.annualRainfall.toString(), unit: "mm" },
  ];

  const analysisText = `SITE ANALYSIS — ${siteData.location.displayName}

Location: ${siteData.location.lat}°, ${siteData.location.lon}°
Elevation: ${siteData.elevation.value} m
Climate Zone: ${siteData.climate.zone}
${siteData.climate.currentTemp != null ? `Current Weather: ${siteData.climate.currentTemp}°C, ${siteData.climate.currentWeather}` : ""}

SOLAR GEOMETRY:
• Summer solstice noon altitude: ${siteData.solar.summerNoonAltitude}°
• Winter solstice noon altitude: ${siteData.solar.winterNoonAltitude}°
• Equinox noon altitude: ${siteData.solar.equinoxNoonAltitude}°

DESIGN IMPLICATIONS:
${siteData.designImplications.map(d => `• ${d}`).join("\n")}`;

  return {
    id: generateId(),
    executionId: executionId ?? "local",
    tileInstanceId,
    type: "kpi",
    data: {
      metrics: kpiMetrics,
      content: analysisText,
      prompt: analysisText,
      label: `Site Analysis: ${address}`,
      _raw: siteData,
    },
    metadata: { model: siteDataSource === "real" ? "site-analysis-v1" : "site-analysis-synthetic", real: true },
    createdAt: new Date(),
  };
};
