-- Track each client's lifecycle as a single explicit status.
-- New      → just converted from a lead, accounting hasn't engaged
-- Active   → contracts in motion, payments flowing
-- Blocked  → halted (chasing payment, dispute, etc.)
-- Done     → contract finished

alter table public.clients
  add column if not exists status text not null default 'new'
  check (status in ('new', 'active', 'blocked', 'done'));

-- Backfill: anyone with a currently-active block lands on 'blocked' so the
-- new pill matches the existing block badge.
update public.clients c
   set status = 'blocked'
 where status = 'new'
   and exists (
     select 1 from public.client_blocks b
      where b.client_id = c.id and b.unblocked_at is null
   );
