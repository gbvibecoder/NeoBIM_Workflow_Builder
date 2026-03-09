import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

const MAX_IMAGE_BASE64_SIZE = 100 * 1024; // 100KB base64 string (~75KB image)
const MAX_NAME_LENGTH = 100;

// GET /api/user/profile
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, image: true },
    });

    return NextResponse.json({
      name: user?.name ?? null,
      email: user?.email ?? null,
      image: user?.image ?? null,
    });
  } catch (error) {
    console.error("[user/profile/GET]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}

// PATCH /api/user/profile
export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    const rateLimit = await checkEndpointRateLimit(session.user.id, "user-profile", 10, "1 m");
    if (!rateLimit.success) {
      return NextResponse.json(
        formatErrorResponse({ title: "Too many requests", message: "Too many profile updates. Please wait a moment.", code: "RATE_001" }),
        { status: 429 },
      );
    }

    const body = await req.json();
    const { name, image } = body as { name?: string | null; image?: string | null };

    const updateData: { name?: string | null; image?: string | null } = {};

    // Validate name if provided
    if ("name" in body) {
      if (name !== null && typeof name !== "string") {
        return NextResponse.json(
          formatErrorResponse({ title: "Invalid name", message: "Name must be a string.", code: "VAL_001" }),
          { status: 400 },
        );
      }
      if (name && name.trim().length > MAX_NAME_LENGTH) {
        return NextResponse.json(
          formatErrorResponse({ title: "Name too long", message: `Name must be ${MAX_NAME_LENGTH} characters or less.`, code: "VAL_001" }),
          { status: 400 },
        );
      }
      updateData.name = name ? name.trim() : null;
    }

    // Validate image if provided
    if ("image" in body) {
      if (image === null) {
        updateData.image = null;
      } else if (typeof image === "string") {
        if (!image.startsWith("data:image/")) {
          return NextResponse.json(
            formatErrorResponse({ title: "Invalid image", message: "Image must be a valid data URL.", code: "VAL_001" }),
            { status: 400 },
          );
        }
        if (image.length > MAX_IMAGE_BASE64_SIZE) {
          return NextResponse.json(
            formatErrorResponse({ title: "Image too large", message: "Profile image must be under 100KB. Try a smaller image.", code: "VAL_001" }),
            { status: 413 },
          );
        }
        updateData.image = image;
      } else {
        return NextResponse.json(
          formatErrorResponse({ title: "Invalid image", message: "Image must be a string or null.", code: "VAL_001" }),
          { status: 400 },
        );
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        formatErrorResponse({ title: "No changes", message: "No fields to update.", code: "VAL_001" }),
        { status: 400 },
      );
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: updateData,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[user/profile/PATCH]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
