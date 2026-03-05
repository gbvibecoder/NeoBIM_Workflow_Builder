# API Security Review - NeoBIM Workflow Builder

**Review Date:** March 5, 2026  
**Reviewer:** Backend GOAT (Chhawa)  
**Scope:** All API routes in `/src/app/api/*`

---

## 📊 Executive Summary

Reviewed 10 API route files across 5 main endpoints. Found **27 issues** across 4 severity levels:

- 🔴 **CRITICAL:** 4 issues (immediate action required)
- 🟠 **HIGH:** 7 issues (fix before production)
- 🟡 **MEDIUM:** 11 issues (fix in next sprint)
- 🟢 **LOW:** 5 issues (technical debt)

**Overall Security Score:** 6.5/10 (Needs improvement before production)

---

## 🔴 CRITICAL ISSUES (Priority 1)

### C1. Hard-Coded Admin Bypass Email
**File:** `/api/execute-node/route.ts` (Lines 22-26)  
**Issue:** Admin email `erolerutik9@gmail.com` is hard-coded in source code

```typescript
// EMERGENCY ADMIN BYPASS
if (session?.user?.email === "erolerutik9@gmail.com") {
  console.log("[ADMIN BYPASS] Skipping rate limit for admin");
}
```

**Risk:**
- Exposes admin email in codebase (GitHub, logs)
- Cannot be changed without code deployment
- Violates principle of least privilege

**Recommended Fix:**
```typescript
const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase());
if (adminEmails.includes(userEmail?.toLowerCase() || "")) {
  console.log("[ADMIN BYPASS] Skipping rate limit for admin");
}
```

**Environment Variable:**
```env
ADMIN_EMAILS=erolerutik9@gmail.com,admin@neobim.com
```

---

### C2. API Keys Stored in Plaintext
**File:** `/api/user/api-keys/route.ts`  
**Issue:** OpenAI API keys stored directly in `user.apiKeys` JSON field without encryption

**Risk:**
- Database breach exposes all user API keys
- Violates PCI/SOC2 compliance requirements
- Users lose trust if keys are leaked

**Recommended Fix:**
1. Encrypt API keys at rest using AES-256
2. Use environment-based encryption key
3. Decrypt only in-memory when needed

**Implementation:**
```typescript
// lib/encryption.ts
import crypto from "crypto";

const ENCRYPTION_KEY = process.env.API_KEY_ENCRYPTION_KEY!; // 32-byte key
const ALGORITHM = "aes-256-gcm";

export function encryptApiKey(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, "hex"), iv);
  
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decryptApiKey(encrypted: string): string {
  const [ivHex, authTagHex, encryptedText] = encrypted.split(":");
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    Buffer.from(ENCRYPTION_KEY, "hex"),
    Buffer.from(ivHex, "hex")
  );
  
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  
  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}
```

**Update PATCH /api/user/api-keys:**
```typescript
import { encryptApiKey } from "@/lib/encryption";

const encryptedKeys = Object.entries(apiKeys).reduce((acc, [key, value]) => {
  acc[key] = encryptApiKey(value);
  return acc;
}, {} as Record<string, string>);

await prisma.user.update({
  where: { id: session.user.id },
  data: { apiKeys: encryptedKeys },
});
```

---

### C3. Missing Input Validation in API Key Update
**File:** `/api/user/api-keys/route.ts` (PATCH handler)  
**Issue:** No validation on `apiKeys` object structure or content

**Risk:**
- Arbitrary JSON can be stored (DoS via large payloads)
- Malicious scripts in key names
- Invalid API key formats accepted

**Recommended Fix:**
```typescript
import { z } from "zod";

const ApiKeysSchema = z.object({
  openai: z.string().startsWith("sk-").min(20).max(200).optional(),
  anthropic: z.string().startsWith("sk-ant-").optional(),
  // Add other providers as needed
}).strict(); // Reject unknown keys

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    
    // Validate structure
    const validatedKeys = ApiKeysSchema.parse(body.apiKeys);
    
    // Encrypt before storing
    const encryptedKeys = Object.entries(validatedKeys).reduce((acc, [key, value]) => {
      if (value) acc[key] = encryptApiKey(value);
      return acc;
    }, {} as Record<string, string>);

    await prisma.user.update({
      where: { id: session.user.id },
      data: { apiKeys: encryptedKeys },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid API key format", details: error.errors },
        { status: 400 }
      );
    }
    throw error;
  }
}
```

