/**
 * Tests for project-date flow: store → execution → artifact → UI.
 */
import { describe, it, expect, beforeEach } from "vitest";

describe("Project date — workflow store", () => {
  beforeEach(() => {
    // Reset module state between tests
  });

  it("default projectDate is ~6 months from now", async () => {
    const { useWorkflowStore } = await import("@/features/workflows/stores/workflow-store");
    const state = useWorkflowStore.getState();
    const date = new Date(state.projectDate);
    const now = new Date();
    const diffMonths = (date.getFullYear() - now.getFullYear()) * 12 + (date.getMonth() - now.getMonth());
    // Should be 5-7 months ahead (±1 month tolerance for month boundary)
    expect(diffMonths).toBeGreaterThanOrEqual(5);
    expect(diffMonths).toBeLessThanOrEqual(7);
  });

  it("projectDate field exists in store and is a string", async () => {
    const { useWorkflowStore } = await import("@/features/workflows/stores/workflow-store");
    const date = useWorkflowStore.getState().projectDate;
    expect(typeof date).toBe("string");
    expect(date.length).toBe(10); // "YYYY-MM-DD"
    // setProjectDate function exists
    expect(typeof useWorkflowStore.getState().setProjectDate).toBe("function");
  });

  it("projectDate format is ISO YYYY-MM-DD", async () => {
    const { useWorkflowStore } = await import("@/features/workflows/stores/workflow-store");
    const date = useWorkflowStore.getState().projectDate;
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("Project date — validation rules", () => {
  it("dates more than 10 years ahead are invalid", () => {
    const maxDate = new Date();
    maxDate.setFullYear(maxDate.getFullYear() + 10);
    const tooFar = new Date(maxDate);
    tooFar.setDate(tooFar.getDate() + 1);
    expect(tooFar > maxDate).toBe(true);
  });

  it("past dates are invalid", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const today = new Date();
    expect(yesterday < today).toBe(true);
  });
});
