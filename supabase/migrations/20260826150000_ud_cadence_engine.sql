-- =============================================================================
-- 2026-08-26: Under Development pipeline, Phase 2 — the TASK-CADENCE ENGINE.
--
-- The clock runs from the REP'S ACTIONS, not from stage-entry dates: entering
-- a stage starts a chain of steps (emails + tasks); a task closes only with an
-- outcome («Μίλησα» / «Δεν απάντησε»); failure fires the step's email
-- IMMEDIATELY (owner decision) and creates the next task due +N CALENDAR days
-- (owner decision); success stops the chain. Chain exhaustion returns the
-- cadence's suggested terminal stage so the UI can offer the move (user's
-- choice, per spec).
--
-- Everything binds to ud_* stage codes only — the classic sales system is
-- untouched (owner hard requirement). Reuses enqueue_lead_email (owner-Gmail
-- + CC sales@, dedupe, opt-out/automations_enabled gates) and the existing
-- user_tasks auto-comment triggers (📋/✅ land on the lead timeline for free).
-- Email steps respect the same email_automation_enabled('dept_sales') gate the
-- legacy sequences use. Dedupe keys embed the lead uuid so lead_email_statuses
-- (LIKE '%<lead_id>%') shows cadence emails in the lead's Emails box.
--
-- No existing function is redefined — everything here is net-new. Cron:
-- process_ud_cadences */5 (due email steps, e.g. the +3d offer check-in).
--
-- ROLLBACK: see the block at the end of this file.
-- =============================================================================

-- 1. Cadence definitions (admin-editable; the Phase 5 admin UI mutates these) --

create table public.ud_cadences (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  display_names jsonb not null,
  start_stage_code text not null unique,   -- ud_* code whose entry starts this chain
  final_move_stage_code text,              -- suggested stage when the chain exhausts
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ud_cadence_steps (
  id uuid primary key default gen_random_uuid(),
  cadence_id uuid not null references public.ud_cadences(id) on delete cascade,
  position int not null,
  kind text not null check (kind in ('task', 'email')),
  -- Calendar days from the PREVIOUS chain event (start / email sent / task closed).
  delay_days int not null default 0 check (delay_days >= 0),
  titles jsonb,        -- task steps: {en, el}
  template_key text,   -- email steps
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cadence_id, position),
  check ((kind = 'task' and titles is not null) or (kind = 'email' and template_key is not null))
);

create table public.ud_cadence_runs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  cadence_id uuid not null references public.ud_cadences(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active','paused','completed','stopped_reached','stopped_stage_change','stopped_manual')),
  current_position int not null default 0,   -- last processed step position
  last_event_at timestamptz not null default now(),
  next_event_at timestamptz,                 -- when a pending EMAIL step is due (null = waiting on a task / nothing)
  current_task_id uuid references public.user_tasks(id) on delete set null,
  exhausted_at timestamptz,
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live chain per lead; the cron scans due email steps cheaply.
create unique index ud_cadence_runs_one_live on public.ud_cadence_runs (lead_id)
  where status in ('active', 'paused');
create index ud_cadence_runs_due on public.ud_cadence_runs (next_event_at)
  where status = 'active' and next_event_at is not null;
create index ud_cadence_runs_lead on public.ud_cadence_runs (lead_id, started_at desc);

create trigger ud_cadences_set_updated_at
  before update on public.ud_cadences
  for each row execute function public.set_updated_at();
create trigger ud_cadence_steps_set_updated_at
  before update on public.ud_cadence_steps
  for each row execute function public.set_updated_at();
create trigger ud_cadence_runs_set_updated_at
  before update on public.ud_cadence_runs
  for each row execute function public.set_updated_at();

alter table public.ud_cadences enable row level security;
alter table public.ud_cadence_steps enable row level security;
alter table public.ud_cadence_runs enable row level security;

create policy ud_cadences_select on public.ud_cadences
  for select to authenticated using (true);
create policy ud_cadences_mutate_admin on public.ud_cadences
  for all to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create policy ud_cadence_steps_select on public.ud_cadence_steps
  for select to authenticated using (true);
create policy ud_cadence_steps_mutate_admin on public.ud_cadence_steps
  for all to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());

