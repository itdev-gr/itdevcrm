import { test, expect, type Page } from '@playwright/test';

// Credentials come from the environment so none are committed. Falls back to the
// admin vars used by auth-flow.spec.ts. The authenticated block skips if unset.
const EMAIL = process.env.E2E_SALES_EMAIL ?? process.env.E2E_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_SALES_PASSWORD ?? process.env.E2E_ADMIN_PASSWORD;

function htmlIsDark(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.classList.contains('dark'));
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(EMAIL!);
  await page.getByLabel(/password/i).fill(PASSWORD!);
  await page.getByRole('button', { name: /sign in|σύνδεση/i }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15000 });
  await expect(page.getByRole('banner')).toBeVisible();
}

test.describe('theme bootstrap (no auth)', () => {
  test('applies the saved theme before paint on /login', async ({ page }) => {
    await page.goto('/login');

    await page.evaluate(() => localStorage.setItem('itdevcrm.theme', 'dark'));
    await page.reload();
    await expect.poll(() => htmlIsDark(page)).toBe(true);

    await page.evaluate(() => localStorage.setItem('itdevcrm.theme', 'light'));
    await page.reload();
    await expect.poll(() => htmlIsDark(page)).toBe(false);
  });
});

test.describe('theme toggle (authenticated)', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E credentials not set (E2E_SALES_EMAIL/PASSWORD)');

  test('toggles the whole app dark/light and persists across reload', async ({ page }) => {
    // Start from a known state so the default does not depend on the OS.
    await page.goto('/login');
    await page.evaluate(() => localStorage.setItem('itdevcrm.theme', 'light'));
    await login(page);

    const toggle = page.getByRole('banner').getByRole('combobox', { name: /theme|θέμα/i });
    await expect(toggle).toBeVisible();

    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(await htmlIsDark(page)).toBe(false);

    // → Dark: html gets the .dark class and the body background actually changes.
    await toggle.click();
    await page.getByRole('option', { name: /dark|σκοτειν/i }).click();
    await expect.poll(() => htmlIsDark(page)).toBe(true);
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(darkBg).not.toBe(lightBg);

    // Persists across a full reload (localStorage + no-flash script).
    await page.reload();
    await expect.poll(() => htmlIsDark(page)).toBe(true);

    // → Light again.
    await page
      .getByRole('banner')
      .getByRole('combobox', { name: /theme|θέμα/i })
      .click();
    await page.getByRole('option', { name: /light|φωτειν/i }).click();
    await expect.poll(() => htmlIsDark(page)).toBe(false);
  });
});
