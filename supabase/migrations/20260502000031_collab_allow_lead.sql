-- =============================================================================
-- Allow parent_type='lead' on comments and attachments. The check constraints
-- pre-dated the leads pipeline so they only listed client/deal/job, which made
-- comment + attachment inserts on /leads/:id fail silently in the UI.
-- =============================================================================
alter table public.comments drop constraint if exists comments_parent_type_check;
alter table public.comments add constraint comments_parent_type_check
  check (parent_type in ('client', 'deal', 'job', 'lead'));

alter table public.attachments drop constraint if exists attachments_parent_type_check;
alter table public.attachments add constraint attachments_parent_type_check
  check (parent_type in ('client', 'deal', 'job', 'lead'));
