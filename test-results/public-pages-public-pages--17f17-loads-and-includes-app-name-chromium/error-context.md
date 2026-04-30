# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: public-pages.spec.ts >> public pages >> landing page loads and includes app name
- Location: tests/e2e/public-pages.spec.ts:10:7

# Error details

```
Error: expect(page).toHaveTitle(expected) failed

Expected pattern: /microfill/i
Received string:  "Create Next App"
Timeout: 5000ms

Call log:
  - Expect "toHaveTitle" with timeout 5000ms
    9 × unexpected value "Create Next App"

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - heading "soloSoftwareDev LLC Presents" [level=2] [ref=e4]
    - heading "Eliminate Shadow Inventory." [level=1] [ref=e5]
    - paragraph [ref=e6]: The lightweight, security-first sync tool for micro-fulfillment. Stop manual tallying. Scan in, sync out, and never oversell again.
    - generic [ref=e7]:
      - textbox "Enter your work email" [ref=e8]
      - button "Request Pilot Access" [ref=e9]
    - generic [ref=e10]:
      - generic [ref=e11]: ✓ Shopify Verified
      - generic [ref=e12]: ✓ AES-256 Encrypted
      - generic [ref=e13]: ✓ Mobile Native
  - alert [ref=e14]
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | 
  3  | /**
  4  |  * Public page structure tests — no authentication required.
  5  |  * These verify that the app is reachable and renders the expected
  6  |  * top-level structure without any logged-in session.
  7  |  */
  8  | 
  9  | test.describe("public pages", () => {
  10 |   test("landing page loads and includes app name", async ({ page }) => {
  11 |     await page.goto("/");
> 12 |     await expect(page).toHaveTitle(/microfill/i);
     |                        ^ Error: expect(page).toHaveTitle(expected) failed
  13 |   });
  14 | 
  15 |   test("login page is accessible at /login", async ({ page }) => {
  16 |     await page.goto("/login");
  17 |     // Expect an input for the user's email
  18 |     const emailInput = page.getByRole("textbox", { name: /email/i });
  19 |     await expect(emailInput).toBeVisible();
  20 |   });
  21 | 
  22 |   test("unauthenticated requests to /dashboard redirect to login", async ({
  23 |     page,
  24 |   }) => {
  25 |     const response = await page.goto("/dashboard");
  26 |     // Should end up on the login page (redirect chain)
  27 |     await expect(page).toHaveURL(/\/login/);
  28 |     // Response should be a redirect, not a 500
  29 |     expect(response?.status()).not.toBe(500);
  30 |   });
  31 | 
  32 |   test("unauthenticated requests to /onboarding redirect to login", async ({
  33 |     page,
  34 |   }) => {
  35 |     await page.goto("/onboarding");
  36 |     await expect(page).toHaveURL(/\/login/);
  37 |   });
  38 | });
  39 | 
```