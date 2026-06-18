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

test.describe('local seo board', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E admin credentials not set');

  test('renders the workflow columns plus the virtual Blocked column', async ({ page }) => {
    await signIn(page);
    await page.goto('/tech/local-seo');
    for (const column of [
      'New project',
      'Renewal',
      'Called/No response',
      'Send form',
      'Optimize',
      'Rank tracking',
      'New GBP',
      'Done',
      'Suspended',
      'Verification',
    ]) {
      await expect(page.getByText(column, { exact: true })).toBeVisible();
    }
    await expect(page.getByText(/🔒 Blocked/)).toBeVisible();
  });
});