---

### C4. Ownership Verification Missing in Execution Update
**File:** `/api/executions/[id]/route.ts` (PUT handler)  
**Issue:** No ownership check before allowing status/result updates

**Current Code:**
```typescript
const execution = await prisma.execution.update({
  where: { id },
  data: { /* ... */ },
});
```

**Risk:**
- User A can update User B's execution by guessing ID
- Cross-user data poisoning
- Privacy violation

**Recommended Fix:**
```typescript
export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { status, tileResults, errorMessage, duration } = await req.json();

  // VERIFY OWNERSHIP FIRST
  const existing = await prisma.execution.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // NOW safe to update
  const execution = await prisma.execution.update({
    where: { id },
    data: {
      ...(status && { status }),
      ...(tileResults !== undefined && { tileResults }),
      ...(errorMessage !== undefined && { errorMessage }),
      ...(duration !== undefined && { tileResults: { ...(tileResults ?? {}), duration } }),
      ...(status && ["SUCCESS", "FAILED", "PARTIAL"].includes(status) && {
        completedAt: new Date(),
      }),
    },
  });

  return NextResponse.json({ execution });
}
```

---

## 🟠 HIGH SEVERITY ISSUES (Priority 2)

### H1. Rate Limiting Only on Execute-Node
**Files:** All routes except `/api/execute-node/route.ts`  
**Issue:** Only the execution endpoint has rate limiting; all CRUD endpoints are unprotected

**Risk:**
- Mass workflow creation (storage DoS)
- Execution history enumeration
- Brute-force attacks on auth

**Recommended Fix:**
Create middleware for global rate limiting:

```typescript
// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Global rate limit: 100 requests per minute per IP
const globalRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, "1 m"),
  prefix: "@neobim/global",
});

export async function middleware(request: NextRequest) {
  const ip = request.ip ?? request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  
  const { success, limit, remaining, reset } = await globalRateLimit.limit(ip);

  if (!success) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: Math.ceil((reset - Date.now()) / 1000) },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": limit.toString(),
          "X-RateLimit-Remaining": remaining.toString(),
          "X-RateLimit-Reset": reset.toString(),
        },
      }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
```

---

### H2. Missing Error Handling for Prisma Operations
**Files:** `/api/workflows/route.ts`, `/api/executions/route.ts`  
**Issue:** Prisma queries not wrapped in try-catch

**Example (workflows/route.ts GET):**
```typescript
const workflows = await prisma.workflow.findMany({
  where: { ownerId: session.user.id },
  // ... no error handling
});
```

**Risk:**
- Database errors leak internal structure
- Unhandled promise rejections crash server
- Poor user experience (500 errors with no context)

**Recommended Fix:**
```typescript
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const workflows = await prisma.workflow.findMany({
      where: { ownerId: session.user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        tags: true,
        isPublished: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { executions: true } },
      },
    });

    return NextResponse.json({ workflows });
  } catch (error) {
    console.error("[GET /api/workflows] Database error:", error);
    return NextResponse.json(
      { error: "Failed to fetch workflows" },
      { status: 500 }
    );
  }
}
```

---

### H3. No Request Body Size Limits
**All POST/PUT/PATCH Endpoints**  
**Issue:** No max body size validation allows DoS via large payloads

**Risk:**
- 100MB workflow JSON crashes server
- Memory exhaustion
- Network bandwidth abuse

**Recommended Fix:**
```typescript
// next.config.js
module.exports = {
  api: {
    bodyParser: {
      sizeLimit: "10mb", // Adjust based on IFC file needs
    },
  },
};
```

