-- =============================================================================
-- 2026-09-04 (owner): a «clear» button next to every email in /inbox, so a
-- message leaves the queue once it has been checked — and so mail that should
-- NOT end up on a card can be thrown away instead of sitting there forever.
--
-- Reads (email_message_reads, 20260903210000) model ATTENTION and are per-user.
-- Clearing models the message's own workflow state, and the owner was explicit
-- about the scope, which differs by where the mail came from:
--
--   sales@ / accounting@ / support@ (+ info@)  shared queues
--        -> «όποιος το προλάβει»: one person clears it and it is gone for the
--           whole team that can see that mailbox.
--   a staff member's personal mailbox
--        -> «ο καθένας τα δικά του»: clearing hides it for that person only.
--           185 of the inbox's 300-message window is personal mail, and admins
--           can see all of it — a shared clear there would rip messages out of
--           colleagues' lists.
--
-- Hence one table with a nullable user_id: NULL = cleared for everyone,
-- set = cleared for that user only.
--
-- No SECURITY DEFINER RPC, deliberately. Writes land in THIS table, never in
-- email_messages, so the policy below can do the authorisation itself — and
-- does it better: `exists (select 1 from email_messages ...)` runs under the
-- CALLER's RLS, so it inherits the capture-source visibility matrix from
-- 20260903218000 automatically and keeps inheriting it as that policy evolves.
-- (Same approach as email_attachments_select, 20260903160000.)
-- =============================================================================

create table if not exists public.email_message_dismissals (
  message_pk   uuid not null references public.email_messages(id) on delete cascade,
  -- NULL = cleared for everyone (shared mailbox); otherwise cleared for this user.
  user_id      uuid references public.profiles(user_id) on delete cascade,
  dismissed_by uuid not null default auth.uid() references public.profiles(user_id),
  dismissed_at timestamptz not null default now()
);

-- One shared row per message, one personal row per (message, user).
create unique index if not exists email_message_dismissals_shared
  on public.email_message_dismissals (message_pk) where user_id is null;
create unique index if not exists email_message_dismissals_own
  on public.email_message_dismissals (message_pk, user_id) where user_id is not null;
create index if not exists email_message_dismissals_user
  on public.email_message_dismissals (user_id);

alter table public.email_message_dismissals enable row level security;

-- Readable exactly when the parent message is (the Cleared tab shows them).
drop policy if exists email_message_dismissals_select on public.email_message_dismissals;
create policy email_message_dismissals_select on public.email_message_dismissals
  for select to authenticated
  using (exists (select 1 from public.email_messages m where m.id = message_pk));

-- The scope is enforced here, NOT chosen by the client: a shared clear is only
-- accepted for mail captured by a shared mailbox; anything else may only be
-- cleared for yourself.
drop policy if exists email_message_dismissals_insert on public.email_message_dismissals;
create policy email_message_dismissals_insert on public.email_message_dismissals
  for insert to authenticated
  with check (
    dismissed_by = auth.uid()
    and exists (select 1 from public.email_messages m where m.id = message_pk)
    and (
      (user_id is null and exists (
         select 1 from public.email_messages m
           join public.shared_mailboxes sm on sm.user_id = m.captured_from_user_id
          where m.id = message_pk))
      or user_id = auth.uid()
    )
  );

-- Undo. A shared clear can be undone by anyone who can see the message — it is
-- a team queue, and "whoever gets there first" cuts both ways; a personal clear
-- only by its owner.
drop policy if exists email_message_dismissals_delete on public.email_message_dismissals;
create policy email_message_dismissals_delete on public.email_message_dismissals
  for delete to authenticated
  using (
    exists (select 1 from public.email_messages m where m.id = message_pk)
    and (user_id is null or user_id = auth.uid())
  );

-- ROLLBACK:
--   drop table if exists public.email_message_dismissals;
