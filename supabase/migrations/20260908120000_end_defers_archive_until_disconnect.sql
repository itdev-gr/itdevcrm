-- =============================================================================
-- 20260908120000_end_defers_archive_until_disconnect.sql
-- Feedback Local SEO 2026-09-08 (Τσουβάρας): «όταν κλείνω κάποιον, δεν μου τον
-- πάει με Disconnect πάνω πάνω στη στήλη». Αιτία: το End→archive
-- (20260904200000) αρχειοθετεί το local_seo job αμέσως, οπότε η κόκκινη
-- «Disconnect» κάρτα του Closed lane (20260618000010 + pin στο board) δεν
-- εμφανίζεται ποτέ σε μη-admin — κανείς δεν θυμάται να αποσυνδεθεί από το GBP.
--
-- Απόφαση Α (owner 2026-09-08): το End σε local_seo job (ή στο «AI SEO — Local»
-- cascade παιδί) που ΔΕΝ έχει disconnected_at κάνει ό,τι έκανε (billing_active
-- = false, completed, μετακίνηση στο Closed) ΕΚΤΟΣ από archived = true. Αντί
-- γι' αυτό σημαδεύει τη νέα στήλη pending_archive_reason· η κάρτα μένει
-- καρφιτσωμένη κόκκινη στο Closed, και η αρχειοθέτηση ολοκληρώνεται αυτόματα
-- (trigger) μόλις το Local SEO πατήσει Disconnect. Το Undo του disconnect
-- γυρίζει συμμετρικά την κάρτα πίσω στο «Closed, εκκρεμεί disconnect».
--
-- Ασφάλεια χρέωσης: generator & pricing sync φιλτράρουν billing_active, όχι
-- μόνο archived (20260617000010/12/14, 20260619150000) — άρα το «ended αλλά
-- όχι ακόμη archived» job δεν χρεώνει, ίδια κατάσταση με το προ-4/9 end_job.
-- =============================================================================

-- --- 1. Στήλη-σημάδι: «θα αρχειοθετηθεί μόλις γίνει disconnect» ---------------
-- Κρατάει ΑΥΤΟΥΣΙΟ το archived_reason που θα γραφτεί όταν κλείσει ο κύκλος,
-- ώστε να διατηρείται η προέλευση (σκέτο End vs cascade από AI SEO γονιό).
alter table public.jobs add column if not exists pending_archive_reason text;
alter table public.jobs drop constraint if exists jobs_pending_archive_reason_check;
alter table public.jobs add constraint jobs_pending_archive_reason_check
  check (pending_archive_reason is null
         or pending_archive_reason in ('ended_after_disconnect', 'ended_after_disconnect_cascade'));
comment on column public.jobs.pending_archive_reason is
  'Non-null = the service was Ended by accounting but archiving waits for the Local SEO GBP disconnect; holds the archived_reason that will be stamped when disconnected_at is set (trigger trg_jobs_complete_archive_on_disconnect).';

-- --- 2. Trigger: το disconnect ολοκληρώνει (ή το Undo αναιρεί) το archive -----
-- SECURITY DEFINER μόνο για το audit comment (τα RLS των comments δεν πρέπει
-- να μπλοκάρουν το disconnect)· κατά τα άλλα μεταλλάσσει μόνο το NEW row.
create or replace function public.jobs_complete_archive_on_disconnect()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Disconnect σε job που περιμένει αρχειοθέτηση → ολοκλήρωσέ την τώρα.
  if new.disconnected_at is not null and old.disconnected_at is null
     and new.pending_archive_reason is not null and not new.archived then
    new.archived := true;
    new.archived_at := now();
    new.archived_by := coalesce(new.disconnected_by, auth.uid());
    new.archived_reason := new.pending_archive_reason;
    new.pending_archive_reason := null;
    insert into public.comments (parent_type, parent_id, author_id, body, task_key)
    values ('job', new.id, new.archived_by,
            'Έγινε disconnect — η αρχειοθέτηση της υπηρεσίας ολοκληρώθηκε αυτόματα.',
            'job_archived:' || new.id::text);

  -- Undo του disconnect σε local_seo job που αρχειοθέτησε το End → η κάρτα
  -- ξαναγίνεται «Closed, εκκρεμεί disconnect» (κόκκινη, καρφιτσωμένη). Πιάνει
  -- και τα άμεσα-archived (End πάνω σε ήδη-πράσινο job): αν η ομάδα λέει «τελικά
  -- κρατάμε ακόμα πρόσβαση», το reminder πρέπει να ξαναφανεί.
  elsif new.disconnected_at is null and old.disconnected_at is not null
     and new.archived
     and (new.archived_reason in ('ended_after_disconnect', 'ended_after_disconnect_cascade')
          or (new.service_type = 'local_seo'
              and new.archived_reason in ('ended_by_accounting', 'ended_by_accounting_cascade'))) then
    new.pending_archive_reason := case
      when new.archived_reason like '%cascade' then 'ended_after_disconnect_cascade'
      else 'ended_after_disconnect' end;
    new.archived := false;
    new.archived_at := null;
    new.archived_by := null;
    new.archived_reason := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_jobs_complete_archive_on_disconnect on public.jobs;
