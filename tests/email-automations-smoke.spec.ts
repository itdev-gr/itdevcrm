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

test.describe('email automations admin page', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E admin credentials not set');

  test('renders switches, sequences with editable days, and template editors', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/email-automations');

    await expect(
      page.getByRole('heading', { name: /email automations|αυτοματισμοί email/i }),
    ).toBeVisible();
    await expect(page.getByText(/automations active|αυτοματισμοί ενεργοί/i)).toBeVisible();
    // Sequences with their steps.
    await expect(page.getByText('No Answer cadence', { exact: true })).toBeVisible();
    await expect(page.getByText('Offer follow-ups', { exact: true })).toBeVisible();
    const dayInputs = page.locator('input[type="number"]');
    await expect(dayInputs.first()).toBeVisible();
    // Template editor expands.
    await page.getByText('lead_welcome', { exact: true }).click();
    await expect(page.getByText(/available variables|διαθέσιμες μεταβλητές/i)).toBeVisible();
  });
});
