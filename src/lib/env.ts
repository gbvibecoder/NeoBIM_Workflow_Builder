/**
 * Environment variable validation.
 *
 * Designed to fail fast on Node.js boot via instrumentation.ts so deployment
 * misconfigurations surface immediately instead of producing mysterious
 * runtime errors deep inside an API route.
 *
 * THREE TIERS:
 *   REQUIRED    — app cannot start without these (validateEnv() throws)
 *   RECOMMENDED — features degrade gracefully (warns at startup, doesn't throw)
 *   OPTIONAL    — silent (only documented here for type completeness)
 *
 * USAGE:
 *   import { validateEnv } from '@/lib/env';
 *   validateEnv(); // call from instrumentation.ts at startup
 *
 *   // Other modules can also import the typed env object:
 *   import { env } from '@/lib/env';
 *   env.DATABASE_URL // type-safe
 *
 * IMPORTANT: validateEnv() is a function — it is NOT called at module import.
 * This keeps test suites working: tests set process.env in `beforeAll` hooks
 * AFTER modules are imported, so any import-time validation would crash them.
 */

import { z } from "zod";

// ─── Schemas ────────────────────────────────────────────────────────────────

const requiredSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (Neon Postgres connection string)"),
  NEXTAUTH_SECRET: z
    .string()
    .min(16, "NEXTAUTH_SECRET must be at least 16 chars (run: openssl rand -base64 32)"),
  NEXTAUTH_URL: z
    .string()
    .min(1, "NEXTAUTH_URL is required (e.g. http://localhost:3000 or your production domain)"),
});

const recommendedSchema = z.object({
  // AI providers
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  // Video generation
  KLING_ACCESS_KEY: z.string().optional(),
  KLING_SECRET_KEY: z.string().optional(),
  // Floor plan ML service
  ML_SERVICE_URL: z.string().optional(),
  // Object storage
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  // Rate limiting
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
});

const optionalSchema = z.object({
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_GTM_ID: z.string().optional(),
  NEXT_PUBLIC_GA_MEASUREMENT_ID: z.string().optional(),
  NEXT_PUBLIC_GOOGLE_ADS_ID: z.string().optional(),
  NEXT_PUBLIC_CLARITY_PROJECT_ID: z.string().optional(),
  META_CAPI_ACCESS_TOKEN: z.string().optional(),
  FAL_KEY: z.string().optional(),
  MESHY_API_KEY: z.string().optional(),
});

// Razorpay env vars are validated by validateRazorpayEnv() (runs inside
// validateEnv at boot). Declared here so the typed `env` proxy exposes them.
const razorpaySchema = z.object({
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  NEXT_PUBLIC_RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_MINI_PLAN_ID: z.string().optional(),
  RAZORPAY_STARTER_PLAN_ID: z.string().optional(),
  RAZORPAY_PRO_PLAN_ID: z.string().optional(),
  RAZORPAY_TEAM_PLAN_ID: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
});

// ─── Types ──────────────────────────────────────────────────────────────────

export type RequiredEnv = z.infer<typeof requiredSchema>;
export type RecommendedEnv = z.infer<typeof recommendedSchema>;
export type OptionalEnv = z.infer<typeof optionalSchema>;
export type RazorpayEnv = z.infer<typeof razorpaySchema>;
export type Env = RequiredEnv & RecommendedEnv & OptionalEnv & RazorpayEnv;

// ─── Validation ─────────────────────────────────────────────────────────────

interface RecommendedFeatureCheck {
  feature: string;
  envVars: readonly (keyof RecommendedEnv)[];
  whatBreaks: string;
}

