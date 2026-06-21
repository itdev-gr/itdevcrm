-- Render the merged-block date in Greek local time (Europe/Athens) instead of
-- the DB session's UTC, so rows received just after midnight no longer show the
-- previous day. Only the to_char date expression changes vs 20260621120100.
create or replace function public.format_intake_merge_block(r public.lead_intake)
returns text
language plpgsql
stable
as $$
declare
  block text;
  rec record;
  src_label text;
  skip_keys text[] := array[
    'leadgen_id','form_id','form_name','campaign_id',
    'ad_id','adset_id','platform','is_organic','created_time'
  ];
begin
  src_label := case r.source
                 when 'meta' then 'Meta lead'
                 when 'import' then 'Excel/CSV import'
                 else coalesce(r.source, 'lead')
               end;
  block := '--- '
           || to_char((coalesce(r.created_at, now()) at time zone 'Europe/Athens'), 'DD/MM/YYYY')
           || ' · ' || src_label || ' ---' || E'\n';
  if coalesce(r.title, '') <> '' then
    block := block || 'Campaign / form: ' || r.title || E'\n';
  end if;
  if coalesce(r.contact_info, '') <> '' then
    block := block || 'Notes: ' || r.contact_info || E'\n';
  end if;
  if r.source_data is not null and jsonb_typeof(r.source_data) = 'object' then
    for rec in
      select key, value
      from jsonb_each_text(r.source_data)
      where key <> all (skip_keys) and coalesce(value, '') <> ''
      order by key
    loop
      block := block || rec.key || ': ' || rec.value || E'\n';
    end loop;
  end if;
  return block;
end;
$$;
