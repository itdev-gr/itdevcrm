import { test, expect, type Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL!);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD!);
  await page.getByRole('button', { name: /sign in|σύνδεση/i }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
}

test.describe('accounting smoke', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E admin credentials not set');

  test('admin can navigate to /accounting/onboarding', async ({ page }) => {
    await signIn(page);
    await page.goto('/accounting/onboarding');
    await expect(page).toHaveURL(/\/accounting\/onboarding$/);
    await expect(
      page.getByRole('heading', { name: /accounting onboarding|λογιστήριο/i }),
    ).toBeVisible();
  });
});
