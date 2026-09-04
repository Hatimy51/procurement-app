import { test, expect } from '@playwright/test';

// Helper: log in as manager using seeded e2e_manager@example.com credentials
async function loginAsManager(page) {
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible({ timeout: 10000 });

  const title = await page.locator('h1').textContent();
  const isSetup = title?.includes('Set up');

  if (isSetup) {
    // If setup screen appears on a clean database, complete setup
    await page.locator('input').nth(0).fill('E2E Manager');
    await page.locator('input[type="email"]').fill('e2e_manager@example.com');
    await page.locator('input[type="password"]').fill('Pass123!');
  } else {
    // Normal login
    await page.locator('input[type="email"]').fill('e2e_manager@example.com');
    await page.locator('input[type="password"]').fill('Pass123!');
  }

  await page.locator('button[type="submit"]').click();

  // Wait for sidebar (<aside>) to be visible, confirming successful login
  await expect(page.locator('aside')).toBeVisible({ timeout: 10000 });
}

test.describe('Login & Authentication', () => {
  test('shows setup or login form on initial load', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible({ timeout: 10000 });
    const title = await page.locator('h1').textContent();
    expect(title).toBeTruthy();
  });

  test('successfully logs in and displays sidebar navigation', async ({ page }) => {
    await loginAsManager(page);
    await expect(page.locator('aside')).toBeVisible();
  });
});

test.describe('App Navigation Suite', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsManager(page);
  });

  test('navigates to Suppliers screen', async ({ page }) => {
    await page.locator('aside button', { hasText: 'Suppliers' }).click();
    await expect(page.locator('main')).toContainText('Suppliers', { timeout: 8000 });
  });

  test('navigates to Purchase Orders screen', async ({ page }) => {
    await page.locator('aside button', { hasText: 'Purchase Orders' }).click();
    await expect(page.locator('main')).toContainText('Purchase Orders', { timeout: 8000 });
  });

  test('navigates to Receiving Queue (Store)', async ({ page }) => {
    await page.locator('aside button', { hasText: 'Receiving Queue' }).click();
    await expect(page.locator('main')).toContainText('Receiving Queue', { timeout: 8000 });
  });

  test('navigates to Executive Dashboard', async ({ page }) => {
    await page.locator('aside button', { hasText: 'Executive Dashboard' }).click();
    await expect(page.locator('main')).toContainText('Dashboard', { timeout: 8000 });
  });

  test('navigates to Team Chat', async ({ page }) => {
    await page.locator('aside button', { hasText: 'Team Chat' }).click();
    await expect(page.locator('main')).toContainText('Chat', { timeout: 8000 });
  });
});
