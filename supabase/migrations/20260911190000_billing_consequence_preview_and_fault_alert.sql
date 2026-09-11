-- =============================================================================
-- 20260911190000_billing_consequence_preview_and_fault_alert.sql
--
-- Owner 2026-09-11: «να ξέρει το accounting τι κάνει και με ποια επίπτωση» και
-- «να βγαίνει pop up notification στο κέντρο της οθόνης» — πριν ΚΑΙ μετά.
--
-- ΠΡΙΝ: τα παράθυρα επιβεβαίωσης λένε γενικόλογα κείμενα ενώ το σύστημα ήδη
--   ξέρει τα νούμερα — απλώς τα υπολογίζει ΑΦΟΥ πατηθεί το κουμπί
--   (job_pause_billing επιστρέφει payments_cancelled εκ των υστέρων). Δύο RPC
--   προεπισκόπησης δίνουν τα ίδια νούμερα ΠΡΙΝ, με τα ΙΔΙΑ ακριβώς φίλτρα που
--   εκτελεί μετά η πράξη, ώστε προεπισκόπηση και αποτέλεσμα να μην μπορούν να
--   αποκλίνουν.
--
-- ΜΕΤΑ: trigger που πιάνει τη ΜΕΤΑΒΑΣΗ ενός job προς κατάσταση σφάλματος και
--   ειδοποιεί αμέσως το λογιστήριο. Trigger και όχι νυχτερινό cron επειδή ο
--   owner θέλει να το μάθει ο λογιστής που το έκανε, όχι το επόμενο πρωί — και
--   επειδή έτσι καλύπτεται ΚΑΘΕ διαδρομή, γνωστή ή άγνωστη: ακριβώς αυτού του
--   είδους οι άγνωστες διαδρομές (release_deal_jobs, deals_close_jobs_on_close)
--   κράτησαν τέσσερα σφάλματα κρυφά επί μήνες.
-- =============================================================================

