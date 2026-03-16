import { test, expect } from "@playwright/test";

test.describe("Login Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("should display login form", async ({ page }) => {
    await expect(page.getByText(/welcome back/i)).toBeVisible();
    await expect(page.getByPlaceholder(/you@example\.com/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("should have Google OAuth button", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /continue with google/i })
    ).toBeVisible();
  });

  test("should have link to register page", async ({ page }) => {
    await expect(page.getByRole("link", { name: /create account/i })).toBeVisible();
  });

  test("should navigate to register page", async ({ page }) => {
    await page.getByRole("link", { name: /create account/i }).click();
    await expect(page).toHaveURL(/\/register/);
  });

  test("should show password toggle", async ({ page }) => {
    const passwordInput = page.getByPlaceholder(/••••/);
    await expect(passwordInput).toHaveAttribute("type", "password");
  });

  test("should show validation on empty submit", async ({ page }) => {
    await page.getByRole("button", { name: /sign in/i }).click();
    // Page should stay on login (no redirect)
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Register Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/register");
  });

  test("should display register form", async ({ page }) => {
    await expect(page.getByText(/create your account/i)).toBeVisible();
    await expect(page.getByPlaceholder(/you@example\.com/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /create account/i })
    ).toBeVisible();
  });

  test("should have Google OAuth button", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /continue with google/i })
    ).toBeVisible();
  });

  test("should have link to login page", async ({ page }) => {
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
  });

  test("should show password requirements", async ({ page }) => {
    await expect(page.getByText(/min 8 characters/i)).toBeVisible();
  });
});

test.describe("Auth Redirects", () => {
  test("should redirect /dashboard to login when not authenticated", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    // Should redirect to login
    await expect(page).toHaveURL(/\/(login|auth)/);
  });
});
