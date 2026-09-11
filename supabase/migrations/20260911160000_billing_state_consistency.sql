-- =============================================================================
-- 20260911160000_billing_state_consistency.sql
--
-- Πλήρης σάρωση συνέπειας χρέωσης (owner, 2026-09-11). Ξεκίνησε από «ποιος
-- έκανε End τα ads του 005230» — κανείς δεν το είχε κάνει. Βρέθηκαν πέντε
-- ξεχωριστά προβλήματα, δύο από τα οποία κινούν χρήματα προς ΑΝΤΙΘΕΤΕΣ
-- κατευθύνσεις, και κανένα δεν παρήγαγε ειδοποίηση.
--
-- ΚΟΙΝΟ ΝΗΜΑ: το `blocked_reason` κουβαλά δύο διαφορετικά πράγματα —
-- ΑΥΤΟΜΑΤΑ μπλοκαρίσματα ('account_on_hold', 'awaiting_first_payment',
-- 'partial_payment_pending') που πρέπει να καθαρίζονται μόνα τους, και τη
-- ΧΕΙΡΟΚΙΝΗΤΗ ανθρώπινη απόφαση 'billing_paused' που δεν πρέπει ΠΟΤΕ. Τρεις
-- συναρτήσεις τα καθάριζαν αδιακρίτως.
--
-- BUG 1 — Η παύση αυτοκαταστρέφεται (ΧΑΝΟΥΜΕ χρέωση, 8 υπηρεσίες / 1.568,81€).
--   release_deal_jobs (20260903220000): 4 από τα 5 κλαδιά καθαρίζουν το
--   μπλοκάρισμα χωρίς φίλτρο λόγου ΚΑΙ χωρίς να επαναφέρουν billing_active.
--   Η αλυσίδα: pause ακυρώνει τα ανεξόφλητα → υπόλοιπο 0 → reconcile_deal_stage
--   απελευθερώνει σε paid_in_full → release_deal_jobs → σβήνει την παύση.
--   Μένει billing_active=false ΧΩΡΙΣ σήμανση: το UI δείχνει «Ended», η
--   χρέωση δεν τρέχει, κανείς δεν το βλέπει.
--
-- BUG 2 — Το κλείσιμο deal δεν σταματά τη χρέωση (ΧΡΕΩΝΟΥΜΕ κλεισμένους,
--   16 recurring / 3.796,06€ εκτεθειμένα, 6 λογαριασμοί όντως εκδόθηκαν μετά
--   το κλείσιμο). deals_close_jobs_on_close (20260626000021) στέλνει την
--   κάρτα στο Closed και τη σημαδεύει completed — αλλά ΠΟΤΕ δεν έθεσε
--   billing_active=false (η χρέωση σταματούσε μόνο από το end_and_archive_job,
--   που ήρθε 2.5 μήνες αργότερα). Καθάριζε επίσης το μπλοκάρισμα χωρίς
--   φίλτρο — δεύτερη πηγή του Bug 1.
--
-- BUG 4 — Το End άφηνε ανεξόφλητα πίσω του: δρα σε ΕΝΑ job id ενώ οι
--   πληρωμές κλειδώνονται σε (deal_id, service_type), σε αντίθεση με το
--   job_pause_billing που ακυρώνει ολόκληρη την αλυσίδα.
--
-- (BUG 5 — η παντελής έλλειψη integrity alert γι' αυτά, που είναι ο λόγος
--  που έζησαν μήνες απαρατήρητα — ΔΕΝ περιλαμβάνεται εδώ· εκκρεμεί απόφαση.)
--
-- (Bug 3 — η παύση δεν έβγαζε την κάρτα από τη ροή εργασίας — λύνεται στο
--  frontend με συνθετική στήλη «Σε παύση», ΧΩΡΙΣ μετακίνηση stage_id, ώστε
--  το Resume να επιστρέφει την κάρτα ακριβώς εκεί που ήταν.)
--
-- Redefines — drift-check πριν την εφαρμογή (σύμβαση repo), pre/post md5
-- καταγράφονται από το apply script:
--   release_deal_jobs()          — repo: 20260903220000
--   deals_close_jobs_on_close()  — repo: 20260626000021
--   end_and_archive_job()        — repo: 20260908120000
-- =============================================================================

