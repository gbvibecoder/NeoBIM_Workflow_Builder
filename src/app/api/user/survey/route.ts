import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

// Narrow string validator — keeps payloads clean without a new dep
function str(v: unknown, max = 400): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}
function num(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  return v;
}

const ALLOWED_PRICING = new Set([
  "chose_free",
  "chose_starter",
  "chose_pro",
  "explore_more",
  "skipped",
]);

// ── First-touch attribution helpers ────────────────────────────────────
// Keep UA length short in storage (some bots send monster strings).
const MAX_UA = 500;

function detectDevice(ua: string | null): "mobile" | "tablet" | "desktop" | null {
  if (!ua) return null;
  // Tablet detection first (iPad reports "Mobile" too, so order matters).
  if (/iPad|Tablet|PlayBook|Silk|(?:Android(?!.*Mobile))/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone|iPod|IEMobile|BlackBerry/i.test(ua)) return "mobile";
  return "desktop";
}

interface Attribution {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  referrer: string | null;
  country: string | null;
  city: string | null;
  deviceType: "mobile" | "tablet" | "desktop" | null;
  userAgent: string | null;
}

function extractAttribution(body: Record<string, unknown>, req: NextRequest): Attribution {
  const ua = req.headers.get("user-agent");
  return {
    utmSource:   str(body.utmSource, 200),
    utmMedium:   str(body.utmMedium, 200),
    utmCampaign: str(body.utmCampaign, 200),
    utmTerm:     str(body.utmTerm, 200),
    utmContent:  str(body.utmContent, 200),
    referrer:    str(body.referrer, 500),
    // Vercel edge headers — free, present on prod. Null in local dev is fine.
    country:     req.headers.get("x-vercel-ip-country") || null,
    city:        req.headers.get("x-vercel-ip-city") || null,
    deviceType:  detectDevice(ua),
    userAgent:   ua ? ua.slice(0, MAX_UA) : null,
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
  }
  const survey = await prisma.userSurvey.findUnique({ where: { userId: session.user.id } });
  return NextResponse.json({ survey });
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    // Generous limit — auto-save fires after every card tap.
    const rate = await checkEndpointRateLimit(session.user.id, "user-survey", 120, "1 m");
    if (!rate.success) {
      return NextResponse.json(
        formatErrorResponse({ title: "Too many requests", message: "Please try again later.", code: "RATE_001" }),
        { status: 429 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const pricingRaw = str(body.pricingAction);
    const pricingAction = pricingRaw && ALLOWED_PRICING.has(pricingRaw) ? pricingRaw : null;

    const completed = body.completedAt === true;
    const skippedAtScene = num(body.skippedAtScene);

    const data = {
      discoverySource: str(body.discoverySource, 64),
      discoveryOther:  str(body.discoveryOther, 400),
      profession:      str(body.profession, 64),
      professionOther: str(body.professionOther, 400),
      teamSize:        str(body.teamSize, 64),
      pricingAction,
      completedAt:     completed ? new Date() : undefined,
      skippedAt:       skippedAtScene !== null ? new Date() : undefined,
      skippedAtScene:  skippedAtScene,
    };

    // Filter undefined so auto-save patches without clobbering terminal timestamps.
    const cleanUpdate: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) cleanUpdate[k] = v;
    }

    // Attribution — persisted ONLY on CREATE. First-touch wins; subsequent
    // auto-saves in the same session cannot overwrite it.
    const attr = extractAttribution(body, req);

    const survey = await prisma.userSurvey.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        discoverySource: data.discoverySource,
        discoveryOther:  data.discoveryOther,
        profession:      data.profession,
        professionOther: data.professionOther,
        teamSize:        data.teamSize,
        pricingAction:   data.pricingAction,
        completedAt:     data.completedAt ?? null,
        skippedAt:       data.skippedAt ?? null,
        skippedAtScene:  data.skippedAtScene,
        utmSource:       attr.utmSource,
        utmMedium:       attr.utmMedium,
        utmCampaign:     attr.utmCampaign,
        utmTerm:         attr.utmTerm,
        utmContent:      attr.utmContent,
        referrer:        attr.referrer,
        country:         attr.country,
        city:            attr.city,
        deviceType:      attr.deviceType,
        userAgent:       attr.userAgent,
      },
      update: cleanUpdate,
    });

    return NextResponse.json({ survey });
  } catch (err) {
    // Explicit stack trace to stdout so the dev-server terminal shows
    // exactly what failed. Previously the catch only surfaced the
    // message in the JSON response body, which was easy to miss.
    console.error("[/api/user/survey POST] failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      formatErrorResponse({ title: "Save failed", message, code: "NODE_001" }),
      { status: 500 }
    );
  }
}