**Per-route validation:**
```typescript
// For workflow creation
const MAX_WORKFLOW_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(req: NextRequest) {
  const contentLength = req.headers.get("content-length");
  
  if (contentLength && parseInt(contentLength) > MAX_WORKFLOW_SIZE) {
    return NextResponse.json(
      { error: "Workflow data too large (max 5MB)" },
      { status: 413 }
    );
  }
  
  // ... rest of handler
}
```

---

### H4. Missing CORS Configuration
**Issue:** No CORS headers configured for cross-origin API access

**Risk:**
- Cannot integrate with external tools
- Mobile apps blocked
- Webhook integrations fail

**Recommended Fix:**
```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  
  // Allow specific origins (don't use "*" in production)
  const allowedOrigins = [
    "https://app.neobim.com",
    "https://preview.neobim.com",
    process.env.NODE_ENV === "development" ? "http://localhost:3000" : null,
  ].filter(Boolean);

  const origin = request.headers.get("origin");
  
  if (origin && allowedOrigins.includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.headers.set("Access-Control-Max-Age", "86400");
  }

  return response;
}
```

---

### H5. Password Validation Only on Client Side
**File:** `/api/auth/register/route.ts`  
**Issue:** Weak password requirements (only length check)

**Current Code:**
```typescript
if (password.length < 8) {
  return NextResponse.json(
    { error: "Password must be at least 8 characters" },
    { status: 400 }
  );
}
```

**Risk:**
- `password123` passes validation
- Dictionary attacks succeed easily
- No protection against common passwords

**Recommended Fix:**
```typescript
import { z } from "zod";

const PasswordSchema = z.string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password too long")
  .regex(/[a-z]/, "Password must contain lowercase letter")
  .regex(/[A-Z]/, "Password must contain uppercase letter")
  .regex(/[0-9]/, "Password must contain number")
  .regex(/[^a-zA-Z0-9]/, "Password must contain special character")
  .refine(
    (password) => {
      const common = ["password", "12345678", "qwerty", "admin"];
      return !common.some(p => password.toLowerCase().includes(p));
    },
    "Password too common"
  );

export async function POST(req: NextRequest) {
  try {
    const { name, email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Validate password strength
    PasswordSchema.parse(password);
    
    // ... rest of registration
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      );
    }
    // ... handle other errors
  }
}
```

---

### H6. No Input Validation on Workflow/Execution Creation
**Files:** `/api/workflows/route.ts`, `/api/executions/route.ts`  
**Issue:** Accept arbitrary JSON without schema validation

**Risk:**
- XSS via malicious workflow names
- SQL injection attempts in tags
- Invalid data crashes execution engine

**Recommended Fix:**
```typescript
import { z } from "zod";

const WorkflowCreateSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  description: z.string().max(500).optional(),
  tags: z.array(z.string().max(50)).max(10).default([]),
  tileGraph: z.object({
    nodes: z.array(z.any()).max(100), // Limit nodes
    edges: z.array(z.any()).max(200), // Limit edges
  }).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const validated = WorkflowCreateSchema.parse(body);

    const workflow = await prisma.workflow.create({
      data: {
        ownerId: session.user.id,
        name: validated.name,
        description: validated.description,
        tags: validated.tags,
        tileGraph: validated.tileGraph ?? { nodes: [], edges: [] },
      },
    });

    return NextResponse.json({ workflow }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.errors },
        { status: 400 }
      );
    }
    
    console.error("[POST /api/workflows] Error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
```

---

### H7. No Audit Logging for Sensitive Operations
**All Routes**  
**Issue:** No audit trail for API key changes, workflow deletions, admin actions

**Risk:**
- Cannot investigate security incidents
- Compliance failures (GDPR, SOC2)
- No accountability for destructive actions

**Recommended Fix:**
Create audit logging utility:

