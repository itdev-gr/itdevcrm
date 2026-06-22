-- Human-readable "Lead info" text from a Meta-lead source_data blob:
--   line 1: Φόρμα: <form_name>
--   then:   <humanized question>: <answer>  (one per non-system key)
-- Hides system IDs + fields already shown in structured columns. Used by the
-- release functions and the one-time backfill so both produce identical text.
create or replace function public.build_lead_info_block(p_source_data jsonb, p_title text default null)
returns text
language plpgsql
immutable
as $$
declare
  block text := '';
  form_name text;
  rec record;
  label text;
  val text;
  skip_keys text[] := array[
    'id','leadgen_id','key','page_id','source','lead_status',
    'form_id','form_name','campaign_id','campaign_name',
    'ad_id','ad_name','adset_id','adset_name','platform','is_organic','created_time',
    'όνομα_εταιρείας','όνομα εταιρείας','company','company_name',
    'αριθμός_τηλεφώνου','αριθμός τηλεφώνου','work_phone_number','phone','mobile',
    'email','e-mail','website','site',
    'full_name','name','ονοματεπώνυμο','όνομα'
  ];
begin
  if p_source_data is null or jsonb_typeof(p_source_data) <> 'object' then
    return null;
  end if;

  form_name := nullif(btrim(p_source_data->>'form_name'), '');
  if form_name is not null then
    block := 'Φόρμα: ' || form_name || E'\n';
  end if;

  for rec in
    select key, value
      from jsonb_each_text(p_source_data)
     where coalesce(btrim(value), '') <> ''
       and lower(key) <> all (skip_keys)
       and lower(key) not like 'col$%'
     order by key
  loop
    label := btrim(regexp_replace(replace(rec.key, '_', ' '), '[;:]+\s*$', ''));
    label := regexp_replace(label, '\s+', ' ', 'g');
    -- Meta also encodes multiple-choice ANSWER options with underscores → spaces.
    val := btrim(regexp_replace(replace(rec.value, '_', ' '), '\s+', ' ', 'g'));
    block := block || label || ': ' || val || E'\n';
  end loop;

  return nullif(btrim(block), '');
end;
$$;

-- ROLLBACK: drop function public.build_lead_info_block(jsonb, text);
