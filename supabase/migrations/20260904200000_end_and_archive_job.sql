-- =============================================================================
-- 20260904200000_end_and_archive_job.sql
-- Owner (2026-09-04): το End στο JOBS & BILLING πλέον ΛΗΓΕΙ ΚΑΙ ΑΡΧΕΙΟΘΕΤΕΙ την
-- υπηρεσία («τελείωσε τελείως και δεν θα συνεχίσουμε»), μετά από παράθυρο
-- επιβεβαίωσης στον χρήστη που το πατάει (ΟΧΙ έγκριση δεύτερου ατόμου), και
-- ειδοποιεί τον υπεύθυνο του job ότι τελείωσε.
--
-- Το jobs.archived ήταν μέχρι σήμερα νεκρή στήλη που ΚΑΘΕ query φιλτράρει
-- (archived = false): boards, recurring billing generator, deal pricing sync.
-- Άρα archived = true βγάζει το job από παντού χωρίς αλλαγή σε καμία query.
--
-- Το end_job και το job_pause_billing ΔΕΝ αλλάζουν (το Pause είναι ξεχωριστή,
-- αναστρέψιμη λειτουργία και το end_job μένει για ό,τι το καλεί ήδη).
-- =============================================================================

-- --- 1. Ανεξόφλητο υπόλοιπο της υπηρεσίας -----------------------------------
-- Ίδια κοκκοποίηση (deal_id, service_type) με το job_pause_billing όταν ακυρώνει
-- γραμμές. amount_gross = αυτό που χρωστάει ο πελάτης (με ΦΠΑ).
-- SECURITY DEFINER + granted to authenticated ⇒ χωρίς φραγή θα ήταν money
-- oracle: οποιοσδήποτε τεχνικός θα μπορούσε να ζητήσει το ανεξόφλητο
-- οποιουδήποτε πελάτη από την κονσόλα. Ίδιο predicate με το end_and_archive_job
-- παρακάτω· αποτυχία επιστρέφει 0 (όχι raise) ώστε το dialog απλά να μη δείξει
-- προειδοποίηση αντί να σκάσει.
create or replace function public.job_unpaid_total(p_job_id uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(dp.amount_gross), 0)
    from public.jobs j
    join public.deal_payments dp
      on dp.deal_id = j.deal_id
     and dp.service_type = j.service_type
   where j.id = p_job_id
     and dp.status in ('pending', 'overdue')
     and (public.current_user_is_admin() or public.current_user_can('accounting_onboarding', 'edit'));
$$;
revoke execute on function public.job_unpaid_total(uuid) from public, anon;
grant execute on function public.job_unpaid_total(uuid) to authenticated;

-- --- 2. Λήξη + αρχειοθέτηση --------------------------------------------------
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
  m record;
