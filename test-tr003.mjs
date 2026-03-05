import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function testBuildingDescription() {
  const prompt = "A 15-story mixed-use building in downtown Mumbai with ground floor retail, parking basement, and residential apartments above. Total built-up area around 12,000 sqm.";
  
  console.log("🏗️  Testing TR-003 Building Description Generator\n");
  console.log("Input:", prompt, "\n");
  
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a professional architectural programming consultant with expertise in building design documentation.
Given a project brief, generate a comprehensive, professional-grade building description in JSON format.

Your output must be detailed enough for an architect to start schematic design, including:
- Precise area calculations (GFA, NFA, net-to-gross ratio)
- Floor-by-floor breakdown with usage
- Program areas organized by department with percentages
- Structural grid recommendations based on building type and span requirements
- Parking count based on local standards (assume 1 space per 100m² GFA unless specified)

Respond with a JSON object with these exact fields:

{
  "projectName": string,
  "buildingType": string (e.g. "Mixed-Use Tower", "Educational Campus", "Healthcare Facility"),
  "floors": number (including basement if applicable),
  "totalArea": number (in m², same as GFA),
  "gfa": number (Gross Floor Area in m²),
  "nfa": number (Net Floor Area in m² - typically 70-85% of GFA depending on building type),
  "netToGrossRatio": number (decimal, e.g. 0.75 for 75% efficiency),
  "floorBreakdown": [
    {
      "floor": string (e.g. "Basement", "Ground Floor", "Floors 1-3"),
      "area": number (m²),
      "usage": string (e.g. "Parking & MEP", "Retail & Lobby", "Office")
    }
  ],
  "programAreas": [
    {
      "department": string (e.g. "Residential", "Commercial", "Amenities", "Circulation & Services"),
      "area": number (m²),
      "percentage": number (% of total GFA)
    }
  ],
  "structuralGrid": string (e.g. "8m x 8m reinforced concrete", "7.2m x 9.6m steel frame"),
  "parkingCount": number (total spaces - calculate based on GFA and building type),
  "structure": string (structural system description),
  "facade": string (facade material/system description),
  "sustainabilityFeatures": array of strings (LEED/BREEAM considerations),
  "programSummary": string (concise 2-3 sentence narrative),
  "estimatedCost": string (e.g. "£12.5M" - use realistic construction cost per m² for region),
  "constructionDuration": string (e.g. "18 months" - based on GFA and complexity)
}

Make realistic assumptions based on building typology and industry standards. Be precise and professional.`,
      },
      {
        role: "user",
        content: `Generate a detailed architectural building description for: ${prompt}`,
      },
    ],
  });

  const result = JSON.parse(completion.choices[0].message.content);
  
  console.log("✅ OUTPUT:\n");
  console.log(JSON.stringify(result, null, 2));
  
  console.log("\n\n📊 VALIDATION:");
  console.log("✓ Project Name:", result.projectName);
  console.log("✓ GFA:", result.gfa, "m²");
  console.log("✓ NFA:", result.nfa, "m²");
  console.log("✓ Net-to-Gross Ratio:", (result.netToGrossRatio * 100).toFixed(1) + "%");
  console.log("✓ Floor Breakdown:", result.floorBreakdown.length, "entries");
  console.log("✓ Program Areas:", result.programAreas.length, "departments");
  console.log("✓ Structural Grid:", result.structuralGrid);
  console.log("✓ Parking Count:", result.parkingCount, "spaces");
  
  return result;
}

testBuildingDescription().catch(console.error);
