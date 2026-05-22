/**
 * Vision Inspector — fixable + recommended_patch_type tests (Phase Beta 3).
 */

import { describe, it, expect } from "vitest";
import { visionIssueSchema, visionReportSchema } from "../types";

describe("Vision Inspector — fixability fields", () => {
  it("visionIssueSchema accepts fixable + recommended_patch_type", () => {
    const issue = {
      severity: "med",
      type: "collapsed",
      description: "Cutting table appears as single box",
      affected_element: "FURN-CUTTABLE",
      fixable: true,
      recommended_patch_type: "force_parts",
    };
    const result = visionIssueSchema.safeParse(issue);
    expect(result.success).toBe(true);
    expect(result.data?.fixable).toBe(true);
    expect(result.data?.recommended_patch_type).toBe("force_parts");
  });

  it("visionIssueSchema defaults fixable to true when omitted", () => {
    const issue = {
      severity: "low",
      type: "positioning",
      description: "Slightly off center",
    };
    const result = visionIssueSchema.safeParse(issue);
    expect(result.success).toBe(true);
    expect(result.data?.fixable).toBe(true);
    expect(result.data?.recommended_patch_type).toBeUndefined();
  });

  it("manual_review issues do not recommend auto-patchable types", () => {
    const issue = {
      severity: "high",
      type: "other",
      description: "Brief describes 3 floors but building has 1",
      fixable: false,
      recommended_patch_type: "manual_review",
    };
    const result = visionIssueSchema.safeParse(issue);
    expect(result.success).toBe(true);
    expect(result.data?.fixable).toBe(false);
    expect(result.data?.recommended_patch_type).toBe("manual_review");
  });

  it("full vision report with fixable issues validates", () => {
    const report = {
      quality_score: 55,
      pass: false,
      issues: [
        {
          severity: "high",
          type: "collapsed",
          description: "Sewing machine is single box",
          affected_element: "FURN-SEWING",
          fixable: true,
          recommended_patch_type: "force_parts",
        },
        {
          severity: "med",
          type: "missing",
          description: "Skirting not visible",
          fixable: true,
          recommended_patch_type: "add_trim",
        },
      ],
      summary: "Multiple items collapsed; rebuild recommended",
      inspected_at: "2026-05-18T12:00:00Z",
    };
    const result = visionReportSchema.safeParse(report);
    expect(result.success).toBe(true);
    expect(result.data?.issues).toHaveLength(2);
    expect(result.data?.issues[0].recommended_patch_type).toBe("force_parts");
  });
});
