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

test.describe('mobile navigation', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E admin credentials not set');
  test.use({ viewport: { width: 390, height: 844 } });

  test('hamburger opens the drawer and links navigate + close it', async ({ page }) => {
    await signIn(page);

    const menuButton = page.getByRole('button', { name: /open menu|άνοιγμα μενού/i });
    await expect(menuButton).toBeVisible();
    await menuButton.click();

    const pipelineLink = page.getByRole('link', { name: /sales pipeline|pipeline πωλήσεων/i });
    await expect(pipelineLink).toBeVisible();
    await pipelineLink.click();

    await expect(page).toHaveURL(/\/sales\/kanban$/);
    // Drawer closed after navigating.
    await expect(pipelineLink).not.toBeVisible();
  });
});
