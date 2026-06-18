import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { archiveE2eClients } from './helpers/cleanup';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL!);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD!);
  await page.getByRole('button', { name: /log in|σύνδεση/i }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
}

// Regression guard for the detached-`supabase.rpc` crash: adding a job used to
// throw "Cannot read properties of undefined (reading 'rest')" because the
// `create_custom_job` wrapper had lost the client's `this` binding, so no job
// was saved and the pricing summary stayed at €0.00. This drives the real
// Add-job UI against the real RPC and asserts the job persists and the summary
// recomputes live.
test.describe('jobs & billing — add job', () => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD || !SUPABASE_URL || !SUPABASE_ANON_KEY,
    'E2E admin credentials / Supabase env not set',
  );

  // A throwaway deal to add jobs to. Built via the same RLS path as the app
  // (anon key + admin login), then archived by archiveE2eClients() afterwards.
  let dealId = '';

  test.beforeAll(async () => {
    const sb = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { data: auth, error: authErr } = await sb.auth.signInWithPassword({
      email: ADMIN_EMAIL!,
      password: ADMIN_PASSWORD!,
    });
    if (authErr || !auth.user) throw new Error(`e2e setup sign-in failed: ${authErr?.message}`);
    const uid = auth.user.id;
    const stamp = Date.now();

    // Lead shaped to satisfy convert_lead_to_client's guards (value > 0, one
    // service, email + phone, company_name, payment_method). The seeded service
    // is recurring_monthly, so the deal's One-time bucket starts at €0.00 — the
    // exact state in the bug report.
    const { data: lead, error: leadErr } = await sb
      .from('leads')
      .insert({
        source: 'manual',
        title: `E2E Add Job ${stamp}`,
        company_name: `E2E Test ${stamp}`,
        email: 'e2e@example.com',
        phone: '1234567890',
        country: 'Greece',
        payment_method: 'online',
        estimated_monthly_value: 100,
        services_planned: [
          { service_type: 'web_dev', billing_type: 'recurring_monthly', monthly_amount: '100' },
        ],
        created_by: uid,
        owner_user_id: uid,
      })
      .select('id')
      .single();
    if (leadErr || !lead) throw new Error(`e2e lead insert failed: ${leadErr?.message}`);

    const { data: conv, error: convErr } = await sb.rpc('convert_lead_to_client', {
      target_lead_id: lead.id,
    });
    if (convErr) throw new Error(`e2e convert failed: ${convErr.message}`);
    const result = conv as { ok: boolean; deal_id?: string; errors?: string[] };
    if (!result.ok || !result.deal_id) {
      throw new Error(`e2e convert returned errors: ${result.errors?.join(', ')}`);
    }
    dealId = result.deal_id;

    // The lead has done its job; archive it so it leaves no active-pipeline junk.
    await sb
      .from('leads')
      .update({
        archived: true,
        archived_by: uid,
        archived_reason: 'e2e cleanup',
      })
      .eq('id', lead.id);
    await sb.auth.signOut();
  });

  test.afterAll(async () => {
    await archiveE2eClients();
  });

  test('adds a one-time job via the RPC and the pricing summary updates live', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    let dialogMessage = '';
    page.on('dialog', (d) => {
      dialogMessage = d.message();
      void d.dismiss();
    });

    await signIn(page);
    await page.goto(`/deals/${dealId}`);

    // Open the Add-job form (the panel header button; "+ Add job").
    await page.getByRole('button', { name: /\+\s*(add job|προσθήκη εργασίας)/i }).click();

    const jobTitle = `E2E Job ${Date.now()}`;
    // Stable, language-independent ids from AddCustomJobForm. Department defaults
    // to web_dev and cadence to one-time — exactly what we want here.
    await page.locator('#cj-title').fill(jobTitle);
    await page.locator('#cj-price').fill('222');

    // Submit ("Add job" — anchored so it doesn't match the "+ Add job" toggle).
    await page.getByRole('button', { name: /^(add job|προσθήκη εργασίας)$/i }).click();

    // 1) The job persisted and the panel rendered it. Pre-fix, two bugs each
    //    blocked this: the create RPC crashed (detached `this`), and even once
    //    saved, useJobsBilling 400'd on a non-existent `due_date` column so the
    //    panel never loaded.
    await expect(page.getByRole('cell', { name: jobTitle })).toBeVisible({ timeout: 15_000 });

    // 2) The pricing summary recomputed: the One-time row now carries the net
    //    €222.00 it was missing before (it had been stuck at €0.00).
    const oneTimeRow = page.getByRole('row').filter({ hasText: /one-?time|εφάπαξ/i });
    await expect(oneTimeRow).toContainText('€222.00');

    // 3) The specific crash never resurfaced in the console.
    expect(dialogMessage).not.toContain('rest');
    expect(consoleErrors.join('\n')).not.toContain("reading 'rest'");
  });
});
