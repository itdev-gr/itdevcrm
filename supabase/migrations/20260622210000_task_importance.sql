-- Tasks get a required Importance (Low/Medium/High/Urgent), stored as lowercase
-- codes with a CHECK constraint (matches the existing assigned_tasks.status
-- pattern). NOT NULL DEFAULT 'low' backfills every existing row to Low in one
-- statement — no separate UPDATE needed.
alter table public.user_tasks
  add column importance text not null default 'low'
  check (importance in ('low','medium','high','urgent'));

alter table public.assigned_tasks
  add column importance text not null default 'low'
  check (importance in ('low','medium','high','urgent'));

-- ROLLBACK:
--   alter table public.user_tasks drop column importance;
--   alter table public.assigned_tasks drop column importance;
