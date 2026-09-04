-- =============================================================================
-- 2026-09-04 (owner: «θέλω το CRM να είναι γρήγορο»), step 2 of 2.
--
-- Step 1 (20260904100000) made each permission check cheap. It barely moved the
-- needle — median count(*) over leads went 4,136 ms -> 4,612 ms, i.e. nothing —
-- because the check is still executed ONCE PER ROW: 6,786 rows, 6,786 checks.
-- This migration makes it run ONCE PER QUERY.
--
-- The mechanism is Postgres', not a trick: a scalar subquery `(select f())`
-- whose body does not reference the row becomes an InitPlan, evaluated a single
-- time and reused for every row. `f()` written bare is a per-row call. Supabase
-- documents this as the standard RLS performance pattern, and this codebase
-- already relies on it for auth.uid() — `( SELECT auth.uid() AS uid)` appears
-- in leads_select and deals_select. The helper calls simply never got the same
-- treatment.
--
-- NOTHING ABOUT WHO SEES WHAT CHANGES. Wrapping a STABLE function call that
-- takes only literal arguments in a scalar subquery cannot change its value;
-- it changes how many times the value is computed.
--
-- THE ONE RULE THAT MATTERS: only calls with constant arguments are wrapped.
-- `current_user_can('sales','view')` is row-independent -> wrapped.
-- `current_user_can(service_type, 'view')` in jobs_select and
-- `current_user_can(department, 'view')` in email_messages_select depend on the
-- ROW -> left exactly as they are. Wrapping those would build a correlated
-- subquery: still per-row, no gain, and a needless rewrite of a security rule.
--
-- Where a row-dependent call remains, the constant terms are ordered ahead of
-- it so the common case short-circuits before reaching it. OR has no side
-- effects here, so reordering is safe.
--
-- Scope: the SELECT policies of the tables users actually wait on. Write
-- policies (insert/update/delete) touch one row at a time and are left alone.
-- =============================================================================

-- leads: 6,786 rows, the worst offender ---------------------------------------
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
using (
  (select public.current_user_is_admin())
  or (select public.current_user_can('sales', 'view_all'))
  or owner_user_id = (select auth.uid())
);

-- deals -----------------------------------------------------------------------
drop policy if exists deals_select on public.deals;
create policy deals_select on public.deals for select to authenticated
using (
  (select public.current_user_is_admin())
  or (select public.current_user_can('accounting_onboarding', 'view'))
  or (select public.current_user_can('accounting_recurring', 'view'))
  or (
    ((select public.current_user_can('sales', 'view'))
     or (select public.current_user_can('clients', 'view')))
    and (owner_user_id = (select auth.uid()) or won_by_user_id = (select auth.uid()))
  )
);

-- clients ---------------------------------------------------------------------
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients for select to authenticated
using (
  (select public.current_user_is_admin())
  or (select public.current_user_can('clients', 'view'))
);

-- jobs: keeps the row-dependent service_type check, but reaches it last --------
drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs for select to authenticated
using (
  (select public.current_user_is_admin())
  or (select public.current_user_can('accounting_recurring', 'view'))
  or (select public.current_user_can('accounting_onboarding', 'view'))
  or public.current_user_can(service_type, 'view')
);

-- deal_payments / deal_payment_lines ------------------------------------------
drop policy if exists deal_payments_select on public.deal_payments;
create policy deal_payments_select on public.deal_payments for select to authenticated
using (
  (select public.current_user_is_admin())
  or (select public.current_user_can('sales', 'view'))
  or (select public.current_user_can('clients', 'view'))
  or (select public.current_user_can('accounting_onboarding', 'view'))
);

drop policy if exists deal_payment_lines_select on public.deal_payment_lines;
create policy deal_payment_lines_select on public.deal_payment_lines for select to authenticated
using (
  (select public.current_user_is_admin())
  or (select public.current_user_can('sales', 'view'))
  or (select public.current_user_can('clients', 'view'))
  or (select public.current_user_can('accounting_onboarding', 'view'))
);

-- attachments -----------------------------------------------------------------
drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments for select to authenticated
using (
  (select public.current_user_is_admin())
  or (select public.current_user_can('clients', 'view'))
  or (select public.current_user_can('sales', 'view'))
);

-- offers ----------------------------------------------------------------------
drop policy if exists offers_select on public.offers;
create policy offers_select on public.offers for select to authenticated
using (
  (select public.current_user_is_admin())
  or (select public.current_user_can('accounting_onboarding', 'view'))
  or (select public.current_user_can('accounting_recurring', 'view'))
  or created_by = (select auth.uid())
  or exists (
    select 1 from public.leads l
     where l.id = offers.lead_id
       and (l.owner_user_id = (select auth.uid()) or l.won_by_user_id = (select auth.uid()))
  )
  or exists (
    select 1 from public.deals d
     where d.id = offers.deal_id
       and (d.owner_user_id = (select auth.uid()) or d.won_by_user_id = (select auth.uid()))
  )
);

-- assigned_tasks / user_tasks: badges query these on every page ---------------
drop policy if exists assigned_tasks_select on public.assigned_tasks;
create policy assigned_tasks_select on public.assigned_tasks for select to authenticated
using (
  (select auth.uid()) = assignee_user_id
  or (select auth.uid()) = created_by_user_id
  or (select public.current_user_is_admin())
  or (select public.current_user_in_group('accounting'))
);

drop policy if exists user_tasks_select on public.user_tasks;
create policy user_tasks_select on public.user_tasks for select to authenticated
using (
  (select auth.uid()) = user_id
  or (select auth.uid()) = created_by
  or (select public.current_user_is_admin())
  or (
    lead_id is not null
    and exists (
      select 1 from public.leads l
       where l.id = user_tasks.lead_id and l.owner_user_id = (select auth.uid())
    )
  )
);

-- email_messages: 12,467 rows and the heaviest predicate in the database.
-- Base body is 20260903218000 (the capture-source visibility matrix); the
-- department check stays row-dependent and therefore stays bare.
drop policy if exists email_messages_select on public.email_messages;
create policy email_messages_select on public.email_messages for select using (
  staff_user_id = (select auth.uid())
  or (
    case when lead_id is not null and client_id is null then
      (select public.current_user_is_admin())
      or exists (select 1 from public.leads l
                  where l.id = email_messages.lead_id and l.owner_user_id = (select auth.uid()))
    else public.current_user_can(department, 'view')
    end
  )
  or (
    job_id is not null
    and exists (
      select 1 from public.jobs j
       where j.id = email_messages.job_id
         and public.current_user_can(j.service_type, 'view')
    )
  )
  or (select public.current_user_is_admin())
  or captured_from_user_id = (select auth.uid())
  or exists (
    select 1 from public.shared_mailboxes sm
     where sm.user_id = email_messages.captured_from_user_id
       and (
         (sm.email = 'sales@itdev.gr' and (select public.current_user_in_group('sales')))
         or (sm.email = 'accounting@itdev.gr' and (select public.current_user_in_group('accounting')))
         or (sm.email = 'support@itdev.gr'
             and ((select public.current_user_in_group('accounting'))
                  or (select public.current_user_in_technical())))
       )
  )
);

-- ROLLBACK: recreate each policy above with the helper calls unwrapped. The
-- exact pre-change bodies are in the apply script's dump
-- (scratchpad/policies-hot.txt) and in the migrations that last defined them:
--   leads/deals/clients/jobs/deal_payments/attachments/offers  -> 20260502*
--   email_messages_select -> 20260903218000_inbox_visibility_matrix.sql
