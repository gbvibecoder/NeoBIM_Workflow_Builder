import OpenAI from "openai";

function getClient(userApiKey?: string): OpenAI {
  const key = userApiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("No OpenAI API key configured");
  return new OpenAI({ apiKey: key });
}

// ─── Error Handling ───────────────────────────────────────────────────────────

export class OpenAIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public userMessage: string
  ) {
    super(message);
    this.name = "OpenAIError";
  }
}

async function handleOpenAICall<T>(
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    // Handle OpenAI API errors
    if (error?.status || error?.response?.status) {
      const status = error.status || error.response?.status;
      
      if (status === 429) {
        throw new OpenAIError(
          "OpenAI rate limit exceeded",
          429,
          "AI service temporarily unavailable. Please try again in a moment."
        );
      }
      
      if (status === 401) {
        throw new OpenAIError(
          "Invalid OpenAI API key",
          401,
          "AI service configuration error. Please contact support."
        );
      }
      
      if (status >= 500) {
        throw new OpenAIError(
          "OpenAI server error",
          500,
          "AI service error. Please try again."
        );
      }
    }
    
    // Re-throw other errors
    throw error;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BuildingDescription {
  projectName: string;
  buildingType: string;
  floors: number;
  totalArea: number; // m²
  structure: string;
  facade: string;
  sustainabilityFeatures: string[];
  programSummary: string;
  estimatedCost: string;
  constructionDuration: string;
}

// ─── generateBuildingDescription ─────────────────────────────────────────────

export async function generateBuildingDescription(
  prompt: string,
  userApiKey?: string
): Promise<BuildingDescription> {
  return handleOpenAICall(async () => {
    const client = getClient(userApiKey);

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an AEC (Architecture, Engineering, Construction) design assistant.
Given a project brief, generate a structured building description in JSON format.
Respond with a JSON object with these exact fields:
- projectName (string)
- buildingType (string: e.g. "Mixed-Use Tower", "Educational Campus", "Healthcare Facility")
- floors (number)
- totalArea (number, in square meters)
- structure (string: structural system description)
- facade (string: facade material/system description)
- sustainabilityFeatures (array of strings)
- programSummary (string: brief description of building program)
- estimatedCost (string: e.g. "£12.5M")
- constructionDuration (string: e.g. "18 months")`,
        },
        {
          role: "user",
          content: `Generate a building description for: ${prompt}`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned empty response");

    return JSON.parse(content) as BuildingDescription;
  });
}

// ─── generateConceptImage ─────────────────────────────────────────────────────

export async function generateConceptImage(
  description: BuildingDescription,
  style: string = "photorealistic architectural render",
  userApiKey?: string
): Promise<{ url: string; revisedPrompt: string }> {
  return handleOpenAICall(async () => {
    const client = getClient(userApiKey);

    const imagePrompt = `${style} of a ${description.buildingType}, ${description.programSummary}.
${description.floors} floors, ${description.facade} facade, ${description.structure} structure.
Professional architectural visualization, golden hour lighting with soft warm shadows, vibrant urban context with pedestrians and landscaping. Shot from eye-level perspective, ultra-high quality architectural photography, cinematic composition. Client-presentation ready, award-winning architectural render.`;

    const response = await client.images.generate({
      model: "dall-e-3",
      prompt: imagePrompt,
      n: 1,
      size: "1024x1024",
      quality: "hd",
    });

    const image = response.data?.[0];
    if (!image?.url) throw new Error("No image URL in DALL-E response");

    return {
      url: image.url,
      revisedPrompt: image.revised_prompt ?? imagePrompt,
    };
  });
}
