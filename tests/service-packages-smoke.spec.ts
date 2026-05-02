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

test.describe('service packages smoke', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E admin credentials not set');

  test('admin can navigate to /admin/service-packages and see the catalog', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/service-packages');
    await expect(
      page.getByRole('heading', { name: /service packages|πακέτα υπηρεσιών/i }),
    ).toBeVisible();
    // Seeded service-type sections (5 of 6 — hosting has no packages by default)
    await expect(page.getByRole('heading', { name: 'web_seo' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ai_seo' })).toBeVisible();
  });

  test('settings tabs include service packages and reach it from the Settings link', async ({
    page,
  }) => {
    await signIn(page);
    await page.getByRole('link', { name: /settings|ρυθμίσεις/i }).click();
    await expect(page).toHaveURL(/\/admin/);
    await page.getByRole('link', { name: /service packages|πακέτα υπηρεσιών/i }).click();
    await expect(page).toHaveURL(/\/admin\/service-packages$/);
  });
});
