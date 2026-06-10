// One-off / repeatable cleanup for data the Playwright suite left in the
// shared Supabase project: "E2E Test <timestamp>" clients (e2e@example.com)
// and "e2e-task-*@example.test" users. Archives them through the same RLS
// rules the app uses (no service-role key needed).
//
// Usage:
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... node scripts/purge-e2e-data.mjs
// Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env.local.
//
// Revert: rows are archived, not deleted — clear archived/archived_at/
// archived_by/archived_reason on the affected rows to restore them.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

function loadEnvLocal() {
  try {
    for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    /* .env.local optional when vars come from the environment */
  }
}
loadEnvLocal();

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const email = process.env.E2E_ADMIN_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD;

if (!url || !anonKey) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing');
if (!email || !password) throw new Error('E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD missing');

const supabase = createClient(url, anonKey);

const { data: auth, error: authError } = await supabase.auth.signInWithPassword({ email, password });
if (authError) throw new Error(`sign-in failed: ${authError.message}`);
const adminId = auth.user.id;
const stamp = {
  archived: true,
  archived_at: new Date().toISOString(),
  archived_by: adminId,
  archived_reason: 'e2e test data purge',
};

// 1. Junk clients created by tests/sales-flow.spec.ts.
const { data: junkClients, error: findError } = await supabase
  .from('clients')
  .select('id, name, email')
  .eq('email', 'e2e@example.com')
  .like('name', 'E2E Test %')
  .eq('archived', false);
if (findError) throw new Error(`finding clients failed: ${findError.message}`);

for (const c of junkClients ?? []) {
  const { error } = await supabase.from('clients').update(stamp).eq('id', c.id);
  console.log(error ? `✗ client ${c.name}: ${error.message}` : `✓ archived client ${c.name}`);
  // Archive the client's deals too so they drop out of pipelines.
  const { error: relError } = await supabase.from('deals').update(stamp).eq('client_id', c.id);
  if (relError) console.log(`  ✗ deals for ${c.name}: ${relError.message}`);
}
if ((junkClients ?? []).length === 0) console.log('no junk clients found');

// 2. Junk leads created directly (not linked to a client).
const { data: junkLeads, error: leadFindError } = await supabase
  .from('leads')
  .select('id, company_name')
  .eq('email', 'e2e@example.com')
  .eq('archived', false);
if (leadFindError) {
  console.log(`✗ finding leads failed: ${leadFindError.message}`);
} else {
  for (const l of junkLeads ?? []) {
    const { error } = await supabase.from('leads').update(stamp).eq('id', l.id);
    console.log(error ? `✗ lead ${l.company_name}: ${error.message}` : `✓ archived lead ${l.company_name}`);
  }
  if ((junkLeads ?? []).length === 0) console.log('no junk leads found');
}

// 3. Leftover e2e users.
const { data: junkUsers, error: userFindError } = await supabase
  .from('profiles')
  .select('user_id, email')
  .like('email', 'e2e-%@example.test')
  .eq('archived', false);
if (userFindError) throw new Error(`finding profiles failed: ${userFindError.message}`);

for (const u of junkUsers ?? []) {
  const { error } = await supabase
    .from('profiles')
    .update({ ...stamp, is_active: false })
    .eq('user_id', u.user_id);
  console.log(error ? `✗ user ${u.email}: ${error.message}` : `✓ archived user ${u.email}`);
}
if ((junkUsers ?? []).length === 0) console.log('no junk users found');

await supabase.auth.signOut();
console.log('done');
