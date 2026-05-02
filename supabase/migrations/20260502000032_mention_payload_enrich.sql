-- =============================================================================
-- Enrich the mention notification payload with author_name + parent_label so
-- the notifications bell can render "{author} mentioned you on {parent_label}:
-- {preview}" without needing extra round trips.
-- =============================================================================
create or replace function public.fanout_mention_notifications() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  author_name text;
  parent_label text;
begin
  if new.mentioned_user_ids is null or array_length(new.mentioned_user_ids, 1) is null then
    return new;
  end if;

  select coalesce(nullif(p.full_name, ''), p.email)
    into author_name
    from public.profiles p where p.user_id = new.author_id;

  if new.parent_type = 'lead' then
    select coalesce(
      nullif(trim(coalesce(l.contact_first_name, '') || ' ' || coalesce(l.contact_last_name, '')), ''),
      l.company_name,
      l.title
    )
      into parent_label
      from public.leads l where l.id = new.parent_id;
  elsif new.parent_type = 'client' then
    select c.name into parent_label from public.clients c where c.id = new.parent_id;
  elsif new.parent_type = 'deal' then
    select d.title into parent_label from public.deals d where d.id = new.parent_id;
  elsif new.parent_type = 'job' then
    select j.service_type into parent_label from public.jobs j where j.id = new.parent_id;
  end if;

  foreach uid in array new.mentioned_user_ids loop
    insert into public.notifications (user_id, type, payload)
    values (
      uid,
      'mention',
      jsonb_build_object(
        'comment_id', new.id,
        'parent_type', new.parent_type,
        'parent_id', new.parent_id,
        'author_id', new.author_id,
        'author_name', author_name,
        'parent_label', parent_label,
        'preview', left(new.body, 200)
      )
    );
  end loop;
  return new;
end $$;