const RECOMMENDED_FEATURES: readonly RecommendedFeatureCheck[] = [
  {
    feature: "Floor plan analysis (TR-004) and concept renders (GN-003)",
    envVars: ["OPENAI_API_KEY"],
    whatBreaks: "GPT-4o vision and DALL-E 3 will not run; nodes return mock data",
  },
  {
    feature: "Floor plan vision analysis (Claude path)",
    envVars: ["ANTHROPIC_API_KEY"],
    whatBreaks: "Claude Sonnet vision falls back to GPT-4o only",
  },
  {
    feature: "Cinematic video walkthrough (GN-009 via Kling AI)",
    envVars: ["KLING_ACCESS_KEY", "KLING_SECRET_KEY"],
    whatBreaks: "Video generation falls back to client-side Three.js renderer",
  },
  {
    feature: "ML wall detection (CubiCasa5K) for floor plans",
    envVars: ["ML_SERVICE_URL"],
    whatBreaks: "TR-004 wall detection degrades to GPT-4o only — lower accuracy",
  },
  {
    feature: "Asset storage (Cloudflare R2)",
    envVars: [
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET_NAME",
      "R2_ACCOUNT_ID",
    ],
    whatBreaks:
      "PDF reports, 3D models, generated images, and videos cannot be persisted; large artifacts may exceed response size limits",
  },
  {
    feature: "Rate limiting and per-tier quotas",
    envVars: ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    whatBreaks:
      "Per-user rate limits cannot be enforced; in production this fails closed (rate limit checks block) — DO NOT deploy without Redis",
  },
];

function isFeatureConfigured(
  raw: Record<string, string | undefined>,
  envVars: readonly (keyof RecommendedEnv)[],
): boolean {
  return envVars.every((v) => {
    const value = raw[v];
    return typeof value === "string" && value.trim().length > 0;
  });
}

let cachedEnv: Env | null = null;
let validationRan = false;

/**
 * Validate environment variables. Throws on missing required vars.
 * Logs a yellow ⚠️ warning for missing recommended vars.
 *
 * Idempotent — safe to call multiple times. Only the first call runs the
 * full check; subsequent calls return immediately.
 */
export function validateEnv(): Env {
  if (validationRan && cachedEnv) return cachedEnv;
  validationRan = true;

  const raw = process.env;

  // ── REQUIRED ────────────────────────────────────────────────────────
  const requiredResult = requiredSchema.safeParse(raw);
  if (!requiredResult.success) {
    const issues = requiredResult.error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        return `  • ${path}: ${issue.message}`;
      })
      .join("\n");
    const errMsg =
      "\n❌ ENVIRONMENT VALIDATION FAILED — required variables are missing or invalid:\n\n" +
      issues +
      "\n\n" +
      "Fix: copy .env.example to .env.local and fill in the values, then restart the server.\n";
    // Surface clearly to anyone tailing logs
    console.error(errMsg);
    throw new Error(errMsg);
  }

  // ── RECOMMENDED ─────────────────────────────────────────────────────
  const missingFeatures: RecommendedFeatureCheck[] = [];
  for (const feature of RECOMMENDED_FEATURES) {
    if (!isFeatureConfigured(raw, feature.envVars)) {
      missingFeatures.push(feature);
    }
  }

  if (missingFeatures.length > 0) {
    const lines: string[] = [
      "",
      "⚠️  ENV: Recommended variables are missing — features will degrade gracefully:",
      "",
    ];
    for (const f of missingFeatures) {
      lines.push(`  • ${f.feature}`);
      lines.push(`      missing: ${f.envVars.join(", ")}`);
      lines.push(`      impact:  ${f.whatBreaks}`);
    }
    lines.push("");
    lines.push("Set these in .env.local or your hosting platform's env settings.");
    lines.push("");
    // eslint-disable-next-line no-console
    console.warn(lines.join("\n"));
  }

  // ── RAZORPAY ────────────────────────────────────────────────────────
  validateRazorpayEnv(raw);

  // OPTIONAL — silent. We still parse to populate the typed env object.
  const recommended = recommendedSchema.parse(raw);
  const optional = optionalSchema.parse(raw);
  const razorpay = razorpaySchema.parse(raw);

  cachedEnv = {
    ...requiredResult.data,
    ...recommended,
    ...optional,
    ...razorpay,
  };

  return cachedEnv;
}

// ─── Razorpay env validation ────────────────────────────────────────────────
//
// In production: missing required vars throw (deployment is broken — fail loud).
// In dev:        missing vars warn (so contributors can run without Razorpay).
// Always:        if both keys are present and prefix-modes disagree, throw.
//                A live/test mismatch silently wedges the entire payment flow
//                ("Payment Failed" inside the Razorpay modal) and is the exact
//                regression that motivated this validator.

