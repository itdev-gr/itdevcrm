-- 20260714150000_webdev_client_intake.sql
-- =============================================================================
-- Web Dev client intake form — port of the standalone "info-website" app.
-- DB foundation only: two tables (one intake form per web_dev job + uploaded
-- files), a PRIVATE `client-intake` storage bucket, RLS, a submission trigger
-- (activity log + internal email to the web_dev team), and two email templates.
--
-- SECURITY MODEL: the anonymous client NEVER touches these tables or the bucket
-- directly. All public reads/writes flow through a Vercel service-role function
-- (added in a later task) which bypasses RLS. That is why there are NO anon
-- policies and NO anon grants here — anon is blocked by RLS (zero anon policies)
-- and by the default-privileges revoke from 20260701230000. Belt-and-braces
-- explicit `revoke ... from anon` is added below for auditability.
--
-- ROLLBACK:
--   drop trigger if exists job_intake_form_submitted on public.job_intake_forms;
--   drop function if exists public.job_intake_form_submitted();
--   drop table if exists public.job_intake_files;
--   drop table if exists public.job_intake_forms;
--   delete from public.email_automation_settings
--     where key in ('webdev_client_form','internal_webdev_form_submitted');
--   delete from public.email_templates
--     where key in ('webdev_client_form','internal_webdev_form_submitted');
--   drop policy if exists "client_intake_select_staff" on storage.objects;
--   -- bucket objects must be removed via the dashboard / Storage API first
--   -- (protect_delete blocks SQL deletes on storage.objects), THEN:
--   delete from storage.buckets where id = 'client-intake';
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. job_intake_forms — one per web_dev job (client answers + autosaved drafts).
-- ---------------------------------------------------------------------------
create table public.job_intake_forms (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  status text not null default 'draft' check (status in ('draft','submitted','locked')),
  data jsonb not null default '{}'::jsonb,
  logo_path text,
  locale text not null default 'el',
  expires_at timestamptz not null default now() + interval '30 days',
  sent_at timestamptz,
  first_submitted_at timestamptz,
  submitted_at timestamptz,
  locked_at timestamptz,
  locked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create trigger job_intake_forms_set_updated_at
  before update on public.job_intake_forms
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. job_intake_files — client-uploaded files (originals may be Greek-named).
-- ---------------------------------------------------------------------------
create table public.job_intake_files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  file_name text not null,
  file_size bigint not null,
  mime_type text,
  storage_path text not null unique,
  uploaded_at timestamptz not null default now()
);

create index job_intake_files_job on public.job_intake_files (job_id);

-- ---------------------------------------------------------------------------
-- 3. RLS — staff read; writes stay narrow. NO anon policies (see header).
-- ---------------------------------------------------------------------------
alter table public.job_intake_forms enable row level security;
alter table public.job_intake_files enable row level security;

-- Belt-and-braces: hard-guarantee the anonymous role can never touch these.
revoke all on public.job_intake_forms from anon;
revoke all on public.job_intake_files from anon;

-- Staff may read both (job-scoped data readable by any authenticated staffer).
create policy job_intake_forms_select on public.job_intake_forms
  for select to authenticated using (true);
create policy job_intake_files_select on public.job_intake_files
  for select to authenticated using (true);

-- INSERT: only the creating staffer (service-role API bypasses RLS anyway).
create policy job_intake_forms_insert on public.job_intake_forms
  for insert to authenticated
  with check (created_by = (select auth.uid()));

-- UPDATE (lock/reopen/regenerate/sent_at): mirror the jobs-edit posture —
-- admin OR the web_dev service team OR accounting (accounting_onboarding).
create policy job_intake_forms_update on public.job_intake_forms
  for update to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('web_dev', 'edit')
    or public.current_user_can('accounting_onboarding', 'edit')
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can('web_dev', 'edit')
    or public.current_user_can('accounting_onboarding', 'edit')
  );

-- job_intake_files: staff SELECT only. All writes go through the service-role
-- API (signed uploads), so there are deliberately NO staff insert/update/delete
-- policies.

-- ---------------------------------------------------------------------------
-- 4. Private `client-intake` storage bucket (500 MB, no mime restriction).
--    Staff preview uploads via signed URLs; clients upload via signed upload
--    URLs issued server-side. Service role bypasses RLS, so NO insert/update/
--    delete policies here either.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('client-intake', 'client-intake', false, 524288000, null)
  on conflict (id) do update set public = false, file_size_limit = 524288000, allowed_mime_types = null;

drop policy if exists "client_intake_select_staff" on storage.objects;
create policy "client_intake_select_staff" on storage.objects
  for select to authenticated
  using (bucket_id = 'client-intake');
-- NOTE: never SQL-delete rows in storage.objects — the protect_delete trigger
-- blocks it. Remove bucket objects via the dashboard / Storage API instead.