```typescript
// lib/audit.ts
import { prisma } from "@/lib/db";

export type AuditAction =
  | "USER_LOGIN"
  | "USER_REGISTER"
  | "WORKFLOW_CREATE"
  | "WORKFLOW_UPDATE"
  | "WORKFLOW_DELETE"
  | "EXECUTION_START"
  | "API_KEY_UPDATE"
  | "ADMIN_BYPASS";

export async function logAudit(
  userId: string,
  action: AuditAction,
  metadata?: Record<string, any>
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        metadata: metadata ?? {},
        ipAddress: metadata?.ipAddress,
        userAgent: metadata?.userAgent,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error("[AUDIT] Failed to log action:", error);
    // Don't throw - logging failures shouldn't break app
  }
}
```

**Usage in DELETE workflow:**
```typescript
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await prisma.workflow.findFirst({
    where: { id, ownerId: session.user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.workflow.delete({ where: { id } });

  // AUDIT LOG
  await logAudit(session.user.id, "WORKFLOW_DELETE", {
    workflowId: id,
    workflowName: existing.name,
    ipAddress: req.headers.get("x-forwarded-for") || req.ip,
  });

  return NextResponse.json({ success: true });
}
```

---

## 🟡 MEDIUM SEVERITY ISSUES (Priority 3)

### M1. Inconsistent Error Response Formats
**Files:** All routes  
**Issue:** Mix of `{ error: string }` and `formatErrorResponse()` patterns

**Examples:**
```typescript
// Pattern 1: Plain error
return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

// Pattern 2: Formatted error
return NextResponse.json(
  formatErrorResponse(UserErrors.UNAUTHORIZED),
  { status: 401 }
);
```

**Impact:**
- Frontend cannot reliably parse errors
- User experience inconsistency
- Harder to maintain error handling

**Recommended Fix:**
Standardize on ONE pattern across all routes. Prefer the formatted approach:

```typescript
// lib/api-response.ts
export function apiError(error: UserError, status: number = 500, details?: string) {
  return NextResponse.json(
    formatErrorResponse(error, details),
    { status }
  );
}

export function apiSuccess<T>(data: T, status: number = 200) {
  return NextResponse.json(data, { status });
}

// Usage
if (!session?.user?.id) {
  return apiError(UserErrors.UNAUTHORIZED, 401);
}

return apiSuccess({ workflows }, 200);
```

---

### M2. Missing Request ID Tracing
**All Routes**  
**Issue:** No correlation ID for debugging across microservices

**Impact:**
- Cannot trace user request through logs
- Debugging production issues is nightmare
- Slow incident response

**Recommended Fix:**
```typescript
// middleware.ts
import { nanoid } from "nanoid";

export function middleware(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || nanoid();
  
  const response = NextResponse.next();
  response.headers.set("x-request-id", requestId);
  
  // Store in AsyncLocalStorage for access in route handlers
  const store = { requestId };
  return runWithContext(store, () => response);
}

// In route handlers
console.log(`[${getRequestId()}] User ${userId} fetching workflows`);
```

---

### M3. No Timeout Configuration for Long Operations
**File:** `/api/execute-node/route.ts`  
**Issue:** OpenAI calls can hang indefinitely

**Risk:**
- Serverless function timeout (10s Vercel limit)
- Zombie requests consume resources
- Poor UX (user waits forever)

**Recommended Fix:**
```typescript
// services/openai.ts
import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30 * 1000, // 30 seconds
  maxRetries: 2,
});

// In route handler
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s (before 30s limit)

try {
  const description = await generateBuildingDescription(prompt, apiKey, {
    signal: controller.signal,
  });
  
  clearTimeout(timeoutId);
  // ... return artifact
} catch (error) {
  clearTimeout(timeoutId);
  
  if (error.name === "AbortError") {
    return apiError(UserErrors.REQUEST_TIMEOUT, 408);
  }
  
  throw error;
}
```

---

### M4. Environment Variables Not Validated at Startup
**Issue:** Missing vars fail silently at runtime

**Risk:**
- OpenAI key missing → first execution fails
- Redis URL wrong → rate limiting broken
- Database URL invalid → 500 errors

**Recommended Fix:**
```typescript
// lib/env.ts
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32),
  NEXTAUTH_URL: z.string().url(),
  OPENAI_API_KEY: z.string().startsWith("sk-"),
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  API_KEY_ENCRYPTION_KEY: z.string().length(64), // 32 bytes hex
  ADMIN_EMAILS: z.string().optional(),
});

export const env = EnvSchema.parse(process.env);

// In next.config.js
const { env } = require("./lib/env");
// Fails build if env vars missing
```

