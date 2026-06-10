// Archives the data the e2e suite creates so test runs leave no junk in the
// shared Supabase project. Uses the anon key + the e2e admin login, i.e. the
// same RLS path as the app — no service-role key required.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

function loadEnvLocal(): void {
  try {
    // Playwright runs with cwd at the repo root (where playwright.config.ts
    // lives), so resolve from there — __dirname isn't available in ESM.
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && m[1] && m[2] !== undefined && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim();
      }
    }
  } catch {
    /* fine — vars may come from the environment (CI) */
  }
}

export async function archiveE2eClients(): Promise<void> {
  loadEnvLocal();
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!url || !anonKey || !email || !password) {
    console.warn('[e2e cleanup] skipped: missing Supabase URL/key or E2E admin credentials');
    return;
  }

  const supabase = createClient(url, anonKey);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    console.warn(`[e2e cleanup] skipped: sign-in failed${error ? ` (${error.message})` : ''}`);
    return;
  }

  const stamp = {
    archived: true,
    archived_at: new Date().toISOString(),
    archived_by: data.user.id,
    archived_reason: 'e2e cleanup',
  };

  const { data: clients } = await supabase
    .from('clients')
    .select('id')
    .eq('email', 'e2e@example.com')
    .like('name', 'E2E Test %')
    .eq('archived', false);

  for (const c of clients ?? []) {
    await supabase.from('deals').update(stamp).eq('client_id', c.id);
    await supabase.from('clients').update(stamp).eq('id', c.id);
  }

  await supabase.auth.signOut();
}
