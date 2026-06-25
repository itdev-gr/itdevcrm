-- 20260625100200_activity_triggers_payments_tasks.sql
-- Funnel payment + task changes into activity_log via the shared fn.

drop trigger if exists deal_payments_activity on public.deal_payments;
create trigger deal_payments_activity
  after insert or update or delete on public.deal_payments
  for each row execute function public.log_activity();

drop trigger if exists user_tasks_activity on public.user_tasks;
create trigger user_tasks_activity
  after insert or update or delete on public.user_tasks
  for each row execute function public.log_activity();

drop trigger if exists assigned_tasks_activity on public.assigned_tasks;
create trigger assigned_tasks_activity
  after insert or update or delete on public.assigned_tasks
  for each row execute function public.log_activity();

-- ROLLBACK:
--   drop trigger if exists deal_payments_activity on public.deal_payments;
--   drop trigger if exists user_tasks_activity on public.user_tasks;
--   drop trigger if exists assigned_tasks_activity on public.assigned_tasks;
