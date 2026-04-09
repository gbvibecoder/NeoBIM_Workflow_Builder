import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { getAdminSession, unauthorizedResponse } from "@/lib/admin-server";
import { prisma } from "@/lib/db";
import { sendWeeklyDigest } from "@/shared/services/email-weekly-digest";
import type { WeeklyDigestData } from "@/shared/services/email-weekly-digest";

interface RequestBody {
  featuredWorkflowId: string;
  tips: string[];
  featureHighlight?: {
    title: string;
    description: string;
  };
}

export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return unauthorizedResponse();

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { featuredWorkflowId, tips, featureHighlight } = body;

  if (!featuredWorkflowId || !Array.isArray(tips) || tips.length === 0) {
    return NextResponse.json(
      { error: "featuredWorkflowId and tips[] are required" },
      { status: 400 }
    );
  }

  // Fetch workflow — prefer community publication data, fall back to workflow
  let workflowName: string;
  let workflowDescription: string;

  const publication = await prisma.communityPublication.findFirst({
    where: { workflowId: featuredWorkflowId },
    select: { title: true, description: true },
  });

  if (publication) {
    workflowName = publication.title;
    workflowDescription = publication.description ?? "";
  } else {
    const workflow = await prisma.workflow.findUnique({
      where: { id: featuredWorkflowId },
      select: { name: true, description: true },
    });

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }

    workflowName = workflow.name;
    workflowDescription = workflow.description ?? "";
  }

  // Read newsletter subscribers
  const signupsPath = join(
    process.cwd(),
    "analytics-logs",
    "newsletter-signups.jsonl"
  );

  let emails: string[];
  try {
    const content = await readFile(signupsPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const allEmails = lines.map((line) => {
      const parsed = JSON.parse(line) as { email: string };
      return parsed.email?.toLowerCase().trim();
    });
    emails = [...new Set(allEmails.filter(Boolean))];
  } catch {
    return NextResponse.json(
      { error: "Could not read newsletter subscribers" },
      { status: 500 }
    );
  }

  if (emails.length === 0) {
    return NextResponse.json(
      { error: "No subscribers found" },
      { status: 404 }
    );
  }

  const baseUrl = process.env.NEXTAUTH_URL || "https://buildflow.app";

  const data: WeeklyDigestData = {
    featuredWorkflow: {
      name: workflowName,
      description: workflowDescription,
      url: `${baseUrl}/community/workflow/${featuredWorkflowId}`,
    },
    tips,
    featureHighlight,
  };

  const result = await sendWeeklyDigest(emails, data);

  return NextResponse.json({
    sent: result.sent,
    failed: result.failed,
    totalSubscribers: emails.length,
  });
}
