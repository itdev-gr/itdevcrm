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

test.describe('sales flow', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E admin credentials not set');

  test('admin can navigate to /sales/clients', async ({ page }) => {
    await signIn(page);
    await page.goto('/sales/clients');
    await expect(page).toHaveURL(/\/sales\/clients$/);
    await expect(page.getByRole('heading', { name: /my clients|οι πελάτες μου/i })).toBeVisible();
  });

  test('admin can create a client', async ({ page }) => {
    await signIn(page);
    await page.goto('/sales/clients');
    await page.getByRole('button', { name: /new client|νέος πελάτης/i }).click();
    const unique = `E2E Test ${Date.now()}`;
    await page.getByLabel(/company name|όνομα εταιρείας/i).fill(unique);
    await page
      .getByLabel(/^email$/i)
      .first()
      .fill('e2e@example.com');
    await page.getByLabel(/^phone|τηλέφωνο/i).fill('1234567890');
    await page.getByRole('button', { name: /^save|αποθήκευση$/i }).click();
    await expect(page).toHaveURL(/\/clients\/.+/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: unique })).toBeVisible();
  });

  test('sales kanban renders columns', async ({ page }) => {
    await signIn(page);
    await page.goto('/sales/kanban');
    await expect(page).toHaveURL(/\/sales\/kanban$/);
    await expect(
      page.getByRole('heading', { name: /sales pipeline|pipeline πωλήσεων/i }),
    ).toBeVisible();
  });
});