-- Runs are visible iff the lead is visible (leads RLS scopes the subquery);
-- all writes go through the SECURITY DEFINER engine functions below.
create policy ud_cadence_runs_select on public.ud_cadence_runs
  for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));

-- 2. user_tasks becomes cadence-aware ----------------------------------------

alter table public.user_tasks
  add column if not exists cadence_run_id uuid references public.ud_cadence_runs(id) on delete set null,
  add column if not exists cadence_step_id uuid references public.ud_cadence_steps(id) on delete set null,
  add column if not exists cadence_outcome text
    check (cadence_outcome in ('reached', 'no_answer', 'superseded'));

create index if not exists user_tasks_cadence_run on public.user_tasks (cadence_run_id)
  where cadence_run_id is not null;

-- A cadence task may only close WITH an outcome — the generic resolve path
-- (resolve_task RPC, board drag) is rejected so the chain can never silently
-- stall; the UD outcome buttons and the engine set the outcome in the same
-- UPDATE and pass.
create or replace function public.user_tasks_require_cadence_outcome()
returns trigger
language plpgsql as $$
begin
  if new.cadence_run_id is not null and new.cadence_outcome is null then
    raise exception 'cadence_outcome_required'
      using hint = 'Close this task from the lead page («Μίλησα» / «Δεν απάντησε»).';
  end if;
  return new;
end $$;

create trigger user_tasks_require_cadence_outcome
  before update on public.user_tasks
  for each row when (old.completed_at is null and new.completed_at is not null)
  execute function public.user_tasks_require_cadence_outcome();

-- 3. The engine ---------------------------------------------------------------

