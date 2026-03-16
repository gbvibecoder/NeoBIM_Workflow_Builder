import { test, expect } from "@playwright/test";

test.describe("Landing Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should load and display hero section", async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/BuildFlow/i);

    // Hero heading should be visible
    await expect(page.getByText("3D CONCEPTS")).toBeVisible();
    await expect(page.getByText("IN MINUTES")).toBeVisible();
  });

  test("should have navigation links", async ({ page }) => {
    // Navbar should have key links
    await expect(page.getByRole("link", { name: /login/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /sign up/i })).toBeVisible();
  });

  test("should have CTA buttons", async ({ page }) => {
    // Primary CTAs
    await expect(page.getByRole("link", { name: /get started/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /try demo/i })).toBeVisible();
  });

  test("should navigate to login page", async ({ page }) => {
    await page.getByRole("link", { name: /login/i }).first().click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("should navigate to demo page", async ({ page }) => {
    await page.getByRole("link", { name: /try demo/i }).first().click();
    await expect(page).toHaveURL(/\/demo/);
  });

  test("should have pricing section", async ({ page }) => {
    // Scroll down to pricing
    const pricing = page.getByText(/pricing/i).first();
    await expect(pricing).toBeVisible();
  });

  test("should be responsive on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    // Page should still load
    await expect(page).toHaveTitle(/BuildFlow/i);
  });
});
