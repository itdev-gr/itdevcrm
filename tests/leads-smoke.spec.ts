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

test.describe('leads smoke', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E admin credentials not set');

  test('admin can open the Sales kanban and see Add lead', async ({ page }) => {
    await signIn(page);
    await page.goto('/sales/kanban');
    await expect(page.getByRole('button', { name: /add lead|προσθήκη επαφής/i })).toBeVisible();
  });

  test('/accounting/recurring is gone (404 / NotFound)', async ({ page }) => {
    await signIn(page);
    await page.goto('/accounting/recurring');
    await expect(page.getByText(/not found|404/i)).toBeVisible();
  });
});
