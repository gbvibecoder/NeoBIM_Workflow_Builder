import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, ADMIN_SESSION_TOKEN } from "@/lib/admin-auth";

/** Verify admin session from server-side cookie store. Returns true if valid. */
export async function isAdminRequest(): Promise<boolean> {
  const cookieStore = await cookies();
  const session = cookieStore.get(ADMIN_COOKIE_NAME);
  return session?.value === ADMIN_SESSION_TOKEN;
}

/** Standard 401 response for unauthenticated admin requests */
export function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/** Node catalogue ID → human name mapping */
export const NODE_NAMES: Record<string, string> = {
  "IN-001": "Text Prompt",
  "IN-002": "PDF Upload",
  "IN-003": "Image Upload",
  "IN-004": "IFC Upload",
  "IN-005": "Parameter Input",
  "IN-006": "Location Input",
  "IN-007": "DXF/DWG Upload",
  "TR-001": "Brief Parser",
  "TR-002": "Requirements Extractor",
  "TR-003": "Design Brief Analyzer",
  "TR-004": "Image Understanding",
  "TR-005": "Style Composer",
  "TR-006": "Zoning Checker",
  "TR-007": "Quantity Extractor",
  "TR-008": "BOQ / Cost Mapper",
  "TR-009": "BIM Query Engine",
  "TR-010": "Delta Comparator",
  "TR-011": "Carbon Inference",
  "TR-012": "GIS Context Loader",
  "GN-001": "AI Massing Generator",
  "GN-002": "Parametric Explorer",
  "GN-003": "Concept Renderer",
  "GN-004": "AI Floor Planner",
  "GN-005": "Facade Generator",
  "GN-006": "IFC → Web Viewer",
  "GN-007": "Photo → 3D",
  "GN-008": "Text → 3D",
  "GN-009": "Cinematic Walkthrough",
  "GN-010": "Multi-View → 3D",
  "GN-011": "3D Floor Plan",
  "EX-001": "IFC Exporter",
  "EX-002": "Spreadsheet Exporter",
  "EX-003": "PDF Report Generator",
  "EX-004": "Speckle Publisher",
  "EX-005": "Dashboard Publisher",
  "EX-006": "Batch Image Exporter",
};

/** Node category derived from tile type ID prefix */
export function getNodeCategory(tileType: string): string {
  if (tileType.startsWith("IN-")) return "input";
  if (tileType.startsWith("TR-")) return "transform";
  if (tileType.startsWith("GN-")) return "generate";
  if (tileType.startsWith("EX-")) return "export";
  return "unknown";
}
