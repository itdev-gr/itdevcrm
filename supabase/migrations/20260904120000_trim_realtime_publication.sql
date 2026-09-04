-- =============================================================================
-- 2026-09-04 (owner: «θέλω το CRM να είναι γρήγορο»), the realtime side.
--
-- The single most expensive statement in this database, by total time, is
-- Realtime's WAL decoder: 8.2 million calls and 19.4 HOURS of database time
-- over the 125 days pg_stat_statements has been collecting — more than every
-- application query put together. It pays that for every change to every table
-- in the supabase_realtime publication, whether or not anyone is listening.
--
-- Twenty tables were published. An inventory of every supabase.channel() /
-- on('postgres_changes') call in the frontend shows subscribers for only
-- eleven: activity_log, assigned_tasks, deal_payments, deals, email_messages,
-- expenses, jobs, leads, notifications, task_comments, user_tasks (plus
-- announcements, which is not in the publication at all — its hook invalidates
-- on a channel that never fires).
--
-- These nine have no subscriber anywhere in the app, so every insert, update
-- and delete on them has been decoded and thrown away. `comments` alone holds
-- 88,564 rows and is one of the busiest tables in the system.
--
-- Removing a table from the publication does not change data, permissions or
-- any query: it only stops Realtime broadcasting its changes. If a table here
-- ever needs live updates, add it back in the same statement style — and note
-- that a missing publication entry fails SILENTLY (the channel subscribes fine
-- and simply never fires), which is exactly the trap `announcements` is in.
-- =============================================================================

alter publication supabase_realtime drop table public.attachments;
alter publication supabase_realtime drop table public.client_blocks;
alter publication supabase_realtime drop table public.clients;
alter publication supabase_realtime drop table public.comments;
alter publication supabase_realtime drop table public.contracts;
alter publication supabase_realtime drop table public.deal_payment_lines;
alter publication supabase_realtime drop table public.offers;
alter publication supabase_realtime drop table public.pro_formas;
alter publication supabase_realtime drop table public.service_packages;

-- ROLLBACK:
--   alter publication supabase_realtime add table public.attachments;
--   alter publication supabase_realtime add table public.client_blocks;
--   alter publication supabase_realtime add table public.clients;
--   alter publication supabase_realtime add table public.comments;
--   alter publication supabase_realtime add table public.contracts;
--   alter publication supabase_realtime add table public.deal_payment_lines;
--   alter publication supabase_realtime add table public.offers;
--   alter publication supabase_realtime add table public.pro_formas;
--   alter publication supabase_realtime add table public.service_packages;
