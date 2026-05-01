import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

test.describe('auth flow', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E admin credentials not set');

  test('admin can sign in and reach the home page', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL!);
    await page.getByLabel(/password/i).fill(ADMIN_PASSWORD!);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: /itdevcrm/i })).toBeVisible();
  });

  test('admin sees /admin/users in the sidebar and can navigate to it', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL!);
    await page.getByLabel(/password/i).fill(ADMIN_PASSWORD!);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 15000 });

    await page.getByRole('link', { name: /users|χρήστες/i }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.getByRole('heading', { name: /users|χρήστες/i })).toBeVisible();
  });
});
