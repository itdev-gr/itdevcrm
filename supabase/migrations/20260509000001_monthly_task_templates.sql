-- =============================================================================
-- Phase 6 — Monthly task templates per service_type
-- One row per service. `tasks` is a JSONB array of:
--   { "code": "<stable_code>", "label_en": "...", "label_el": "..." }
-- The cron + RPCs (next migrations) read these to seed jobs.monthly_tasks.
-- =============================================================================

create table public.service_monthly_task_templates (
  service_type text primary key
    check (service_type in (
      'web_seo', 'local_seo', 'web_dev', 'social_media', 'ai_seo', 'hosting', 'ads'
    )),
  tasks jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create trigger service_monthly_task_templates_set_updated_at
  before update on public.service_monthly_task_templates
  for each row execute function public.set_updated_at();

alter table public.service_monthly_task_templates enable row level security;

create policy smtt_select on public.service_monthly_task_templates
  for select to authenticated using (true);

create policy smtt_mutate_admin on public.service_monthly_task_templates
  for all to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- Seeds: only the four recurring service types. Web Dev is one-time and
-- Hosting only has yearly billing; admins can fill those in later if needed.
insert into public.service_monthly_task_templates (service_type, tasks) values
  ('web_seo', '[
    {"code":"keyword_review","label_en":"Review target keywords","label_el":"Έλεγχος target keywords"},
    {"code":"backlink_audit","label_en":"Backlink audit","label_el":"Έλεγχος backlinks"},
    {"code":"content_publish","label_en":"Publish 1 article","label_el":"Δημοσίευση 1 άρθρου"},
    {"code":"rank_report","label_en":"Send ranking report","label_el":"Αποστολή report κατάταξης"}
  ]'::jsonb),
  ('local_seo', '[
    {"code":"gbp_post","label_en":"Google Business post","label_el":"Ανάρτηση Google Business"},
    {"code":"citation_check","label_en":"Citation consistency check","label_el":"Έλεγχος συνέπειας citations"},
    {"code":"review_ask","label_en":"Ask for client reviews","label_el":"Αίτημα reviews από πελάτες"},
    {"code":"local_report","label_en":"Send local report","label_el":"Αποστολή τοπικού report"}
  ]'::jsonb),
  ('social_media', '[
    {"code":"content_calendar","label_en":"Content calendar approved","label_el":"Έγκριση content calendar"},
    {"code":"posts_published","label_en":"All posts published","label_el":"Όλες οι αναρτήσεις δημοσιεύτηκαν"},
    {"code":"engagement_reply","label_en":"Replied to comments / DMs","label_el":"Απαντήσεις σε σχόλια / DMs"},
    {"code":"social_report","label_en":"Send monthly metrics","label_el":"Αποστολή μηνιαίων metrics"}
  ]'::jsonb),
  ('ai_seo', '[
    {"code":"prompt_audit","label_en":"AI search prompt audit","label_el":"Έλεγχος AI search prompts"},
    {"code":"llm_citation_check","label_en":"LLM citation check","label_el":"Έλεγχος citations σε LLMs"},
    {"code":"ai_report","label_en":"Send AI visibility report","label_el":"Αποστολή AI visibility report"}
  ]'::jsonb)
on conflict (service_type) do nothing;
