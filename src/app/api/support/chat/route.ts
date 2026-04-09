import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import {
  generateSupportResponse,
  generateSubject,
  detectCategory,
} from "@/services/support-chat-service";
import type { SupportCategory } from "@/types/support";

const MAX_MESSAGE_LENGTH = 3000;
const MAX_MESSAGES_PER_CONVERSATION = 100;

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const rl = await checkEndpointRateLimit(session.user.id, "support-chat", 20, "1 m");
    if (!rl.success) {
      return NextResponse.json(
        { error: { title: "Slow down", message: "Please wait a moment before sending another message.", code: "RATE_001" } },
        { status: 429 },
      );
    }

    const body = await req.json();
    const { message, conversationId, pageContext } = body as {
      message?: string;
      conversationId?: string;
      pageContext?: string;
    };

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return NextResponse.json(
        { error: { title: "Invalid input", message: "Message is required.", code: "VAL_001" } },
        { status: 400 },
      );
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { error: { title: "Message too long", message: `Message must be under ${MAX_MESSAGE_LENGTH} characters.`, code: "VAL_001" } },
        { status: 400 },
      );
    }

    const userId = session.user.id;
    const userRole = (session.user as { role?: string }).role || "FREE";

    // Get or create conversation
    let convId = conversationId;
    let isNewConversation = false;

    if (convId) {
      // Verify ownership
      const existing = await prisma.supportConversation.findFirst({
        where: { id: convId, userId },
      });
      if (!existing) {
        return NextResponse.json(
          { error: { title: "Not found", message: "Conversation not found.", code: "VAL_001" } },
          { status: 404 },
        );
      }
      if (existing.status === "CLOSED" || existing.status === "RESOLVED") {
        return NextResponse.json(
          { error: { title: "Conversation closed", message: "This conversation has been closed. Please start a new one.", code: "VAL_001" } },
          { status: 400 },
        );
      }
      if (existing.messageCount >= MAX_MESSAGES_PER_CONVERSATION) {
        return NextResponse.json(
          { error: { title: "Conversation limit", message: "This conversation has reached its message limit. Please start a new one or talk to our team.", code: "VAL_001" } },
          { status: 400 },
        );
      }
    } else {
      // Race condition guard: reuse very recent active conversation
      const recent = await prisma.supportConversation.findFirst({
        where: {
          userId,
          status: "ACTIVE",
          createdAt: { gte: new Date(Date.now() - 5000) },
        },
        orderBy: { createdAt: "desc" },
      });

      if (recent) {
        convId = recent.id;
      } else {
        // Create new conversation
        const conv = await prisma.supportConversation.create({
          data: {
            userId,
            pageContext: pageContext || null,
            userPlan: userRole,
            category: detectCategory(message.trim()) as SupportCategory,
          },
        });
        convId = conv.id;
      }
      isNewConversation = true;
    }

    // Save user message
    const userMsg = await prisma.supportMessage.create({
      data: {
        conversationId: convId,
        role: "USER",
        content: message.trim(),
      },
    });

    // Fetch conversation history for context
    const history = await prisma.supportMessage.findMany({
      where: { conversationId: convId },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { role: true, content: true },
    });

    // Get user stats for context
    const [workflowCount, user] = await Promise.all([
      prisma.workflow.count({ where: { ownerId: userId, deletedAt: null } }),
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    ]);

    // Generate AI response (outside transaction — long-running external call)
    const aiResult = await generateSupportResponse(message.trim(), {
      userPlan: userRole,
      userName: user?.name || null,
      workflowCount,
      pageContext: pageContext || undefined,
      previousMessages: history.map((m) => ({
        role: m.role as "USER" | "AI" | "ADMIN" | "SYSTEM",
        content: m.content,
      })),
    });

    const category = aiResult.metadata.suggestedCategory || "GENERAL";

    // Generate subject for new conversations (outside transaction)
    const subject = isNewConversation ? await generateSubject(message.trim()) : null;

    // Save AI response + update conversation atomically
    const aiMsg = await prisma.$transaction(async (tx) => {
      const aMsg = await tx.supportMessage.create({
        data: {
          conversationId: convId,
          role: "AI",
          content: aiResult.content,
          metadata: JSON.parse(JSON.stringify(aiResult.metadata)),
        },
      });

      const updateData: Record<string, unknown> = {
        messageCount: { increment: 2 },
        lastMessageAt: new Date(),
        category: category as SupportCategory,
      };

      if (subject) {
        updateData.subject = subject;
      }

      await tx.supportConversation.update({
        where: { id: convId },
        data: updateData,
      });

      return aMsg;
    });

    return NextResponse.json({
      conversationId: convId,
      message: {
        id: aiMsg.id,
        conversationId: convId,
        role: aiMsg.role,
        content: aiMsg.content,
        metadata: aiMsg.metadata,
        isInternal: false,
        createdAt: aiMsg.createdAt.toISOString(),
      },
      suggestions: aiResult.metadata.suggestions || [],
      category,
      userMessage: {
        id: userMsg.id,
        conversationId: convId,
        role: "USER",
        content: userMsg.content,
        metadata: {},
        isInternal: false,
        createdAt: userMsg.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("[support/chat] Error:", error);
    return NextResponse.json(
      { error: { title: "Server error", message: "Something went wrong. Please try again.", code: "NET_001" } },
      { status: 500 },
    );
  }
}
