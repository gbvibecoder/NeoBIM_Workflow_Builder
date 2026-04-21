import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Phase 2.0a: exhaustive-deps escalated to error. The stale-closure
  // bug that shipped to prod on 2026-04-20 (FloorPlanViewer.tsx line
  // 227, captured featureFlags.vipJobsEnabled=false from pre-fetch)
  // would have been caught here. Pre-existing disable comments remain
  // silenced; this rule only fires on NEW violations.
  {
    rules: {
      "react-hooks/exhaustive-deps": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Non-app directories that shouldn't block CI:
    "scripts/**",
    "coverage/**",
    "tests/**",
  ]),
]);

export default eslintConfig;
