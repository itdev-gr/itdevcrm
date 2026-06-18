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

test.describe('assigned-tasks smoke', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E admin credentials not set');

  test('home page renders the Assigned-to-me / Assigned tasks panel', async ({ page }) => {
    await signIn(page);
    await expect(
      page.getByRole('heading', { name: /assigned to me|assigned tasks|ανατεθειμένα σε εμένα|ανατεθειμένες εργασίες/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('deal detail page shows the Tasks tab with an empty-state placeholder', async ({ page }) => {
    await signIn(page);
    // Navigate to a deal — open the Sales clients list, click the first client, click the first deal link.
    await page.goto('/sales/clients');
    const firstClientLink = page.locator('a[href^="/clients/"]').first();
    if ((await firstClientLink.count()) === 0) {
      test.skip(true, 'No clients seeded in this environment');
      return;
    }
    await firstClientLink.click();
    await page.waitForURL(/\/clients\//);
    const firstDealLink = page.locator('a[href^="/deals/"]').first();
    if ((await firstDealLink.count()) === 0) {
      test.skip(true, 'No deals on the first client');
      return;
    }
    await firstDealLink.click();
    await page.waitForURL(/\/deals\//);

    // Click the new Tasks tab (en or el).
    const tasksTab = page.getByRole('tab', { name: /^tasks$|καθήκοντα/i });
    await expect(tasksTab).toBeVisible();
    await tasksTab.click();

    // The empty/open header should render (look for "Open (n)").
    await expect(page.getByText(/open \(\d+\)/i)).toBeVisible({ timeout: 5_000 });
  });

  test('admin can create a task on a deal and see it under Open', async ({ page }) => {
    await signIn(page);
    await page.goto('/sales/clients');
    const firstClientLink = page.locator('a[href^="/clients/"]').first();
    if ((await firstClientLink.count()) === 0) {
      test.skip(true, 'No clients seeded');
      return;
    }
    await firstClientLink.click();
    await page.waitForURL(/\/clients\//);
    const firstDealLink = page.locator('a[href^="/deals/"]').first();
    if ((await firstDealLink.count()) === 0) {
      test.skip(true, 'No deals on the first client');
      return;
    }
    await firstDealLink.click();
    await page.waitForURL(/\/deals\//);

    const tasksTab = page.getByRole('tab', { name: /^tasks$|καθήκοντα/i });
    await tasksTab.click();

    const newTaskBtn = page.getByRole('button', { name: /new task|νέα εργασία/i });
    if (!(await newTaskBtn.isVisible().catch(() => false))) {
      test.skip(true, 'Admin user does not see the New task button');
      return;
    }
    await newTaskBtn.click();

    const uniqueTitle = `E2E task ${Date.now()}`;
    await page.getByLabel(/task title|τίτλος εργασίας/i).fill(uniqueTitle);
    await page.getByLabel(/notes|σημειώσεις/i).fill('e2e smoke note');
    // Assign to the first available assignee in the select.
    const assigneeSelect = page.getByLabel(/assign to|ανάθεση σε/i);
    const optionValues = await assigneeSelect.locator('option').evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value).filter((v) => v.length > 0),
    );
    if (optionValues.length === 0) {
      test.skip(true, 'No assignable owners in this environment');
      return;
    }
    await assigneeSelect.selectOption(optionValues[0]!);

    await page.getByRole('button', { name: /^create task$|δημιουργία/i }).click();

    await expect(page.getByText(uniqueTitle)).toBeVisible({ timeout: 10_000 });
  });
});
