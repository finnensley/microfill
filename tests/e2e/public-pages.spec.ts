import { test, expect } from "@playwright/test";

/**
 * Public page structure tests — no authentication required.
 * These verify that the app is reachable and renders the expected
 * top-level structure without any logged-in session.
 */

test.describe("public pages", () => {
  test("landing page loads and includes app name", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/microfill/i);
  });

  test("login page is accessible at /login", async ({ page }) => {
    await page.goto("/login");
    // Expect an input for the user's email
    const emailInput = page.getByRole("textbox", { name: /email/i });
    await expect(emailInput).toBeVisible();
  });

  test("unauthenticated requests to /dashboard redirect to login", async ({
    page,
  }) => {
    const response = await page.goto("/dashboard");
    // Should end up on the login page (redirect chain)
    await expect(page).toHaveURL(/\/login/);
    // Response should be a redirect, not a 500
    expect(response?.status()).not.toBe(500);
  });

  test("unauthenticated requests to /onboarding redirect to login", async ({
    page,
  }) => {
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/login/);
  });
});
