/**
 * /api/workflows/from-template — server-side tier gate + Workflow create.
 *
 * The route is the authoritative tier check for template instantiation
 * (the templates page also gates client-side via canAccessTemplate, but
 * a determined attacker can bypass the client check). These tests pin
 * the contract:
 *
 *   1. 401 when not signed in
 *   2. 400 when templateId is missing or unknown
 *   3. 403 when the user's tier is below the template's requiredTier
 *   4. 403 when the user is at maxWorkflows for their plan
 *   5. 201 when access checks pass — creates the Workflow row + auto-suffixes
 *      its name on collision
 *   6. Admin (PLATFORM_ADMIN) bypasses the tier gate
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  workflowCount: vi.fn(),
  workflowFindFirst: vi.fn(),
  workflowFindMany: vi.fn(),
  workflowCreate: vi.fn(),
}));

const authMock = vi.hoisted(() => vi.fn());
const rateLimitMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ success: true }),
);
const isAdminMock = vi.hoisted(() => vi.fn().mockReturnValue(false));
const trackFirstWorkflowMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: prismaMocks.userFindUnique },
    workflow: {
      count: prismaMocks.workflowCount,
      findFirst: prismaMocks.workflowFindFirst,
      findMany: prismaMocks.workflowFindMany,
      create: prismaMocks.workflowCreate,
    },
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  checkEndpointRateLimit: rateLimitMock,
  isAdminUser: isAdminMock,
}));
vi.mock("@/lib/analytics", () => ({
  trackFirstWorkflow: trackFirstWorkflowMock,
}));

import { POST } from "@/app/api/workflows/from-template/route";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/workflows/from-template", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue({ success: true });
  isAdminMock.mockReturnValue(false);
  prismaMocks.workflowFindFirst.mockResolvedValue(null);
  prismaMocks.workflowFindMany.mockResolvedValue([]);
  prismaMocks.workflowCount.mockResolvedValue(0);
  prismaMocks.workflowCreate.mockImplementation(async ({ data }) => ({
    id: "wfdb-1",
    name: data.name,
  }));
});

describe("POST /api/workflows/from-template — auth", () => {
  it("returns 401 when not signed in", async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(makeReq({ templateId: "wf-08" }) as any);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/workflows/from-template — validation", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMocks.userFindUnique.mockResolvedValue({ role: "PRO", email: "p@x.com" });
  });

  it("returns 400 when templateId is missing", async () => {
    const res = await POST(makeReq({}) as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VAL_001");
  });

  it("returns 400 when templateId is unknown", async () => {
    const res = await POST(makeReq({ templateId: "wf-does-not-exist" }) as any);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/workflows/from-template — tier gate", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
  });

  it("403s when FREE user attempts a PRO-locked template (wf-08)", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "FREE", email: "f@x.com" });
    const res = await POST(makeReq({ templateId: "wf-08" }) as any);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("BILL_001");
    expect(body.error.title).toMatch(/not available/i);
    expect(body.error.action).toMatch(/Upgrade to Pro/);
    expect(body.error.actionUrl).toBe("/dashboard/billing");
  });

  it("403s when MINI user attempts a STARTER-locked template (wf-06)", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "MINI", email: "m@x.com" });
    const res = await POST(makeReq({ templateId: "wf-06" }) as any);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.action).toMatch(/Upgrade to Starter/);
  });

  it("permits PRO user against PRO-locked template", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "PRO", email: "p@x.com" });
    const res = await POST(makeReq({ templateId: "wf-08" }) as any);
    expect(res.status).toBe(201);
    expect(prismaMocks.workflowCreate).toHaveBeenCalled();
  });

  it("permits FREE user against an unlocked template (no requiredTier)", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "FREE", email: "f@x.com" });
    const res = await POST(makeReq({ templateId: "wf-01" }) as any);
    expect(res.status).toBe(201);
  });

  it("PLATFORM_ADMIN bypasses the tier gate", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({
      role: "PLATFORM_ADMIN",
      email: "admin@x.com",
    });
    isAdminMock.mockReturnValue(true);
    const res = await POST(makeReq({ templateId: "wf-08" }) as any);
    expect(res.status).toBe(201);
  });
});

describe("POST /api/workflows/from-template — workflow cap", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
  });

  it("403s when FREE user is at maxWorkflows (1)", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "FREE", email: "f@x.com" });
    prismaMocks.workflowCount.mockResolvedValue(1);
    // wf-01 is FREE-accessible so this isolates the cap-check path
    const res = await POST(makeReq({ templateId: "wf-01" }) as any);
    expect(res.status).toBe(403);
    const body = await res.json();
    // UserErrors.WORKFLOW_LIMIT_REACHED — the standard error shape
    expect(body.error.title).toMatch(/limit/i);
  });

  it("creates the workflow when the user is below the cap", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "FREE", email: "f@x.com" });
    prismaMocks.workflowCount.mockResolvedValue(0);
    const res = await POST(makeReq({ templateId: "wf-01" }) as any);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.workflowId).toBe("wfdb-1");
  });
});

describe("POST /api/workflows/from-template — name auto-suffix", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMocks.userFindUnique.mockResolvedValue({ role: "PRO", email: "p@x.com" });
  });

  it("appends ' (1)' on first collision", async () => {
    prismaMocks.workflowFindFirst.mockResolvedValueOnce({ id: "existing" });
    prismaMocks.workflowFindMany.mockResolvedValueOnce([
      { name: "PDF Brief → Video Walkthrough" },
    ]);
    const res = await POST(makeReq({ templateId: "wf-08" }) as any);
    expect(res.status).toBe(201);
    const createCall = prismaMocks.workflowCreate.mock.calls[0]?.[0];
    expect(createCall?.data?.name).toMatch(/\(1\)$/);
  });
});