-- Close the lead's live run (stage change / manual). Supersedes the open task
-- so it leaves the rep's list (outcome 'superseded' satisfies the guard).
create or replace function public.ud_stop_live_run(p_lead_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.ud_cadence_runs;
begin
  select * into r from public.ud_cadence_runs
   where lead_id = p_lead_id and status in ('active', 'paused')
   for update;
  if r is null then return; end if;

  -- Same txn-local GUC the resolve/unresolve RPCs set — lets the
  -- tasks_guard_terminal trigger accept the supersede UPDATE below.
  perform set_config('app.task_resolve_rpc', '1', true);

  if r.current_task_id is not null then
    update public.user_tasks
       set completed_at = now(), cadence_outcome = 'superseded'
     where id = r.current_task_id and completed_at is null;
  end if;

  update public.ud_cadence_runs
     set status = p_reason, next_event_at = null, current_task_id = null
   where id = r.id;
end $$;

-- Walk the chain: due email steps fire now (dept_sales-gated, deduped),
-- a future email step parks in next_event_at for the cron, a task step
-- creates the rep's task (due = last event + delay, calendar days) and waits.
create or replace function public.ud_advance_run(p_run_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.ud_cadence_runs;
  s public.ud_cadence_steps;
  l public.leads;
  v_assignee uuid;
  v_due timestamptz;
  v_task_id uuid;
begin
  loop
    select * into r from public.ud_cadence_runs where id = p_run_id for update;
    if r is null or r.status <> 'active' then return; end if;

    select * into s from public.ud_cadence_steps
     where cadence_id = r.cadence_id and position > r.current_position and enabled
     order by position limit 1;

    if s is null then
      -- Chain fully processed (only reachable when the last step is an email;
      -- a final task's exhaustion is reported by ud_complete_cadence_task).
      update public.ud_cadence_runs
         set status = 'completed', exhausted_at = now(), next_event_at = null
       where id = p_run_id;
      return;
    end if;

    if s.kind = 'email' then
      v_due := r.last_event_at + make_interval(days => s.delay_days);
      if v_due <= now() then
        if public.email_automation_enabled('dept_sales') then
          perform public.enqueue_lead_email(
            r.lead_id, s.template_key,
            'udcad:' || r.lead_id || ':' || s.id || ':' || r.id);
        end if;
        update public.ud_cadence_runs
           set current_position = s.position, last_event_at = now(), next_event_at = null
         where id = p_run_id;
        -- loop on to the next step
      else
        update public.ud_cadence_runs set next_event_at = v_due where id = p_run_id;
        return;
      end if;
    else
      select * into l from public.leads where id = r.lead_id;
      v_assignee := coalesce(l.owner_user_id, l.created_by);
      if v_assignee is null then
        -- No one to work the task: park (chain resumes if re-entered with an owner).
        update public.ud_cadence_runs set next_event_at = null where id = p_run_id;
        return;
      end if;
      v_due := greatest(now(), r.last_event_at + make_interval(days => s.delay_days));
      insert into public.user_tasks
        (user_id, created_by, title, notes, due_at, importance, lead_id,
         cadence_run_id, cadence_step_id)
      values
        (v_assignee, v_assignee,
         coalesce(s.titles ->> 'el', s.titles ->> 'en', 'Cadence task'),
         'Αυτόματο task ροής Under Development — κλείνει με «Μίλησα» ή «Δεν απάντησε» από την καρτέλα του lead.',
         v_due, 'high', r.lead_id, r.id, s.id)
      returning id into v_task_id;
      update public.ud_cadence_runs
         set current_position = s.position, current_task_id = v_task_id, next_event_at = null
       where id = p_run_id;
      return;
    end if;
  end loop;
end $$;

-- Entering a UD stage: close whatever chain was live, start the stage's chain.
create or replace function public.ud_start_cadence_run(p_lead_id uuid, p_stage_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  c public.ud_cadences;
  v_run_id uuid;
begin
  perform public.ud_stop_live_run(p_lead_id, 'stopped_stage_change');

  select code into v_code from public.pipeline_stages
   where id = p_stage_id and board = 'under_development';
  if v_code is null then return; end if;

  select * into c from public.ud_cadences
   where start_stage_code = v_code and enabled;
  if c is null then return; end if;

  insert into public.ud_cadence_runs (lead_id, cadence_id)
  values (p_lead_id, c.id)
  returning id into v_run_id;

  perform public.ud_advance_run(v_run_id);
end $$;

-- Rep closes a cadence task with an outcome. Returns what happened so the UI
-- can toast / open the final-move dialog:
--   {ok, result: 'stopped_reached'|'advanced'|'exhausted'|'no_live_run',
--    final_move_stage_id?, final_move_stage_code?}
create or replace function public.ud_complete_cadence_task(p_task_id uuid, p_outcome text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.user_tasks;
  r public.ud_cadence_runs;
  c public.ud_cadences;
  v_next public.ud_cadence_steps;
  v_move_id uuid;
begin
  if p_outcome not in ('reached', 'no_answer') then
    return jsonb_build_object('ok', false, 'error', 'invalid_outcome');
  end if;

  select * into t from public.user_tasks where id = p_task_id for update;
  if t is null or t.cadence_run_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_a_cadence_task');
  end if;
  if t.completed_at is not null then
    return jsonb_build_object('ok', false, 'error', 'already_completed');
  end if;
  if not (auth.uid() = t.user_id or public.current_user_is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'permission_denied');
  end if;

  -- Terminal-guard bypass (same GUC as resolve_task) — the outcome guard
  -- still applies and is satisfied by cadence_outcome in the same UPDATE.
  perform set_config('app.task_resolve_rpc', '1', true);

  update public.user_tasks
     set completed_at = now(), cadence_outcome = p_outcome,
         creator_resolved_at = now(), assignee_resolved_at = now()
   where id = p_task_id;

  select * into r from public.ud_cadence_runs where id = t.cadence_run_id for update;
  if r is null or r.status <> 'active' then
    return jsonb_build_object('ok', true, 'result', 'no_live_run');
  end if;

  update public.ud_cadence_runs
     set current_task_id = null, last_event_at = now()
   where id = r.id;

  if p_outcome = 'reached' then
    update public.ud_cadence_runs
       set status = 'stopped_reached', next_event_at = null
     where id = r.id;
    return jsonb_build_object('ok', true, 'result', 'stopped_reached');
  end if;

  -- Failure: is there anything left in the chain?
  select * into v_next from public.ud_cadence_steps
   where cadence_id = r.cadence_id and position > r.current_position and enabled
   order by position limit 1;

  if v_next is null then
    select * into c from public.ud_cadences where id = r.cadence_id;
    update public.ud_cadence_runs
       set status = 'completed', exhausted_at = now(), next_event_at = null
     where id = r.id;
    select id into v_move_id from public.pipeline_stages
     where board = 'under_development' and code = c.final_move_stage_code;
    return jsonb_build_object(
      'ok', true, 'result', 'exhausted',
      'final_move_stage_id', v_move_id,
      'final_move_stage_code', c.final_move_stage_code);
  end if;

  perform public.ud_advance_run(r.id);
  return jsonb_build_object('ok', true, 'result', 'advanced');
end $$;

-- Cron worker: fire email steps that came due (e.g. the +3d offer check-in).
create or replace function public.ud_process_due_runs()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  for v_id in
    select id from public.ud_cadence_runs
     where status = 'active' and next_event_at is not null and next_event_at <= now()
     order by next_event_at
  loop
    perform public.ud_advance_run(v_id);
  end loop;
end $$;

-- 4. Lead triggers (UD board only — a non-UD stage just stops any live run) ---

create or replace function public.ud_leads_cadence_automations()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.stage_id is not null then
      perform public.ud_start_cadence_run(new.id, new.stage_id);
    end if;
    return new;
  end if;
  -- UPDATE of stage_id (trigger WHEN-clause guarantees a real change).
  perform public.ud_start_cadence_run(new.id, new.stage_id);
  return new;
end $$;

create trigger trg_ud_leads_cadence_ins
  after insert on public.leads
  for each row execute function public.ud_leads_cadence_automations();

create trigger trg_ud_leads_cadence_upd
  after update of stage_id on public.leads
  for each row when (old.stage_id is distinct from new.stage_id)
  execute function public.ud_leads_cadence_automations();

-- 5. Grants (repo convention: secdef internals are not client-callable) -------

revoke execute on function public.ud_stop_live_run(uuid, text) from public, anon, authenticated;
revoke execute on function public.ud_advance_run(uuid) from public, anon, authenticated;
revoke execute on function public.ud_start_cadence_run(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.ud_process_due_runs() from public, anon, authenticated;
grant execute on function public.ud_complete_cadence_task(uuid, text) to authenticated;

-- 6. Cron ---------------------------------------------------------------------

select cron.schedule('process_ud_cadences', '*/5 * * * *',
  $$select public.ud_process_due_runs()$$);

-- 7. Placeholder templates (owner will deliver final copy — swap in place) ----

insert into public.email_templates (key, description, subject, body, variables, client_facing) values
('ud_noanswer_1',
 '[UD cadence — PLACEHOLDER, τελικά κείμενα από τον owner] Πρώτο email όταν το lead μπει σε No Answer',
 'Προσπαθήσαμε να επικοινωνήσουμε μαζί σας',
 E'Γεια σας {{name}},\n\nΣας καλέσαμε σήμερα αλλά δεν τα καταφέραμε να σας βρούμε. Θα προσπαθήσουμε ξανά τις επόμενες ημέρες — αν σας βολεύει συγκεκριμένη ώρα, απαντήστε σε αυτό το email.\n\nΜε εκτίμηση,\n{{owner_name}}\nITDev',
 'name, company, owner_name', true),
('ud_noanswer_2',
 '[UD cadence — PLACEHOLDER] Μετά από αποτυχημένο Callback',
 'Δεύτερη προσπάθεια επικοινωνίας',
 E'Γεια σας {{name}},\n\nΠροσπάθησα να επικοινωνήσω εκ νέου μαζί σας χωρίς επιτυχία. Θα χαρώ να τα πούμε όποτε σας βολεύει — απαντήστε μου με μια ώρα που σας εξυπηρετεί.\n\nΜε εκτίμηση,\n{{owner_name}}\nITDev',
 'name, company, owner_name', true),
('ud_noanswer_3',
 '[UD cadence — PLACEHOLDER] Μετά από αποτυχημένο 2nd Callback',
 'Τελευταία προσπάθεια επικοινωνίας',
 E'Γεια σας {{name}},\n\nΔεν καταφέραμε να σας βρούμε στις προηγούμενες προσπάθειες. Θα πραγματοποιήσουμε μία τελευταία προσπάθεια τις επόμενες ημέρες — αν εξακολουθεί να σας ενδιαφέρει, απαντήστε σε αυτό το email.\n\nΜε εκτίμηση,\n{{owner_name}}\nITDev',
 'name, company, owner_name', true),
('ud_offer_checkin',
 '[UD cadence — PLACEHOLDER] Check-in 3 μέρες μετά την προσφορά',
 'Σχετικά με την προσφορά μας',
 E'Γεια σας {{name}},\n\nΕλπίζω να είχατε την ευκαιρία να δείτε την προσφορά που σας στείλαμε. Αν έχετε οποιαδήποτε απορία, είμαι στη διάθεσή σας — μπορούμε να τα πούμε και τηλεφωνικά.\n\nΜε εκτίμηση,\n{{owner_name}}\nITDev',
 'name, company, owner_name', true),
('ud_offer_followup_1',
 '[UD cadence — PLACEHOLDER] Μετά από αποτυχημένο Follow-up Call',
 'Προσπάθησα να σας καλέσω για την προσφορά',
 E'Γεια σας {{name}},\n\nΠροσπάθησα να επικοινωνήσω μαζί σας για να συζητήσουμε την προσφορά, χωρίς επιτυχία. Θα χαρώ να τα πούμε όποτε σας βολεύει.\n\nΜε εκτίμηση,\n{{owner_name}}\nITDev',
 'name, company, owner_name', true),
('ud_offer_followup_2',
 '[UD cadence — PLACEHOLDER] Μετά από αποτυχημένο 2nd Follow-up',
 'Ενδιαφέρεστε τελικά για την προσφορά;',
 E'Γεια σας {{name}},\n\nΔεν κατάφερα να σας βρω εκ νέου. Αν η προσφορά μας εξακολουθεί να σας ενδιαφέρει, απαντήστε σε αυτό το email ή πείτε μας πότε να σας καλέσουμε — αλλιώς θα κλείσουμε τον φάκελο.\n\nΜε εκτίμηση,\n{{owner_name}}\nITDev',
 'name, company, owner_name', true)
on conflict (key) do nothing;

-- 8. Seed the three cadences (delays per the approved plan; admin-editable) ---

do $$
declare
  v_first uuid; v_noans uuid; v_offer uuid;
begin
  insert into public.ud_cadences (key, display_names, start_stage_code, final_move_stage_code)
  values ('ud_first_call',
          '{"en": "New Lead — 1st Call", "el": "Νέος Πελάτης — 1η Κλήση"}'::jsonb,
          'ud_new_lead', 'ud_no_answer')
  on conflict (key) do nothing;
  select id into v_first from public.ud_cadences where key = 'ud_first_call';

  insert into public.ud_cadences (key, display_names, start_stage_code, final_move_stage_code)
  values ('ud_no_answer',
          '{"en": "No Answer chain", "el": "Αλυσίδα Δεν Απαντά"}'::jsonb,
          'ud_no_answer', 'ud_not_found')
  on conflict (key) do nothing;
  select id into v_noans from public.ud_cadences where key = 'ud_no_answer';

  insert into public.ud_cadences (key, display_names, start_stage_code, final_move_stage_code)
  values ('ud_offer_followup',
          '{"en": "Offer follow-up chain", "el": "Αλυσίδα Follow-up Προσφοράς"}'::jsonb,
          'ud_offer_sent', 'ud_not_interested')
  on conflict (key) do nothing;
  select id into v_offer from public.ud_cadences where key = 'ud_offer_followup';

  insert into public.ud_cadence_steps (cadence_id, position, kind, delay_days, titles, template_key) values
  (v_first, 10, 'task', 0, '{"en": "1st Call", "el": "1η Κλήση"}'::jsonb, null),

  (v_noans, 10, 'email', 0, null, 'ud_noanswer_1'),
  (v_noans, 20, 'task',  2, '{"en": "Callback", "el": "Callback"}'::jsonb, null),
  (v_noans, 30, 'email', 0, null, 'ud_noanswer_2'),
  (v_noans, 40, 'task',  2, '{"en": "2nd Callback", "el": "2ο Callback"}'::jsonb, null),
  (v_noans, 50, 'email', 0, null, 'ud_noanswer_3'),
  (v_noans, 60, 'task',  3, '{"en": "Final Callback", "el": "Τελευταίο Callback"}'::jsonb, null),

  (v_offer, 10, 'email', 3, null, 'ud_offer_checkin'),
  (v_offer, 20, 'task',  1, '{"en": "Follow-up Call", "el": "Follow-up Κλήση"}'::jsonb, null),
  (v_offer, 30, 'email', 0, null, 'ud_offer_followup_1'),
  (v_offer, 40, 'task',  2, '{"en": "2nd Follow-up Callback", "el": "2ο Follow-up Callback"}'::jsonb, null),
  (v_offer, 50, 'email', 0, null, 'ud_offer_followup_2'),
  (v_offer, 60, 'task',  3, '{"en": "Final Follow-up Callback", "el": "Τελευταίο Follow-up Callback"}'::jsonb, null)
  on conflict (cadence_id, position) do nothing;
end $$;

-- 9. Backfill: the 10 test leads already sit in ud_new_lead — start their
--    chains (creates their «1η Κλήση» tasks; no emails in that cadence).

do $$
declare
  r record;
begin
  for r in
    select l.id, l.stage_id from public.leads l
      join public.pipeline_stages ps on ps.id = l.stage_id
     where ps.board = 'under_development' and not l.archived and l.converted_at is null
       and not exists (select 1 from public.ud_cadence_runs cr where cr.lead_id = l.id)
  loop
    perform public.ud_start_cadence_run(r.id, r.stage_id);
  end loop;
end $$;

-- ROLLBACK:
-- select cron.unschedule('process_ud_cadences');
-- drop trigger if exists trg_ud_leads_cadence_ins on public.leads;
-- drop trigger if exists trg_ud_leads_cadence_upd on public.leads;
-- drop function if exists public.ud_leads_cadence_automations();
-- drop function if exists public.ud_process_due_runs();
-- drop function if exists public.ud_complete_cadence_task(uuid, text);
-- drop function if exists public.ud_start_cadence_run(uuid, uuid);
-- drop function if exists public.ud_advance_run(uuid);
-- drop function if exists public.ud_stop_live_run(uuid, text);
-- drop trigger if exists user_tasks_require_cadence_outcome on public.user_tasks;
-- drop function if exists public.user_tasks_require_cadence_outcome();
-- alter table public.user_tasks drop column if exists cadence_outcome,
--   drop column if exists cadence_step_id, drop column if exists cadence_run_id;
-- drop table if exists public.ud_cadence_runs;
-- drop table if exists public.ud_cadence_steps;
-- drop table if exists public.ud_cadences;
-- delete from public.email_templates where key like 'ud_%';