-- ---------------------------------------------------------------------------
-- 5. Email templates (editable later in the email-templates admin UI). Plain
--    text; newlines render as <br>. Bodies END AT CONTENT — the send pipeline
--    appends the IT DEV signature automatically (house rule).
-- ---------------------------------------------------------------------------
insert into public.email_templates (key, description, subject, body, variables, client_facing) values
('webdev_client_form',
 'Web Dev client intake — form-link email sent to the client (port of the info-website onboarding form)',
 '{{code}} - Στοιχεία για την ιστοσελίδα σας',
 E'Αγαπητέ/ή {{client_name}},\n\nΓια να ξεκινήσουμε την κατασκευή της ιστοσελίδας σας, χρειαζόμαστε λίγο υλικό από εσάς. Μπορείτε να το καταχωρίσετε στη φόρμα μέσω του παρακάτω συνδέσμου:\n\n{{link}}\n\nΚαλό είναι να έχετε πρόχειρα τα εξής:\n• Το λογότυπό σας\n• Φωτογραφίες και υλικό της επιχείρησης\n• Κείμενα για τις σελίδες\n• Στοιχεία επικοινωνίας\n• Προτίμηση για domain (όνομα ιστοσελίδας)\n\nΟ σύνδεσμος παραμένει ενεργός, οπότε μπορείτε να επιστρέψετε και να συμπληρώσετε αργότερα ό,τι λείπει. Σημειώνουμε ότι ο σύνδεσμος λήγει, οπότε καλό είναι να ολοκληρώσετε τη φόρμα εγκαίρως.',
 'code, client_name, link', true),
('internal_webdev_form_submitted',
 'Web Dev client intake — internal alert to the web_dev team when a client submits the intake form',
 '{{code}} - Ο πελάτης συμπλήρωσε τη φόρμα ({{client_name}})',
 E'Ο πελάτης {{client_name}} συμπλήρωσε τη φόρμα στοιχείων για την ιστοσελίδα.\n\nΕργασία: {{code}}\nΣτοιχεία που λείπουν: {{missing_items}}\n\nΔείτε την εργασία στο CRM: {{link}}',
 'code, client_name, missing_items, link', false)
on conflict (key) do nothing;

insert into public.email_automation_settings (key, description, enabled) values
('webdev_client_form',             'Web Dev client intake — client form-link email', true),
('internal_webdev_form_submitted', 'Web Dev client intake — internal alert when a client submits the form', true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Submission trigger: on submitted_at being (re)set, log an activity event
--    on the job and enqueue one internal alert per web_dev group member.
-- ---------------------------------------------------------------------------
create or replace function public.job_intake_form_submitted()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_client_id uuid;
  v_client_name text;
  v_link text;
  v_missing text;
  v_missing_parts text[] := '{}';
  m record;
begin
  select j.code, j.client_id, c.name
    into v_code, v_client_id, v_client_name
    from public.jobs j
    left join public.clients c on c.id = j.client_id
   where j.id = new.job_id;

  v_link := 'https://www.itdevcrm.com/jobs/' || new.job_id || '?tab=info';

  -- Missing items (simple): no logo uploaded; no uploaded files at all.
  if new.logo_path is null then
    v_missing_parts := array_append(v_missing_parts, 'λογότυπο');
  end if;
  if not exists (select 1 from public.job_intake_files f where f.job_id = new.job_id) then
    v_missing_parts := array_append(v_missing_parts, 'φωτογραφίες/αρχεία');
  end if;
  v_missing := coalesce(nullif(array_to_string(v_missing_parts, ', '), ''), '—');

  -- Activity feed entry on the job (System actor — submission comes via the
  -- service-role API, so auth.uid() is null, which is correct).
  insert into public.activity_log (entity_type, entity_id, user_id, action, changes, client_id)
  values ('jobs', new.job_id, auth.uid(), 'update',
          jsonb_build_object(
            'old', jsonb_build_object('status', old.status),
            'new', jsonb_build_object('status', new.status)
          ),
          v_client_id);

  -- One internal alert per active web_dev group member (recipient-resolution
  -- shape copied from email_notify_new_job).
  for m in
    select p.email
      from public.user_groups ug
      join public.groups g on g.id = ug.group_id and g.code = 'web_dev'
      join public.profiles p on p.user_id = ug.user_id
     where p.email is not null and p.email <> ''
  loop
    insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
    values ('internal', m.email, 'internal_webdev_form_submitted',
            jsonb_build_object(
              'code', v_code,
              'client_name', v_client_name,
              'missing_items', v_missing,
              'link', v_link
            ),
            'webdev_form_submitted:' || new.job_id || ':' || extract(epoch from new.submitted_at)::bigint || ':' || m.email);
  end loop;

  return new;
end $$;

drop trigger if exists job_intake_form_submitted on public.job_intake_forms;
create trigger job_intake_form_submitted
  after update on public.job_intake_forms
  for each row
  when (new.submitted_at is distinct from old.submitted_at and new.submitted_at is not null)
  execute function public.job_intake_form_submitted();