---

### M5. No Pagination on List Endpoints
**Files:** `/api/workflows/route.ts`, `/api/executions/route.ts`  
**Issue:** Fetches all records (potential memory exhaustion)

**Risk:**
- User with 10,000 workflows crashes browser
- Slow API responses
- Database load spikes

**Current (executions):**
```typescript
take: limit, // But limit defaults to 50
```

**Recommended Fix:**
```typescript
// Add cursor-based pagination
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return apiError(UserErrors.UNAUTHORIZED, 401);
  }

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor") || undefined;
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);

  const workflows = await prisma.workflow.findMany({
    where: { ownerId: session.user.id },
    orderBy: { updatedAt: "desc" },
    take: limit + 1, // Fetch one extra to check if more exist
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });

  const hasMore = workflows.length > limit;
  const items = hasMore ? workflows.slice(0, -1) : workflows;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return apiSuccess({ workflows: items, nextCursor, hasMore });
}
```

---

### M6. Execution Artifacts Not Validated Before Storage
**File:** `/api/executions/[id]/artifacts/route.ts`  
**Issue:** Accepts any JSON structure without validation

**Risk:**
- Malicious data injection
- Storage exhaustion (huge artifacts)
- Breaks execution viewer UI

**Recommended Fix:**
```typescript
import { z } from "zod";

const ArtifactSchema = z.object({
  nodeId: z.string().max(50),
  nodeLabel: z.string().max(100),
  type: z.enum(["text", "image", "table", "file", "3d"]),
  title: z.string().max(200),
  data: z.record(z.any()).refine(
    (data) => JSON.stringify(data).length < 1024 * 1024, // 1MB limit
    "Artifact data too large"
  ),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return apiError(UserErrors.UNAUTHORIZED, 401);
  }

  try {
    const body = await req.json();
    const validated = ArtifactSchema.parse(body);

    // ... rest of handler
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError(UserErrors.INVALID_INPUT, 400, error.errors[0].message);
    }
    throw error;
  }
}
```

---

### M7. No Cache-Control Headers
**All GET Endpoints**  
**Issue:** Every request hits database (unnecessary load)

**Impact:**
- Slow response times
- Database connection exhaustion
- Higher hosting costs

**Recommended Fix:**
```typescript
// For static data (workflow catalogue)
export async function GET() {
  const workflows = await fetchWorkflows();
  
  return NextResponse.json(
    { workflows },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    }
  );
}

// For user-specific data (my workflows)
export async function GET() {
  const workflows = await fetchUserWorkflows(userId);
  
  return NextResponse.json(
    { workflows },
    {
      headers: {
        "Cache-Control": "private, max-age=60", // 1 minute browser cache
      },
    }
  );
}
```

---

### M8. Bcrypt Rounds Hardcoded
**File:** `/api/auth/register/route.ts`  
**Issue:** `bcrypt.hash(password, 12)` - rounds not configurable

**Impact:**
- Cannot increase security as CPUs get faster
- Performance tuning requires code change

**Recommended Fix:**
```typescript
// lib/auth-config.ts
export const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || "12");

// auth/register/route.ts
import { BCRYPT_ROUNDS } from "@/lib/auth-config";

const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
```

**Environment:**
```env
BCRYPT_ROUNDS=12  # Increase to 14 for higher security
```

---

### M9. Missing Field-Level Permissions
**All Update Endpoints**  
**Issue:** Users can update fields they shouldn't (e.g., `version`, `createdAt`)

**Example (workflows/[id]/route.ts):**
```typescript
const workflow = await prisma.workflow.update({
  where: { id },
  data: {
    ...(name !== undefined && { name }),
    ...(description !== undefined && { description }),
    ...(tags !== undefined && { tags }),
    ...(tileGraph !== undefined && { tileGraph }),
    version: { increment: 1 }, // GOOD - controlled
  },
});
```