-- --- BUG 1: η απελευθέρωση δεν σβήνει χειροκίνητη παύση ----------------------
-- Σώμα αυτούσιο από 20260903220000· προστίθεται ΜΟΝΟ ο περιορισμός
-- `blocked_reason is distinct from 'billing_paused'` στα τέσσερα ακάλυπτα
-- κλαδιά (το κλαδί (3) τον είχε ήδη, μέσω της λίστας λόγων του).
create or replace function public.release_deal_jobs(p_deal_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  -- (0) Onboarded SEO -> renewal sync.
  for r in select j.id from public.jobs j
            where j.deal_id = p_deal_id and not j.archived
              and j.service_type in ('web_seo','local_seo')
              and j.onboarded_at is not null
  loop
    if public.seo_sync_renewal_job(r.id) then
      update public.jobs
         set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
       where id = r.id
         and blocked_reason is distinct from 'billing_paused';
    end if;
  end loop;

  -- (1a) SEO never onboarded, off-board -> New project + mark + unblock.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         onboarded_at=now(),
         stage_id=(select s.id from public.pipeline_stages s
                    where s.board=j.service_type and s.code='new_project' and not s.archived limit 1)
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.onboarded_at is null and j.stage_id is null
     and j.blocked_reason is distinct from 'billing_paused'
     and exists (select 1 from public.pipeline_stages s
                  where s.board=j.service_type and s.code='new_project' and not s.archived);

  -- (1b) SEO never onboarded, already on a board -> mark + unblock; leave in place.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         onboarded_at=now()
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.onboarded_at is null and j.stage_id is not null
     and j.blocked_reason is distinct from 'billing_paused';

  -- (2) ads/social_media/maintenance -> Renewal (non-terminal) + unblock.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         stage_id=coalesce((select rs.id from public.pipeline_stages rs
                             where rs.board=j.service_type and rs.code='renewal' and not rs.archived limit 1), j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('ads','social_media','maintenance')
     and j.blocked_reason is distinct from 'billing_paused'
     and cur.id=j.stage_id and not cur.is_terminal;

  -- (3) everything else (web_dev, hosting, ai_seo parent) -> unblock only.
  update public.jobs
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
   where deal_id=p_deal_id and is_blocked and not archived
     and blocked_reason in ('account_on_hold','partial_payment_pending','awaiting_first_payment')
     and service_type not in ('web_seo','local_seo','ads','social_media','maintenance');
end $$;

-- --- BUG 2: το κλείσιμο deal σταματά πλέον τη χρέωση -------------------------
-- Σώμα από 20260626000021 με δύο αλλαγές: billing_active=false (η ουσία), και
-- ο ίδιος περιορισμός στο καθάρισμα του μπλοκαρίσματος. Μια υπηρεσία που
-- πάει στο Closed ΔΕΝ χρεώνεται άλλο — αυτό περιμένει κάθε χρήστης όταν
-- κλείνει ένα deal, και μόνο έτσι σταματούν οι υπενθυμίσεις πληρωμής.
create or replace function public.deals_close_jobs_on_close()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if new.accounting_stage_id is not distinct from old.accounting_stage_id then return new; end if;
  select code into v_code from public.pipeline_stages where id = new.accounting_stage_id and board='accounting_onboarding';
  if v_code <> 'closed' then return new; end if;

  update public.jobs j
     set status = 'completed', completed_at = coalesce(j.completed_at, now()),
         billing_active = false,
         is_blocked = case when j.blocked_reason is distinct from 'billing_paused' then false else j.is_blocked end,
         blocked_reason = case when j.blocked_reason is distinct from 'billing_paused' then null else j.blocked_reason end,
         blocked_at = case when j.blocked_reason is distinct from 'billing_paused' then null else j.blocked_at end,
         blocked_by = case when j.blocked_reason is distinct from 'billing_paused' then null else j.blocked_by end,
         stage_id = coalesce((select cs.id from public.pipeline_stages cs
                               where cs.board = cur.board and cs.code = 'closed' and not cs.archived limit 1),
                             j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id = new.id and not j.archived and cur.id = j.stage_id and not cur.is_terminal;
  return new;
end $$;

-- --- BUG 4: το End ακυρώνει τα ανεξόφλητα της αλυσίδας του -------------------
-- Σώμα αυτούσιο από 20260908120000· προστίθεται ΜΟΝΟ το βήμα ακύρωσης, με το
-- ίδιο ακριβώς φίλτρο που χρησιμοποιεί το job_pause_billing (20260806090000:
-- 92-98): μόνο recurring, μόνο pending/overdue — εξοφλημένα και εφάπαξ
-- οφειλές δεν αγγίζονται ποτέ.
create or replace function public.end_and_archive_job(p_job_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_job public.jobs;
  v_board text;
  v_closed uuid;
  v_unpaid numeric;
  v_actor uuid := auth.uid();
  v_client_name text;
  v_notified int := 0;
  v_found int;
  v_defer boolean;
  v_deferred_children int := 0;
  v_cancelled int := 0;
  m record;
begin
  if not (public.current_user_is_admin() or public.current_user_can('accounting_onboarding', 'edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into v_job from public.jobs where id = p_job_id and not archived;
  if not found then
    return jsonb_build_object('ok', false, 'errors', array['job_not_found']);
  end if;

  if v_job.pending_archive_reason is not null then
    return jsonb_build_object('ok', true, 'job_id', p_job_id, 'noop', true, 'pending_disconnect', true);
  end if;

  v_unpaid := public.job_unpaid_total(p_job_id);

  select coalesce(ps.board, v_job.service_type) into v_board
    from public.pipeline_stages ps where ps.id = v_job.stage_id;
  v_board := coalesce(v_board, v_job.service_type);

  select id into v_closed
    from public.pipeline_stages
   where board = v_board and code = 'closed' and archived = false
   limit 1;

  select c.name into v_client_name from public.clients c where c.id = v_job.client_id;

  v_defer := (v_job.service_type = 'local_seo' and v_job.disconnected_at is null);

  update public.jobs set
    billing_active = false,
    status = case when status in ('cancelled','completed') then status else 'completed' end,
    completed_at = coalesce(completed_at, now()),
    stage_id = coalesce(v_closed, stage_id),
    archived = not v_defer,
    archived_at = case when v_defer then null else now() end,
    archived_by = case when v_defer then null else v_actor end,
    archived_reason = case when v_defer then null else 'ended_by_accounting' end,
    pending_archive_reason = case when v_defer then 'ended_after_disconnect' else null end,
    updated_at = now()
   where id = p_job_id and not archived;
  get diagnostics v_found = row_count;
  if v_found = 0 then
    return jsonb_build_object('ok', true, 'job_id', p_job_id, 'unpaid_total', v_unpaid, 'notified', 0, 'noop', true);
  end if;

  -- ΝΕΟ 2026-09-11 (Bug 4): ακύρωση των ανεξόφλητων recurring της αλυσίδας.
  -- Χωρίς αυτό το End άφηνε πίσω του λογαριασμούς που συνέχιζαν να κυνηγούν
  -- πελάτες ήδη τερματισμένους (π.χ. 005761-LOCALSEO, 220€ εκπρόθεσμα).
  -- Ίδιο φίλτρο με το job_pause_billing: ιστορικό δεν σβήνεται, μόνο
  -- ακυρώνεται· εξοφλημένα και one_time μένουν άθικτα.
  update public.deal_payments dp
     set status = 'cancelled'
   where dp.deal_id = v_job.deal_id
     and dp.service_type = v_job.service_type
     and dp.billing_type in ('recurring_monthly','recurring_yearly')
     and dp.status in ('pending','overdue');
  get diagnostics v_cancelled = row_count;

  update public.jobs c set
    billing_active = false,
    status = case when c.status in ('cancelled','completed') then c.status else 'completed' end,
    completed_at = coalesce(c.completed_at, now()),
    stage_id = coalesce(
      (select id from public.pipeline_stages ps
        where ps.board = c.service_type and ps.code = 'closed' and ps.archived = false limit 1),
      c.stage_id),
    archived = not (c.service_type = 'local_seo' and c.disconnected_at is null),
    archived_at = case when c.service_type = 'local_seo' and c.disconnected_at is null
                       then null else now() end,
    archived_by = case when c.service_type = 'local_seo' and c.disconnected_at is null
                       then null else v_actor end,
    archived_reason = case when c.service_type = 'local_seo' and c.disconnected_at is null
                           then null else 'ended_by_accounting_cascade' end,
    pending_archive_reason = case when c.service_type = 'local_seo' and c.disconnected_at is null
                                  then 'ended_after_disconnect_cascade' else null end,
    updated_at = now()
   where c.parent_job_id = p_job_id and not c.archived;

  select count(*) into v_deferred_children
    from public.jobs c
   where c.parent_job_id = p_job_id and not c.archived
     and c.pending_archive_reason = 'ended_after_disconnect_cascade';

  insert into public.comments (parent_type, parent_id, author_id, body, task_key)
  values (
    'job', p_job_id, v_actor,
    (case when v_defer then
       'Η υπηρεσία έληξε. Η αρχειοθέτηση θα ολοκληρωθεί αυτόματα όταν το Local SEO κάνει disconnect από το προφίλ Google του πελάτη.'
     else
       'Η υπηρεσία έληξε και αρχειοθετήθηκε.'
     end)
    || (case when v_cancelled > 0 then
          ' Ακυρώθηκαν ' || v_cancelled::text || ' ανεξόφλητες περιοδικές πληρωμές.'
        else '' end)
    || (case when v_unpaid > 0 then
          ' ΠΡΟΣΟΧΗ: ανεξόφλητο υπόλοιπο ' || to_char(v_unpaid, 'FM999999990.00') || ' EUR τη στιγμή της λήξης.'
        else '' end)
    || (case when v_deferred_children > 0 then
          ' Η κάρτα «AI SEO — Local» μένει στο Closed του Local SEO μέχρι να γίνει disconnect και αρχειοθετείται τότε.'
        else '' end),
    'job_archived:' || p_job_id::text
  );

  for m in
    select r.user_id from (
      select p.user_id
        from public.profiles p
       where p.user_id = v_job.owner_user_id
         and p.is_active and not p.archived
      union
      select p.user_id
        from public.user_groups ug
        join public.profiles p on p.user_id = ug.user_id
       where v_job.owner_user_id is null
         and ug.group_id = v_job.assigned_group_id
         and p.is_active and not p.archived
    ) r
    where r.user_id <> coalesce(v_actor, '00000000-0000-0000-0000-000000000000'::uuid)
  loop
    insert into public.notifications (user_id, type, payload)
    values (
      m.user_id,
      'job_archived',
      jsonb_build_object(
        'job_id', v_job.id,
        'service_type', v_job.service_type,
        'job_code', coalesce(v_job.code, ''),
        'job_title', coalesce(v_job.title, ''),
        'client_name', coalesce(v_client_name, ''),
        'unpaid_total', v_unpaid,
        'pending_disconnect', (v_defer or v_deferred_children > 0),
        'parent_type', 'job',
        'parent_id', v_job.id
      )
    );
    v_notified := v_notified + 1;
  end loop;

  return jsonb_build_object(
    'ok', true, 'job_id', p_job_id, 'unpaid_total', v_unpaid, 'notified', v_notified,
    'payments_cancelled', v_cancelled,
    'pending_disconnect', (v_defer or v_deferred_children > 0));
end $$;
revoke execute on function public.end_and_archive_job(uuid) from public, anon;
grant execute on function public.end_and_archive_job(uuid) to authenticated;

-- ROLLBACK:
--   Επαναφορά των τριών σωμάτων από 20260903220000 (release_deal_jobs),
--   20260626000021 (deals_close_jobs_on_close) και 20260908120000
--   (end_and_archive_job).