begin
  if not (public.current_user_is_admin() or public.current_user_can('accounting_onboarding', 'edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into v_job from public.jobs where id = p_job_id and not archived;
  if not found then
    return jsonb_build_object('ok', false, 'errors', array['job_not_found']);
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

  -- Ό,τι κάνει το end_job, ΣΥΝ archive stamp.
  update public.jobs set
    billing_active = false,
    status = case when status in ('cancelled','completed') then status else 'completed' end,
    completed_at = coalesce(completed_at, now()),
    stage_id = coalesce(v_closed, stage_id),
    archived = true,
    archived_at = now(),
    archived_by = v_actor,
    archived_reason = 'ended_by_accounting',
    updated_at = now()
   where id = p_job_id and not archived;
  get diagnostics v_found = row_count;
  if v_found = 0 then
    return jsonb_build_object('ok', true, 'job_id', p_job_id, 'unpaid_total', v_unpaid, 'notified', 0, 'noop', true);
  end if;

  -- Cascade στα AI SEO work-card παιδιά (καθένα στο δικό του closed lane).
  update public.jobs c set
    billing_active = false,
    status = case when c.status in ('cancelled','completed') then c.status else 'completed' end,
    completed_at = coalesce(c.completed_at, now()),
    stage_id = coalesce(
      (select id from public.pipeline_stages ps
        where ps.board = c.service_type and ps.code = 'closed' and ps.archived = false limit 1),
      c.stage_id),
    archived = true,
    archived_at = now(),
    archived_by = v_actor,
    archived_reason = 'ended_by_accounting_cascade',
    updated_at = now()
   where c.parent_job_id = p_job_id and not c.archived;

  -- Audit στο timeline του job: ποιος, πότε, και τι χρωστιέται.
  insert into public.comments (parent_type, parent_id, author_id, body, task_key)
  values (
    'job', p_job_id, v_actor,
    case when v_unpaid > 0 then
      'Η υπηρεσία έληξε και αρχειοθετήθηκε. ΠΡΟΣΟΧΗ: ανεξόφλητο υπόλοιπο '
        || to_char(v_unpaid, 'FM999999990.00') || ' EUR τη στιγμή της αρχειοθέτησης.'
    else
      'Η υπηρεσία έληξε και αρχειοθετήθηκε.'
    end,
    'job_archived:' || p_job_id::text
  );

  -- Ειδοποίηση στον υπεύθυνο· αν δεν υπάρχει, στα μέλη του τμήματος του job.
  -- Ο ίδιος ο δράστης δεν ειδοποιεί τον εαυτό του.
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
        'parent_type', 'job',
        'parent_id', v_job.id
      )
    );
    v_notified := v_notified + 1;
  end loop;

  return jsonb_build_object(
    'ok', true, 'job_id', p_job_id, 'unpaid_total', v_unpaid, 'notified', v_notified);
end $$;
revoke execute on function public.end_and_archive_job(uuid) from public, anon;
grant execute on function public.end_and_archive_job(uuid) to authenticated;

-- --- 3. Επαναφορά (μόνο admin) -----------------------------------------------
-- Το job γυρίζει από τα Αρχειοθετημένα στο Closed lane όπου το άφησε το End.
-- Η χρέωση ΔΕΝ ξαναρχίζει αυτόματα — billing_active μένει false, αλλά το job
-- μπαίνει ΑΚΡΙΒΩΣ στην ίδια κατάσταση που αφήνει το job_pause_billing
-- (is_blocked/blocked_reason='billing_paused'/blocked_at/blocked_by), ώστε το
-- ήδη υπάρχον Resume billing κουμπί (JobBillingPauseCard / JobsBillingPanel
-- showResume) να εμφανιστεί και να δουλέψει· διαφορετικά το restored job
-- φαίνεται ζωντανό στο board αλλά καμία χρέωση δεν μπορεί ποτέ να ξαναρχίσει.
create or replace function public.unarchive_job(p_job_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_found int;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  update public.jobs set
    archived = false,
    archived_at = null,
    archived_by = null,
    archived_reason = null,
    is_blocked = true,
    blocked_reason = 'billing_paused',
    blocked_at = now(),
    blocked_by = v_actor,
    updated_at = now()
   where id = p_job_id and archived;
  get diagnostics v_found = row_count;
  if v_found = 0 then
    return jsonb_build_object('ok', false, 'errors', array['job_not_found']);
  end if;

  update public.jobs c set
    archived = false, archived_at = null, archived_by = null,
    archived_reason = null,
    is_blocked = true,
    blocked_reason = 'billing_paused',
    blocked_at = now(),
    blocked_by = v_actor,
    updated_at = now()
   where c.parent_job_id = p_job_id
     and c.archived
     and c.archived_reason = 'ended_by_accounting_cascade';

  insert into public.comments (parent_type, parent_id, author_id, body)
  values ('job', p_job_id, v_actor, 'Η υπηρεσία επαναφέρθηκε από τα αρχειοθετημένα.');

  return jsonb_build_object('ok', true, 'job_id', p_job_id);
end $$;
revoke execute on function public.unarchive_job(uuid) from public, anon;
grant execute on function public.unarchive_job(uuid) to authenticated;

-- ROLLBACK: drop function public.end_and_archive_job(uuid), public.unarchive_job(uuid),
-- public.job_unpaid_total(uuid);  -- το end_job παραμένει ανέπαφο, οπότε το UI
-- μπορεί να γυρίσει στην προηγούμενη συμπεριφορά αλλάζοντας μόνο το frontend.