const RAZORPAY_REQUIRED_KEYS = [
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "NEXT_PUBLIC_RAZORPAY_KEY_ID",
  "RAZORPAY_WEBHOOK_SECRET",
] as const;

const RAZORPAY_REQUIRED_PLAN_IDS = [
  "RAZORPAY_MINI_PLAN_ID",
  "RAZORPAY_STARTER_PLAN_ID",
  "RAZORPAY_PRO_PLAN_ID",
  "RAZORPAY_TEAM_PLAN_ID",
] as const;

function razorpayKeyMode(key: string | undefined): "live" | "test" | "unknown" {
  if (!key) return "unknown";
  if (key.startsWith("rzp_live_")) return "live";
  if (key.startsWith("rzp_test_")) return "test";
  return "unknown";
}

export function validateRazorpayEnv(raw: NodeJS.ProcessEnv): void {
  const isProd = raw.NODE_ENV === "production";

  const missingKeys = RAZORPAY_REQUIRED_KEYS.filter(
    (k) => !raw[k] || raw[k]!.trim().length === 0,
  );
  const missingPlans = RAZORPAY_REQUIRED_PLAN_IDS.filter(
    (k) => !raw[k] || raw[k]!.trim().length === 0,
  );

  if (missingKeys.length > 0 || missingPlans.length > 0) {
    const lines: string[] = [];
    if (missingKeys.length > 0) {
      lines.push(`  • Missing keys/secrets: ${missingKeys.join(", ")}`);
    }
    if (missingPlans.length > 0) {
      lines.push(`  • Missing plan IDs: ${missingPlans.join(", ")}`);
    }

    if (isProd) {
      const errMsg =
        "\n❌ RAZORPAY ENV VALIDATION FAILED:\n\n" +
        lines.join("\n") +
        "\n\nRazorpay checkout is broken without these. Set them in Vercel → " +
        "Settings → Environment Variables (Production), then redeploy.\n";
      console.error(errMsg);
      throw new Error(errMsg);
    } else {
      console.warn(
        [
          "",
          "⚠️  Razorpay env vars missing (dev) — payment flow will fail at runtime:",
          ...lines,
          "",
        ].join("\n"),
      );
    }
  }

  // Mode-parity assertion — always enforced when both keys are present.
  // A mismatch is the textbook cause of the production "Payment Failed" modal.
  const serverKey = raw.RAZORPAY_KEY_ID;
  const clientKey = raw.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  if (serverKey && clientKey) {
    const serverMode = razorpayKeyMode(serverKey);
    const clientMode = razorpayKeyMode(clientKey);
    if (serverMode !== clientMode) {
      const errMsg =
        "\n❌ RAZORPAY KEY MODE MISMATCH:\n\n" +
        `  • RAZORPAY_KEY_ID            is "${serverMode}" mode (prefix: ${serverKey.slice(0, 9)}…)\n` +
        `  • NEXT_PUBLIC_RAZORPAY_KEY_ID is "${clientMode}" mode (prefix: ${clientKey.slice(0, 9)}…)\n\n` +
        "Both keys MUST share the same prefix (rzp_live_ or rzp_test_).\n" +
        "Mixing modes silently wedges checkout — server creates the\n" +
        "subscription with one key, the modal opens with the other,\n" +
        "and Razorpay rejects it as 'Payment Failed'. Fix in Vercel env.\n";
      console.error(errMsg);
      throw new Error(errMsg);
    }
  }
}

/**
 * Lazy-initialised typed view of validated env vars.
 * Tests that mock process.env in beforeAll() should NOT touch this — it
 * triggers validation which may throw if mocks are incomplete.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    if (!cachedEnv) {
      // If validateEnv hasn't run, fall back to raw process.env so we never
      // hard-fail at runtime in code paths that don't care about validation.
      return process.env[prop];
    }
    return cachedEnv[prop as keyof Env];
  },
});