create trigger trg_jobs_complete_archive_on_disconnect
  before update of disconnected_at on public.jobs
  for each row execute function public.jobs_complete_archive_on_disconnect();

-- --- 3. end_and_archive_job: αναβολή του archive για local_seo χωρίς disconnect
-- Σώμα από το 20260904200000 με τις αλλαγές του deferral (σχολιασμένες).
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
  m record;
begin
  if not (public.current_user_is_admin() or public.current_user_can('accounting_onboarding', 'edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into v_job from public.jobs where id = p_job_id and not archived;
  if not found then
    return jsonb_build_object('ok', false, 'errors', array['job_not_found']);
  end if;

  -- Ήδη ended και περιμένει disconnect → δεύτερο End είναι no-op (χωρίς νέο
  -- σχόλιο ή ειδοποιήσεις).
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

  -- Απόφαση Α: local_seo χωρίς disconnect → όλα εκτός archive.
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

  -- Cascade στα AI SEO work-card παιδιά: το local_seo παιδί («AI SEO — Local»)
  -- χωρίς disconnect παίρνει το ίδιο deferral· τα υπόλοιπα όπως πριν.
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

  -- Audit στο timeline του job: ποιος, πότε, τι χρωστιέται, τι εκκρεμεί.
  insert into public.comments (parent_type, parent_id, author_id, body, task_key)
  values (
    'job', p_job_id, v_actor,
    (case when v_defer then
       'Η υπηρεσία έληξε. Η αρχειοθέτηση θα ολοκληρωθεί αυτόματα όταν το Local SEO κάνει disconnect από το προφίλ Google του πελάτη.'
     else
       'Η υπηρεσία έληξε και αρχειοθετήθηκε.'
     end)
    || (case when v_unpaid > 0 then
          ' ΠΡΟΣΟΧΗ: ανεξόφλητο υπόλοιπο ' || to_char(v_unpaid, 'FM999999990.00') || ' EUR τη στιγμή της λήξης.'
        else '' end)
    || (case when v_deferred_children > 0 then
          ' Η κάρτα «AI SEO — Local» μένει στο Closed του Local SEO μέχρι να γίνει disconnect και αρχειοθετείται τότε.'
        else '' end),
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
        'pending_disconnect', (v_defer or v_deferred_children > 0),
        'parent_type', 'job',
        'parent_id', v_job.id
      )
    );
    v_notified := v_notified + 1;
  end loop;

  return jsonb_build_object(
    'ok', true, 'job_id', p_job_id, 'unpaid_total', v_unpaid, 'notified', v_notified,
    'pending_disconnect', (v_defer or v_deferred_children > 0));
end $$;
revoke execute on function public.end_and_archive_job(uuid) from public, anon;
grant execute on function public.end_and_archive_job(uuid) to authenticated;

-- --- 4. unarchive_job: καθάρισε και το pending σημάδι στην επαναφορά ---------
-- Αν ο admin επαναφέρει την υπηρεσία, ένα μεταγενέστερο disconnect ΔΕΝ πρέπει
-- να την αρχειοθετήσει σιωπηλά — το pending_archive_reason μηδενίζεται σε
-- γονιό ΚΑΙ παιδιά. Το child-restore match δέχεται πλέον και τον
-- disconnect-completed λόγο (ended_after_disconnect_cascade), ώστε η επαναφορά
-- του AI SEO γονιού να ξαναφέρνει και το ήδη-disconnected Local παιδί.
-- Κατά τα άλλα το σώμα είναι αυτούσιο από το 20260904200000 (βλ. εκεί τα
-- σχόλια NEW-1/NEW-2 για το pause-stamp).
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
    pending_archive_reason = null,
    -- Pause-stamp ΜΟΝΟ αν η χρέωση όντως είχε σταματήσει (RHS = παλιά τιμή).
    is_blocked = case when not billing_active then true else is_blocked end,
    blocked_reason = case when not billing_active then 'billing_paused' else blocked_reason end,
    blocked_at = case when not billing_active then now() else blocked_at end,
    blocked_by = case when not billing_active then v_actor else blocked_by end,
    updated_at = now()
   where id = p_job_id and archived;
  get diagnostics v_found = row_count;
  if v_found = 0 then
    return jsonb_build_object('ok', false, 'errors', array['job_not_found']);
  end if;

  -- Παιδιά: ΜΟΝΟ επαναφορά από το archive, ποτέ pause-stamp (NEW-2).
  update public.jobs c set
    archived = false, archived_at = null, archived_by = null,
    archived_reason = null,
    pending_archive_reason = null,
    updated_at = now()
   where c.parent_job_id = p_job_id
     and c.archived
     and c.archived_reason in ('ended_by_accounting_cascade', 'ended_after_disconnect_cascade');

  -- Παιδί που ΔΕΝ πρόλαβε να αρχειοθετηθεί (περίμενε disconnect): μόνο το
  -- σημάδι φεύγει — η υπηρεσία ξαναζεί, το disconnect δεν θα την αρχειοθετήσει.
  update public.jobs c set
    pending_archive_reason = null,
    updated_at = now()
   where c.parent_job_id = p_job_id
     and not c.archived
     and c.pending_archive_reason is not null;

  insert into public.comments (parent_type, parent_id, author_id, body)
  values ('job', p_job_id, v_actor, 'Η υπηρεσία επαναφέρθηκε από τα αρχειοθετημένα.');

  return jsonb_build_object('ok', true, 'job_id', p_job_id);
end $$;
revoke execute on function public.unarchive_job(uuid) from public, anon;
grant execute on function public.unarchive_job(uuid) to authenticated;

-- --- 5. Backfill: τα ήδη-Ended local_seo jobs που δεν έκαναν ποτέ disconnect --
-- Τα End από 4/9 μέχρι σήμερα αρχειοθέτησαν local_seo jobs χωρίς disconnect —
-- ακριβώς οι περιπτώσεις που ανέφερε ο Τσουβάρας. Γύρνα τα στο νέο καθεστώς:
-- ξανά ορατά στο Closed (κόκκινα, καρφιτσωμένα) μέχρι να γίνει το disconnect.
-- Οι λόγοι ended_by_accounting* γεννήθηκαν στο 20260904200000, άρα δεν
-- υπάρχουν παλαιότερες γραμμές να παρασυρθούν.
update public.jobs set
  archived = false,
  archived_at = null,
  archived_by = null,
  pending_archive_reason = case when archived_reason = 'ended_by_accounting_cascade'
                                then 'ended_after_disconnect_cascade'
                                else 'ended_after_disconnect' end,
  archived_reason = null,
  updated_at = now()
 where service_type = 'local_seo'
   and archived
   and archived_reason in ('ended_by_accounting', 'ended_by_accounting_cascade')
   and disconnected_at is null;

-- ROLLBACK:
--   drop trigger if exists trg_jobs_complete_archive_on_disconnect on public.jobs;
--   drop function if exists public.jobs_complete_archive_on_disconnect();
--   update public.jobs set archived = true, archived_at = now(),
--     archived_reason = case when pending_archive_reason = 'ended_after_disconnect_cascade'
--                            then 'ended_by_accounting_cascade' else 'ended_by_accounting' end,
--     pending_archive_reason = null
--    where pending_archive_reason is not null;
--   alter table public.jobs drop column pending_archive_reason;
--   και ξανατρέξε τα function bodies του 20260904200000.