-- --- 1. Προεπισκόπηση για παύση / λήξη μιας υπηρεσίας ------------------------
-- Ίδιος φρουρός με το job_unpaid_total (20260904200000:34): χωρίς αυτόν η
-- συνάρτηση θα ήταν money oracle για κάθε συνδεδεμένο χρήστη.
create or replace function public.job_billing_action_preview(p_job_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not (public.current_user_is_admin()
                        or public.current_user_can('accounting_onboarding','edit'))
              then jsonb_build_object('ok', false, 'errors', array['permission_denied'])
  else (
    select jsonb_build_object(
      'ok', true,
      -- Ό,τι ΑΚΥΡΩΝΕΙ η πράξη: ακριβώς το φίλτρο του job_pause_billing
      -- (20260806090000:93-100) και του end_and_archive_job (20260911160000:211-216).
      'cancel_count', coalesce((
        select count(*) from public.deal_payments dp
         where dp.deal_id = j.deal_id and dp.service_type = j.service_type
           and dp.billing_type in ('recurring_monthly','recurring_yearly')
           and dp.status in ('pending','overdue')), 0),
      'cancel_gross', coalesce((
        select sum(dp.amount_gross) from public.deal_payments dp
         where dp.deal_id = j.deal_id and dp.service_type = j.service_type
           and dp.billing_type in ('recurring_monthly','recurring_yearly')
           and dp.status in ('pending','overdue')), 0),
      -- Ό,τι ΜΕΝΕΙ χρεωμένο: κάθε ανεξόφλητο, και το εφάπαξ που δεν ακυρώνεται.
      'unpaid_gross', coalesce((
        select sum(dp.amount_gross) from public.deal_payments dp
         where dp.deal_id = j.deal_id and dp.service_type = j.service_type
           and dp.status in ('pending','overdue')), 0),
      -- Πόσες κάρτες πιάνει η ενέργεια: pause/resume δρουν σε ΟΛΗ την αλυσίδα
      -- (deal_id + service_type), όχι μόνο σε αυτή τη γραμμή.
      'chain_jobs', coalesce((
        select count(*) from public.jobs c
         where c.deal_id = j.deal_id and c.service_type = j.service_type
           and not c.archived), 1),
      'monthly_value', coalesce(j.amount_net, 0)
    )
    from public.jobs j where j.id = p_job_id
  ) end;
$$;
revoke execute on function public.job_billing_action_preview(uuid) from public, anon;
grant execute on function public.job_billing_action_preview(uuid) to authenticated;

-- --- 2. Προεπισκόπηση για κλείσιμο deal --------------------------------------
-- Το CloseDealDialog λέει σήμερα μόνο «οι εργασίες θα πάνε στο Closed». Από τη
-- διόρθωση του Bug 2 (20260911160000) το κλείσιμο ΣΤΑΜΑΤΑ ΚΑΙ ΤΗ ΧΡΕΩΣΗ σε
-- κάθε υπηρεσία — δηλαδή το σημερινό κείμενο είναι πλέον αναληθές.
create or replace function public.deal_close_preview(p_deal_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not (public.current_user_is_admin()
                        or public.current_user_can('accounting_onboarding','edit'))
              then jsonb_build_object('ok', false, 'errors', array['permission_denied'])
  else jsonb_build_object(
    'ok', true,
    -- Ό,τι θα μετακινηθεί/κλείσει: ίδιο φίλτρο με τον trigger
    -- deals_close_jobs_on_close (μη αρχειοθετημένα, σε μη τερματικό stage).
    'jobs_to_close', coalesce((
      select count(*) from public.jobs j
       left join public.pipeline_stages s on s.id = j.stage_id
       where j.deal_id = p_deal_id and not j.archived
         and not coalesce(s.is_terminal, false)), 0),
    'services_billing_stopped', coalesce((
      select count(*) from public.jobs j
       left join public.pipeline_stages s on s.id = j.stage_id
       where j.deal_id = p_deal_id and not j.archived and j.billing_active
         and not coalesce(s.is_terminal, false)), 0),
    'monthly_value_stopped', coalesce((
      select sum(j.amount_net) from public.jobs j
       left join public.pipeline_stages s on s.id = j.stage_id
       where j.deal_id = p_deal_id and not j.archived and j.billing_active
         and not coalesce(s.is_terminal, false)
         and j.billing_type in ('recurring_monthly','recurring_yearly')), 0),
    'open_payments_count', coalesce((
      select count(*) from public.deal_payments p
       where p.deal_id = p_deal_id and p.status in ('pending','overdue')), 0),
    'open_payments_gross', coalesce((
      select sum(p.amount_gross) from public.deal_payments p
       where p.deal_id = p_deal_id and p.status in ('pending','overdue')), 0)
  ) end;
$$;
revoke execute on function public.deal_close_preview(uuid) from public, anon;
grant execute on function public.deal_close_preview(uuid) to authenticated;

-- --- 3. Ειδοποίηση τη στιγμή που δημιουργείται το σφάλμα ---------------------
-- Πυροδοτείται ΜΟΝΟ στη μετάβαση προς την κατάσταση σφάλματος (η ίδια συνθήκη
-- ήταν ψευδής στο OLD), ώστε ένα job που κάθεται ήδη λάθος να μη στέλνει
-- ειδοποίηση σε κάθε άσχετο update — το πρόβλημα «μην ενοχλείς ξανά» που το
-- ud_notify_overdue_tasks λύνει με watermark.
create or replace function public.jobs_notify_billing_fault()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
  v_detail text;
  v_amount numeric := coalesce(new.amount_net, 0);
  v_client text;
  v_was boolean;
begin
  -- (α) Χρέωση κλειστή χωρίς λόγο — δεν χρεώνεται και κανείς δεν το ξέρει.
  if not new.archived and new.parent_job_id is null
     and new.billing_active = false and new.is_blocked = false
     and new.blocked_reason is null
     and new.status not in ('completed','cancelled')
     and new.pending_archive_reason is null
     and coalesce(new.amount_net,0) > 0
  then
    v_was := (old.billing_active = false and old.is_blocked = false
              and old.blocked_reason is null
              and old.status not in ('completed','cancelled')
              and old.pending_archive_reason is null and not old.archived);
    if not v_was then
      v_kind := 'billing_off_without_reason';
      v_detail := 'Η χρέωση έκλεισε χωρίς παύση και χωρίς λήξη — η υπηρεσία δεν χρεώνεται πλέον.';
    end if;
  end if;

  -- (β) Τερματισμένη στο Closed/Done αλλά με ενεργή χρέωση — χρεώνουμε
  --     πελάτη που έφυγε.
  if v_kind is null and not new.archived and new.billing_active
     and new.status = 'completed'
     and new.billing_type in ('recurring_monthly','recurring_yearly')
     and exists (select 1 from public.pipeline_stages s
                  where s.id = new.stage_id and s.code in ('closed','done'))
  then
    v_was := (old.billing_active and old.status = 'completed' and not old.archived
              and exists (select 1 from public.pipeline_stages s
                           where s.id = old.stage_id and s.code in ('closed','done')));
    if not v_was then
      v_kind := 'closed_but_still_billing';
      v_detail := 'Η υπηρεσία τερματίστηκε αλλά η χρέωση παρέμεινε ανοιχτή — θα συνεχίσει να βγάζει λογαριασμούς.';
    end if;
  end if;

  -- (γ) Αρχειοθετήθηκε αφήνοντας ανεξόφλητα — οι υπενθυμίσεις κυνηγούν
  --     πελάτη ήδη τερματισμένο.
  if v_kind is null and new.archived and not old.archived
     and exists (select 1 from public.deal_payments p
                  where p.deal_id = new.deal_id and p.service_type = new.service_type
                    and p.status in ('pending','overdue'))
  then
    v_kind := 'archived_with_open_payment';
    v_detail := 'Η υπηρεσία αρχειοθετήθηκε με ανοιχτό λογαριασμό — οι υπενθυμίσεις θα συνεχίσουν.';
    select coalesce(sum(p.amount_gross),0) into v_amount
      from public.deal_payments p
     where p.deal_id = new.deal_id and p.service_type = new.service_type
       and p.status in ('pending','overdue');
  end if;

  if v_kind is null then return null; end if;

  select c.name into v_client from public.clients c where c.id = new.client_id;

  -- Παραλήπτες: ΕΝΕΡΓΑ μέλη του accounting (το group_member_ids δεν φιλτράρει
  -- is_active/archived — βλ. 20260709120000:45-66, το ίδιο CTE).
  insert into public.notifications (user_id, type, payload)
  select p.user_id, 'billing_fault',
         jsonb_build_object(
           'kind', 'integrity_audit',       -- ενεργοποιεί το υπάρχον deep link
           'fault', v_kind,
           'detail', v_detail,
           'job_code', coalesce(new.code, ''),
           'service_type', new.service_type,
           'client_name', coalesce(v_client, ''),
           'amount', v_amount,
           'parent_type', 'job',
           'parent_id', new.id)
    from public.profiles p
   where p.is_active and not p.archived
     and exists (select 1 from public.user_groups ug
                   join public.groups g on g.id = ug.group_id
                  where ug.user_id = p.user_id and g.code = 'accounting');

  return null;
end $$;

drop trigger if exists trg_jobs_notify_billing_fault on public.jobs;
create trigger trg_jobs_notify_billing_fault
  after update on public.jobs
  for each row execute function public.jobs_notify_billing_fault();

-- ROLLBACK:
--   drop trigger if exists trg_jobs_notify_billing_fault on public.jobs;
--   drop function if exists public.jobs_notify_billing_fault();
--   drop function if exists public.deal_close_preview(uuid);
--   drop function if exists public.job_billing_action_preview(uuid);
