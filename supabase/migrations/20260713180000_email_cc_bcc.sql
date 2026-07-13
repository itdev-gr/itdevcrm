-- =============================================================================
-- CC/BCC for CRM email (spec 2026-07-13-email-cc-bcc-design.md).
-- cc_emails: comma-joined, visible to whoever can see the message (existing
-- department RLS). Bcc is admin-only END TO END, so it lives in a separate
-- table whose SELECT policy is admin-only — row-level security can't hide a
-- column, hence the side table. Writes are service-role only (edge fns).
-- job_emails() returns setof email_messages and inherits cc_emails as-is.
-- =============================================================================

alter table public.email_messages add column if not exists cc_emails text;

create table if not exists public.email_message_bcc (
  message_pk uuid primary key references public.email_messages(id) on delete cascade,
  bcc_emails text not null,
  created_at timestamptz not null default now()
);

alter table public.email_message_bcc enable row level security;

drop policy if exists email_message_bcc_admin_select on public.email_message_bcc;
create policy email_message_bcc_admin_select on public.email_message_bcc
  for select using (public.current_user_is_admin());
-- No INSERT/UPDATE/DELETE policies: only service-role edge functions write.

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- ROLLBACK:
--   drop table if exists public.email_message_bcc;
--   alter table public.email_messages drop column if exists cc_emails;
--   notify pgrst, 'reload schema';
-- ---------------------------------------------------------------------------
