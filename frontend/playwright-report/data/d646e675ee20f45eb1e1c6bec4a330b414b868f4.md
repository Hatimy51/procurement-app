# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: app-flow.spec.ts >> App Navigation Suite >> navigates to Receiving Queue (Store)
- Location: e2e\app-flow.spec.ts:57:3

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('main')
Expected substring: "Receiving Queue"
Received string:    "Internal Server Error"
Timeout: 8000ms

Call log:
  - Expect "toContainText" with timeout 8000ms
  - waiting for locator('main')
    2 × locator resolved to <main>…</main>
      - unexpected value "Loading receiving queue…"
    17 × locator resolved to <main>…</main>
       - unexpected value "Internal Server Error"

```

```yaml
- main: Internal Server Error
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | // Helper: log in as manager using seeded e2e_manager@example.com credentials
  4  | async function loginAsManager(page) {
  5  |   await page.goto('/');
  6  |   await expect(page.locator('h1')).toBeVisible({ timeout: 10000 });
  7  | 
  8  |   const title = await page.locator('h1').textContent();
  9  |   const isSetup = title?.includes('Set up');
  10 | 
  11 |   if (isSetup) {
  12 |     // If setup screen appears on a clean database, complete setup
  13 |     await page.locator('input').nth(0).fill('E2E Manager');
  14 |     await page.locator('input[type="email"]').fill('e2e_manager@example.com');
  15 |     await page.locator('input[type="password"]').fill('Pass123!');
  16 |   } else {
  17 |     // Normal login
  18 |     await page.locator('input[type="email"]').fill('e2e_manager@example.com');
  19 |     await page.locator('input[type="password"]').fill('Pass123!');
  20 |   }
  21 | 
  22 |   await page.locator('button[type="submit"]').click();
  23 | 
  24 |   // Wait for sidebar (<aside>) to be visible, confirming successful login
  25 |   await expect(page.locator('aside')).toBeVisible({ timeout: 10000 });
  26 | }
  27 | 
  28 | test.describe('Login & Authentication', () => {
  29 |   test('shows setup or login form on initial load', async ({ page }) => {
  30 |     await page.goto('/');
  31 |     await expect(page.locator('h1')).toBeVisible({ timeout: 10000 });
  32 |     const title = await page.locator('h1').textContent();
  33 |     expect(title).toBeTruthy();
  34 |   });
  35 | 
  36 |   test('successfully logs in and displays sidebar navigation', async ({ page }) => {
  37 |     await loginAsManager(page);
  38 |     await expect(page.locator('aside')).toBeVisible();
  39 |   });
  40 | });
  41 | 
  42 | test.describe('App Navigation Suite', () => {
  43 |   test.beforeEach(async ({ page }) => {
  44 |     await loginAsManager(page);
  45 |   });
  46 | 
  47 |   test('navigates to Suppliers screen', async ({ page }) => {
  48 |     await page.locator('aside button', { hasText: 'Suppliers' }).click();
  49 |     await expect(page.locator('main')).toContainText('Suppliers', { timeout: 8000 });
  50 |   });
  51 | 
  52 |   test('navigates to Purchase Orders screen', async ({ page }) => {
  53 |     await page.locator('aside button', { hasText: 'Purchase Orders' }).click();
  54 |     await expect(page.locator('main')).toContainText('Purchase Orders', { timeout: 8000 });
  55 |   });
  56 | 
  57 |   test('navigates to Receiving Queue (Store)', async ({ page }) => {
  58 |     await page.locator('aside button', { hasText: 'Receiving Queue' }).click();
> 59 |     await expect(page.locator('main')).toContainText('Receiving Queue', { timeout: 8000 });
     |                                        ^ Error: expect(locator).toContainText(expected) failed
  60 |   });
  61 | 
  62 |   test('navigates to Executive Dashboard', async ({ page }) => {
  63 |     await page.locator('aside button', { hasText: 'Executive Dashboard' }).click();
  64 |     await expect(page.locator('main')).toContainText('Dashboard', { timeout: 8000 });
  65 |   });
  66 | 
  67 |   test('navigates to Team Chat', async ({ page }) => {
  68 |     await page.locator('aside button', { hasText: 'Team Chat' }).click();
  69 |     await expect(page.locator('main')).toContainText('Chat', { timeout: 8000 });
  70 |   });
  71 | });
  72 | 
```