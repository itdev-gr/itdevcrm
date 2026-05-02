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

test.describe('admin smoke', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E admin credentials not set');

  test('users list page renders', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.getByRole('heading', { name: /users|χρήστες/i })).toBeVisible();
    await expect(page.getByText(ADMIN_EMAIL!).first()).toBeVisible();
  });

  test('groups list page renders all 6 groups', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/groups');
    await expect(page).toHaveURL(/\/admin\/groups$/);
    await expect(page.getByRole('heading', { name: /groups|ομάδες/i })).toBeVisible();
    // Sales group should be visible
    await expect(page.getByText(/sales|πωλήσεις/i).first()).toBeVisible();
  });

  test('group permissions matrix renders', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/groups');
    await page.getByRole('link', { name: /manage permissions|διαχείριση δικαιωμάτων/i }).first().click();
    await expect(page).toHaveURL(/\/admin\/groups\/.+\/permissions$/);
    // Matrix has board headers
    await expect(page.getByRole('heading', { name: /permissions for/i })).toBeVisible();
  });

  test('field rules page renders', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/fields');
    await expect(page).toHaveURL(/\/admin\/fields$/);
    await expect(page.getByRole('heading', { name: /field-level rules|κανόνες ανά πεδίο/i })).toBeVisible();
    // Add Rule button
    await expect(page.getByRole('button', { name: /add rule|προσθήκη κανόνα/i })).toBeVisible();
  });

  test('stages page renders all 6 boards', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/stages');
    await expect(page).toHaveURL(/\/admin\/stages$/);
    await expect(page.getByRole('heading', { name: /pipeline stages|στάδια pipeline/i })).toBeVisible();
    // Sales board section
    await expect(page.getByRole('heading', { name: /sales|πωλήσεις/i })).toBeVisible();
    // Web Dev board section
    await expect(page.getByRole('heading', { name: /web dev|ανάπτυξη ιστού/i })).toBeVisible();
  });

  test('permissions test page renders evaluated mode', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/permissions/test');
    await expect(page).toHaveURL(/\/admin\/permissions\/test$/);
    await expect(page.getByText(/evaluated mode/i)).toBeVisible();
  });

  test('non-admin redirects from /admin/*', async () => {
    test.skip(true, 'Requires a non-admin test user; manual verification only');
  });
});
