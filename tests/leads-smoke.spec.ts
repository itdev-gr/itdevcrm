import { test, expect, type Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL!);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD!);
  await page.getByRole('button', { name: /log in|σύνδεση/i }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
}

test.describe('leads smoke', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E admin credentials not set');

  test('admin can open the Sales kanban and see Add lead', async ({ page }) => {
    await signIn(page);
    await page.goto('/sales/kanban');
    await expect(page.getByRole('button', { name: /add lead|προσθήκη επαφής/i })).toBeVisible();
  });

  test('/accounting/recurring renders the recurring clients board', async ({ page }) => {
    await signIn(page);
    await page.goto('/accounting/recurring');
    await expect(page.getByRole('heading', { name: /recurring clients/i })).toBeVisible();
  });

  test('recurring clients board translates to Greek', async ({ page }) => {
    await signIn(page);
    await page.goto('/accounting/recurring');
    await expect(page.getByRole('heading', { name: /recurring clients/i })).toBeVisible();
    // Switch to Greek via the top-bar locale switcher (Radix Select, role=combobox).
    await page.getByRole('combobox', { name: /language|γλώσσα/i }).click();
    await page.getByRole('option', { name: 'Ελληνικά' }).click();
    await expect(
      page.getByRole('heading', { name: /Επαναλαμβανόμενοι πελάτες/i }),
    ).toBeVisible();
  });
});
