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

test.describe('reporting dashboard', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E admin credentials not set');

  test('admin sees tiles, charts and conversion tables', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: /dashboard|πίνακας αναφορών/i })).toBeVisible();
    for (const tile of [/leads created|νέα leads/i, /win rate|ποσοστό επιτυχίας/i, /contracted mrr|συμβολαιοποιημένο/i]) {
      await expect(page.getByText(tile).first()).toBeVisible();
    }
    await expect(page.getByText(/revenue trend|τάση εσόδων/i)).toBeVisible();
    await expect(page.getByText(/by sales person|ανά πωλητή/i).first()).toBeVisible();
    await expect(page.getByText(/by source|ανά πηγή/i).first()).toBeVisible();
    // The chart actually rendered (recharts draws an svg surface).
    await expect(page.locator('svg.recharts-surface').first()).toBeVisible();
  });
});
