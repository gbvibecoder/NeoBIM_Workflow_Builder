import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, unauthorizedResponse } from "@/lib/admin-server";
import { prisma } from "@/lib/db";
import { renderWeeklyDigestEmail } from "@/shared/services/email-weekly-digest";

export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return unauthorizedResponse();

  const params = req.nextUrl.searchParams;
  const featuredWorkflowId = params.get("featuredWorkflowId");
  const tipsParam = params.get("tips");
  const featureTitle = params.get("featureTitle");
  const featureDescription = params.get("featureDescription");

  if (!featuredWorkflowId || !tipsParam) {
    return NextResponse.json(
      { error: "featuredWorkflowId and tips query params are required" },
      { status: 400 }
    );
  }

  const tips = tipsParam.split(",").map((t) => t.trim()).filter(Boolean);

  // Fetch workflow data
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

  const baseUrl = process.env.NEXTAUTH_URL || "https://buildflow.app";

  const html = renderWeeklyDigestEmail({
    featuredWorkflow: {
      name: workflowName,
      description: workflowDescription,
      url: `${baseUrl}/community/workflow/${featuredWorkflowId}`,
    },
    tips,
    featureHighlight:
      featureTitle && featureDescription
        ? { title: featureTitle, description: featureDescription }
        : undefined,
  });

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