**Risk:**
- Malicious client sends `createdAt: "2020-01-01"` to game analytics
- `isPublished: true` bypasses approval workflow

**Recommended Fix:**
```typescript
// Define allowed update fields per role
const ALLOWED_WORKFLOW_FIELDS = {
  owner: ["name", "description", "tags", "tileGraph"],
  admin: ["name", "description", "tags", "tileGraph", "isPublished"],
};

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  const userRole = session.user.role || "owner";
  const allowedFields = ALLOWED_WORKFLOW_FIELDS[userRole];

  const body = await req.json();
  
  // Filter to only allowed fields
  const updates = Object.keys(body)
    .filter(key => allowedFields.includes(key))
    .reduce((obj, key) => {
      obj[key] = body[key];
      return obj;
    }, {} as Record<string, any>);

  const workflow = await prisma.workflow.update({
    where: { id },
    data: {
      ...updates,
      version: { increment: 1 },
    },
  });

  return apiSuccess({ workflow });
}
```

---

### M10. No HTTP Security Headers
**Issue:** Missing security headers (CSP, HSTS, X-Frame-Options)

**Risk:**
- XSS attacks
- Clickjacking
- Man-in-the-middle

**Recommended Fix:**
```typescript
// next.config.js
const securityHeaders = [
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-XSS-Protection",
    value: "1; mode=block",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy",
    value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline';",
  },
];

module.exports = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};
```

---

### M11. Database Connection Not Pooled
**File:** `/lib/db.ts` (assumed - not in review scope)  
**Issue:** Likely missing Prisma connection pooling config

**Risk:**
- "Too many connections" errors under load
- Slow cold starts

**Recommended Fix:**
```typescript
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  
  // Connection pooling
  relationMode = "prisma"
  poolSize = 10
}

// For serverless (Vercel/AWS Lambda)
// Use connection pooler like Prisma Data Proxy or PgBouncer
```

**Environment:**
```env
# Direct connection (for migrations)
DATABASE_URL="postgresql://user:pass@host:5432/neobim"

# Pooled connection (for app)
DATABASE_URL="postgresql://user:pass@pooler.host:6543/neobim?pgbouncer=true"
```

---

## 🟢 LOW SEVERITY ISSUES (Technical Debt)

### L1. Magic Numbers in Code
**Files:** Multiple  
**Examples:**
- `password.length < 8` (register)
- `take: limit ?? 50` (executions)
- `bcrypt.hash(password, 12)` (register)

**Recommended Fix:**
```typescript
// lib/constants.ts
export const APP_LIMITS = {
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_LENGTH: 128,
  WORKFLOW_NAME_MAX: 100,
  WORKFLOW_DESCRIPTION_MAX: 500,
  WORKFLOW_TAGS_MAX: 10,
  WORKFLOW_NODES_MAX: 100,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  BCRYPT_ROUNDS: 12,
  API_TIMEOUT_MS: 30000,
} as const;
```

---

### L2. Inconsistent HTTP Status Codes
**Issue:** Mix of 404/400 for "not found" scenarios

**Examples:**
- Workflow not found → 404 ✅
- Execution not found → 404 ✅
- Invalid node ID → 400 (should be 404?)

