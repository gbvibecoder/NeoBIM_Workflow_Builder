/**
 * Site Analysis Service — fetches real geographic and climate data from free public APIs.
 * Uses: OpenStreetMap Nominatim (geocoding), Open-Meteo (weather/elevation).
 */

const USER_AGENT = "BuildFlow/1.0 (contact@buildflow.app)";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SiteAnalysisResult {
  location: {
    address: string;
    lat: number;
    lon: number;
    displayName: string;
  };
  elevation: {
    value: number;
    unit: string;
  };
  climate: {
    zone: string;
    avgTempSummer: number;
    avgTempWinter: number;
    annualRainfall: number;
    currentTemp?: number;
    currentWeather?: string;
  };
  solar: {
    summerNoonAltitude: number;
    winterNoonAltitude: number;
    equinoxNoonAltitude: number;
  };
  designImplications: string[];
}

// ─── Geocoding (Nominatim) ──────────────────────────────────────────────────

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

async function geocode(address: string): Promise<{ lat: number; lon: number; displayName: string }> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`);

  const data = (await res.json()) as NominatimResult[];
  if (!data.length) throw new Error(`Location not found: "${address}". Please try a more specific address.`);

  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon),
    displayName: data[0].display_name,
  };
}

// ─── Elevation (Open-Meteo) ─────────────────────────────────────────────────

async function getElevation(lat: number, lon: number): Promise<number> {
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`;

  const res = await fetch(url);
  if (!res.ok) return 0; // Non-fatal

  const data = (await res.json()) as { elevation?: number[] };
  return data.elevation?.[0] ?? 0;
}

// ─── Weather / Climate (Open-Meteo) ─────────────────────────────────────────

interface WeatherResponse {
  current_weather?: {
    temperature: number;
    weathercode: number;
  };
  daily?: {
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
  };
}

