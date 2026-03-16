import { test, expect } from "@playwright/test";

test.describe("Demo Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demo");
  });

  test("should load demo page with banner", async ({ page }) => {
    await expect(page.getByText(/LIVE DEMO/i)).toBeVisible();
    await expect(page.getByText(/BuildFlow/i).first()).toBeVisible();
  });

  test("should display workflow canvas", async ({ page }) => {
    // The canvas area should be present (React Flow container)
    const canvas = page.locator(".react-flow");
    await expect(canvas).toBeVisible({ timeout: 10000 });
  });

  test("should have pre-loaded workflow nodes", async ({ page }) => {
    // Wait for React Flow to render nodes
    const nodes = page.locator(".react-flow__node");
    await expect(nodes.first()).toBeVisible({ timeout: 10000 });
  });

  test("should show demo instructions", async ({ page }) => {
    // Demo should show instructions about running the workflow
    await expect(
      page.getByText(/run/i).first()
    ).toBeVisible();
  });
});