**Recommended Fix:**
Standardize on REST conventions:
- `400` - Bad request (malformed input)
- `401` - Unauthorized (not authenticated)
- `403` - Forbidden (authenticated but not allowed)
- `404` - Not found (resource doesn't exist)
- `409` - Conflict (email already registered)
- `422` - Unprocessable (valid format but business logic fails)

---

### L3. No API Versioning Strategy
**Issue:** All routes at `/api/*` - no version prefix

**Risk:**
- Breaking changes break all clients
- Cannot deprecate endpoints gracefully

**Recommended Fix:**
```typescript
// Immediate: Add version header acceptance
export async function GET(req: NextRequest) {
  const apiVersion = req.headers.get("x-api-version") || "1";
  
  if (apiVersion === "2") {
    // New behavior
    return apiSuccess({ workflows: newFormat });
  }
  
  // Legacy behavior
  return apiSuccess({ workflows: legacyFormat });
}

// Long-term: URL versioning
// /api/v1/workflows
// /api/v2/workflows
```

---

### L4. Missing OpenAPI/Swagger Documentation
**Issue:** No machine-readable API spec

**Impact:**
- Manual testing
- No API client generation
- Harder to onboard developers

**Recommended Fix:**
```bash
npm install next-swagger-doc swagger-ui-react

# Generate spec from JSDoc comments
```

```typescript
// pages/api-docs.tsx
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
import { getApiDocs } from "@/lib/swagger";

export default function ApiDocs() {
  const spec = getApiDocs();
  return <SwaggerUI spec={spec} />;
}
```

---

### L5. No Health Check Endpoint
**Issue:** No `/api/health` for monitoring

**Impact:**
- Cannot detect if API is down
- No readiness checks for K8s/Docker
- Harder to debug deployment issues

**Recommended Fix:**
```typescript
// app/api/health/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    // Check database
    await prisma.$queryRaw`SELECT 1`;
    
    // Check Redis (if critical)
    // await redis.ping();
    
    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || "unknown",
      environment: process.env.NODE_ENV,
      checks: {
        database: "ok",
        redis: "ok",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "unhealthy",
        error: error.message,
      },
      { status: 503 }
    );
  }
}
```

---

## 📋 Route-by-Route Summary

| Route | Auth | Rate Limit | Input Val | Error Handle | Severity |
|-------|------|------------|-----------|--------------|----------|
| **POST /api/execute-node** | ✅ | ✅ | ✅ | ✅ | 🔴 C1 (admin bypass) |
| **GET /api/executions** | ✅ | ❌ | ⚠️ | ⚠️ | 🟠 H1, M5 |
| **POST /api/executions** | ✅ | ❌ | ❌ | ⚠️ | 🟠 H1, H6 |
| **GET /api/executions/[id]** | ✅ | ❌ | N/A | ✅ | 🟠 H1 |
| **PUT /api/executions/[id]** | ✅ | ❌ | ❌ | ⚠️ | 🔴 C4 (ownership) |
| **POST /api/executions/[id]/artifacts** | ✅ | ❌ | ❌ | ✅ | 🟡 M6 |
| **GET /api/workflows** | ✅ | ❌ | N/A | ❌ | 🟠 H1, H2 |
| **POST /api/workflows** | ✅ | ❌ | ❌ | ⚠️ | 🟠 H1, H6 |
| **GET /api/workflows/[id]** | ✅ | ❌ | N/A | ✅ | 🟠 H1 |
| **PUT /api/workflows/[id]** | ✅ | ❌ | ❌ | ⚠️ | 🟡 M9 |
| **DELETE /api/workflows/[id]** | ✅ | ❌ | N/A | ✅ | 🟠 H7 (no audit) |
| **GET /api/user/api-keys** | ✅ | ❌ | N/A | ✅ | 🔴 C2 (plaintext) |
| **PATCH /api/user/api-keys** | ✅ | ❌ | ❌ | ⚠️ | 🔴 C2, C3 |
| **POST /api/auth/register** | N/A | ❌ | ⚠️ | ✅ | 🟠 H5 |
| **GET/POST /api/auth/[...nextauth]** | N/A | ❌ | ✅ | ✅ | ✅ (managed) |

**Legend:**
- ✅ = Implemented properly
- ⚠️ = Partial implementation
- ❌ = Missing
- N/A = Not applicable

---

## 🚀 Recommended Implementation Order

### Sprint 1 (Critical - Week 1)
1. **C1** - Move admin bypass to env var (1 hour)
2. **C2** - Encrypt API keys at rest (4 hours)
3. **C3** - Validate API key input (2 hours)
4. **C4** - Fix ownership check in executions (1 hour)

**Total:** ~1 day

---

### Sprint 2 (High - Week 1-2)
1. **H1** - Global rate limiting middleware (4 hours)
2. **H2** - Wrap Prisma in try-catch (2 hours)
3. **H5** - Strengthen password validation (2 hours)
4. **H6** - Add Zod schemas for inputs (4 hours)
5. **H7** - Implement audit logging (6 hours)

**Total:** ~2.5 days

---

### Sprint 3 (Medium - Week 2-3)
1. **M1** - Standardize error responses (3 hours)
2. **M3** - Add operation timeouts (2 hours)
3. **M4** - Validate env vars at startup (2 hours)
4. **M5** - Implement pagination (4 hours)
5. **M10** - Add security headers (1 hour)

**Total:** ~1.5 days

---

### Sprint 4 (Low - Week 3-4)
1. **L1** - Extract constants (1 hour)
2. **L3** - Add API versioning (3 hours)
3. **L5** - Create health check endpoint (1 hour)
4. Documentation updates (2 hours)

**Total:** ~1 day

---

## 📊 Testing Recommendations

### Security Tests to Add
```typescript
// __tests__/api/security.test.ts

describe("API Security", () => {
  it("rejects requests without auth", async () => {
    const res = await fetch("/api/workflows");
    expect(res.status).toBe(401);
  });

  it("prevents IDOR attacks", async () => {
    const user1Token = await getToken("user1");
    const user2Workflow = await createWorkflow("user2");
    
    const res = await fetch(`/api/workflows/${user2Workflow.id}`, {
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    
    expect(res.status).toBe(404); // Not 403 - don't leak existence
  });

  it("enforces rate limits", async () => {
    const token = await getToken("free-user");
    
    // Make 4 requests (limit is 3/day)
    for (let i = 0; i < 4; i++) {
      const res = await fetch("/api/execute-node", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ catalogueId: "TR-003", inputData: {} }),
      });
      
      if (i < 3) {
        expect(res.status).toBe(200);
      } else {
        expect(res.status).toBe(429);
        expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
      }
    }
  });

  it("sanitizes error messages", async () => {
    const res = await fetch("/api/workflows/invalid-uuid");
    const body = await res.json();
    
    // Should NOT expose internal errors
    expect(body.error).not.toContain("Prisma");
    expect(body.error).not.toContain("database");
  });

  it("validates API key format", async () => {
    const token = await getToken();
    
    const res = await fetch("/api/user/api-keys", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        apiKeys: { openai: "invalid-key-format" },
      }),
    });
    
    expect(res.status).toBe(400);
  });
});
```

---

## 🔍 Monitoring & Alerting

### Metrics to Track
```typescript
// lib/metrics.ts
import { Counter, Histogram } from "prom-client";

export const apiRequestDuration = new Histogram({
  name: "api_request_duration_seconds",
  help: "API request duration in seconds",
  labelNames: ["method", "route", "status"],
});

export const rateLimitHits = new Counter({
  name: "rate_limit_hits_total",
  help: "Number of rate limit hits",
  labelNames: ["tier"],
});

export const authFailures = new Counter({
  name: "auth_failures_total",
  help: "Number of authentication failures",
  labelNames: ["reason"],
});
```

### Alerts to Configure
- **Rate limit hit rate > 10/min** → Potential attack
- **Auth failure rate > 50/min** → Brute force attempt
- **API error rate > 5%** → System degradation
- **API P95 latency > 2s** → Performance issue

---

## 📚 Additional Resources

### Security Best Practices
- [OWASP API Security Top 10](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)
- [Next.js Security Headers](https://nextjs.org/docs/app/building-your-application/configuring/security-headers)
- [Prisma Security Best Practices](https://www.prisma.io/docs/concepts/components/prisma-client/security)

### Rate Limiting
- [Upstash Rate Limiting](https://upstash.com/docs/redis/features/rate-limiting)
- [Token Bucket Algorithm](https://en.wikipedia.org/wiki/Token_bucket)

### Input Validation
- [Zod Documentation](https://zod.dev/)
- [OWASP Input Validation](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)

---

## ✅ Sign-Off

**Prepared by:** Backend GOAT (Chhawa)  
**Review Date:** March 5, 2026  
**Next Review:** Post-implementation (after Sprint 2)  
**Approved for:** Development Team

---

**END OF REPORT**