async function getWeather(lat: number, lon: number): Promise<{
  currentTemp?: number;
  currentWeather?: string;
  avgTempSummer: number;
  avgTempWinter: number;
  annualRainfall: number;
}> {
  // Fetch 365 days of daily data for annual averages
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&past_days=180&forecast_days=16`;

  const res = await fetch(url);
  if (!res.ok) {
    return { avgTempSummer: 20, avgTempWinter: 5, annualRainfall: 600 };
  }

  const data = (await res.json()) as WeatherResponse;

  const maxTemps = data.daily?.temperature_2m_max ?? [];
  const minTemps = data.daily?.temperature_2m_min ?? [];
  const precip = data.daily?.precipitation_sum ?? [];

  // Estimate summer (warmest quarter) and winter (coldest quarter) averages
  const allAvgs = maxTemps.map((max, i) => (max + (minTemps[i] ?? max)) / 2);
  const sorted = [...allAvgs].sort((a, b) => a - b);
  const q1 = sorted.slice(0, Math.floor(sorted.length / 4));
  const q4 = sorted.slice(Math.floor(sorted.length * 3 / 4));

  const avgWinter = q1.length > 0 ? q1.reduce((a, b) => a + b, 0) / q1.length : 5;
  const avgSummer = q4.length > 0 ? q4.reduce((a, b) => a + b, 0) / q4.length : 20;
  const totalPrecip = precip.reduce((a, b) => a + b, 0);
  // Extrapolate to annual if we have ~196 days of data
  const daysOfData = precip.length || 1;
  const annualRainfall = Math.round((totalPrecip / daysOfData) * 365);

  const weatherCodes: Record<number, string> = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Depositing rime fog", 51: "Light drizzle", 53: "Moderate drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    80: "Slight rain showers", 81: "Moderate rain showers", 95: "Thunderstorm",
  };

  return {
    currentTemp: data.current_weather?.temperature,
    currentWeather: weatherCodes[data.current_weather?.weathercode ?? -1] ?? "Unknown",
    avgTempSummer: Math.round(avgSummer * 10) / 10,
    avgTempWinter: Math.round(avgWinter * 10) / 10,
    annualRainfall,
  };
}

// ─── Solar Angles ───────────────────────────────────────────────────────────

function getSolarAngles(latitude: number): {
  summerNoonAltitude: number;
  winterNoonAltitude: number;
  equinoxNoonAltitude: number;
} {
  const absLat = Math.abs(latitude);

  // Summer solstice — declination = 23.45° (in same hemisphere)
  const summerNoonAlt = 90 - absLat + 23.45;
  // Winter solstice — declination = -23.45°
  const winterNoonAlt = 90 - absLat - 23.45;
  // Equinox — declination = 0°
  const equinoxNoonAlt = 90 - absLat;

  return {
    summerNoonAltitude: Math.round(Math.max(0, summerNoonAlt) * 10) / 10,
    winterNoonAltitude: Math.round(Math.max(0, winterNoonAlt) * 10) / 10,
    equinoxNoonAltitude: Math.round(Math.max(0, equinoxNoonAlt) * 10) / 10,
  };
}

// ─── Climate Zone Classification ────────────────────────────────────────────

function classifyClimateZone(lat: number, avgSummer: number, avgWinter: number, rainfall: number): string {
  const absLat = Math.abs(lat);

  if (absLat < 23.5) {
    if (rainfall > 1500) return "Af (Tropical Rainforest)";
    if (avgWinter > 18) return "Aw (Tropical Savanna)";
    return "Am (Tropical Monsoon)";
  }

  if (absLat < 35) {
    if (rainfall < 250) return "BWh (Hot Desert)";
    if (rainfall < 500) return "BSh (Hot Steppe)";
    if (avgSummer > 22) return "Csa (Mediterranean)";
    return "Csb (Mediterranean, Warm Summer)";
  }

  if (absLat < 55) {
    if (avgWinter < -3) {
      if (avgSummer > 22) return "Dfa (Humid Continental)";
      return "Dfb (Humid Continental, Warm Summer)";
    }
    if (avgSummer > 22) return "Cfa (Humid Subtropical)";
    return "Cfb (Marine West Coast)";
  }

  if (avgWinter < -10) return "Dfc (Subarctic)";
  return "ET (Tundra)";
}

// ─── Design Implications ────────────────────────────────────────────────────

function generateDesignImplications(
  lat: number,
  elevation: number,
  avgSummer: number,
  avgWinter: number,
  rainfall: number,
  solar: { winterNoonAltitude: number; summerNoonAltitude: number }
): string[] {
  const implications: string[] = [];
  const absLat = Math.abs(lat);
  const hemisphere = lat >= 0 ? "south" : "north";

  // Solar / orientation
  if (absLat > 40) {
    implications.push(`High latitude (${absLat.toFixed(1)}°) — maximize ${hemisphere}-facing glazing for passive solar gain`);
  } else if (absLat > 23.5) {
    implications.push(`Mid latitude — optimize ${hemisphere}-facing facades for balanced solar exposure`);
  } else {
    implications.push("Tropical latitude — prioritize shading and cross-ventilation over solar gain");
  }

  // Winter conditions
  if (avgWinter < -5) {
    implications.push("Extreme cold winters — high-performance envelope required, triple glazing recommended");
  } else if (avgWinter < 5) {
    implications.push("Cold winters — insulation priority, consider triple glazing and thermal mass");
  } else if (avgWinter > 15) {
    implications.push("Mild winters — cooling is the primary concern, natural ventilation viable year-round");
  }

  // Summer conditions
  if (avgSummer > 30) {
    implications.push("Hot summers — external shading devices essential, consider high albedo materials");
  } else if (avgSummer > 25) {
    implications.push("Warm summers — solar shading on east/west facades, night ventilation effective");
  }

  // Rainfall
  if (rainfall > 1200) {
    implications.push("High rainfall — robust waterproofing, covered entries, drainage design critical");
  } else if (rainfall < 300) {
    implications.push("Arid climate — water harvesting recommended, evaporative cooling potential");
  } else {
    implications.push("Moderate rainfall — standard waterproofing sufficient");
  }

  // Sun angles
  if (solar.winterNoonAltitude < 20) {
    implications.push(`Low winter sun angle (${solar.winterNoonAltitude}°) — risk of overshadowing from neighboring buildings`);
  }
  if (solar.summerNoonAltitude > 70) {
    implications.push(`High summer sun (${solar.summerNoonAltitude}°) — horizontal overhangs effective for south facade`);
  }

  // Elevation
  if (elevation > 1000) {
    implications.push(`High elevation (${elevation}m) — increased UV exposure, lower air pressure affects HVAC sizing`);
  }

  return implications;
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export async function analyzeSite(address: string): Promise<SiteAnalysisResult> {
  // Step 1: Geocode
  const geo = await geocode(address);

  // Step 2: Fetch data in parallel
  const [elevation, weather] = await Promise.all([
    getElevation(geo.lat, geo.lon),
    getWeather(geo.lat, geo.lon),
  ]);

  // Step 3: Calculate solar angles
  const solar = getSolarAngles(geo.lat);

  // Step 4: Classify climate zone
  const zone = classifyClimateZone(
    geo.lat,
    weather.avgTempSummer,
    weather.avgTempWinter,
    weather.annualRainfall
  );

  // Step 5: Generate design implications
  const implications = generateDesignImplications(
    geo.lat,
    elevation,
    weather.avgTempSummer,
    weather.avgTempWinter,
    weather.annualRainfall,
    solar
  );

  return {
    location: {
      address,
      lat: Math.round(geo.lat * 10000) / 10000,
      lon: Math.round(geo.lon * 10000) / 10000,
      displayName: geo.displayName,
    },
    elevation: { value: Math.round(elevation), unit: "m" },
    climate: {
      zone,
      avgTempSummer: weather.avgTempSummer,
      avgTempWinter: weather.avgTempWinter,
      annualRainfall: weather.annualRainfall,
      currentTemp: weather.currentTemp,
      currentWeather: weather.currentWeather,
    },
    solar,
    designImplications: implications,
  };
}
