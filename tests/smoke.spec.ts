import { test, expect } from '@playwright/test';

test('unauthenticated visit to / redirects to /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/, { timeout: 15000 });
  await expect(page.getByRole('heading', { name: /sign in|σύνδεση/i })).toBeVisible();
});
