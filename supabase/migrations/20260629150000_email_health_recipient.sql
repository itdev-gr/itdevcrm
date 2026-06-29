-- 20260629150000_email_health_recipient.sql
-- Spec: docs/superpowers/specs/2026-06-29-admin-email-health-page-design.md (recipient column)
-- Admin-gated list RPCs for the Email Health page that resolve each email to its
-- recipient (client OR lead). Most problem emails are leads (welcome / no-answer
-- cadence), so resolving leads matters as much as clients.
--
-- Resolution priority: client by email_log.client_id -> client by matching email ->
-- (queue) client via the dedupe_key deal -> lead by matching email.

create or replace function public.email_queue_rows()
returns table (id uuid, to_email text, template_key text, status text, attempts int,
               last_error text, created_at timestamptz,
               recipient_kind text, recipient_id uuid, recipient_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.current_user_is_admin() then return; end if;
  return query
    select o.id, o.to_email, o.template_key, o.status, o.attempts, o.last_error, o.created_at,
           r.kind, r.rid, r.rname
      from public.email_outbox o
      left join lateral (
        select kind, rid, rname from (
          select 'client'::text kind, c.id rid, c.name rname, 0 pr
            from public.clients c where lower(c.email) = lower(o.to_email)
          union all
          select 'client', cd.id, cd.name, 1
            from public.deals d join public.clients cd on cd.id = d.client_id
           where o.dedupe_key ~ ':[0-9a-fA-F-]{36}$'
             and d.id = substring(o.dedupe_key from ':([0-9a-fA-F-]{36})$')::uuid
          union all
          select 'lead', l.id, coalesce(nullif(trim(l.company_name),''), l.email), 2
            from public.leads l where lower(l.email) = lower(o.to_email)
        ) cand order by pr limit 1
      ) r on true
     where o.status in ('pending','sending','failed')
     order by o.created_at asc;
end $$;

create or replace function public.email_failure_rows()
returns table (id uuid, to_email text, template_key text, status text, error text,
               created_at timestamptz,
               recipient_kind text, recipient_id uuid, recipient_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.current_user_is_admin() then return; end if;
  return query
    select el.id, el.to_email, el.template_key, el.status, el.error, el.created_at,
           r.kind, r.rid, r.rname
      from public.email_log el
      left join lateral (
        select kind, rid, rname from (
          select 'client'::text kind, c.id rid, c.name rname, 0 pr
            from public.clients c where c.id = el.client_id
          union all
          select 'client', c.id, c.name, 1
            from public.clients c where lower(c.email) = lower(el.to_email)
          union all
          select 'lead', l.id, coalesce(nullif(trim(l.company_name),''), l.email), 2
            from public.leads l where lower(l.email) = lower(el.to_email)
        ) cand order by pr limit 1
      ) r on true
     where el.status in ('failed','bounced','complained')
       and el.created_at > now() - interval '7 days'
     order by el.created_at desc
     limit 200;
end $$;

revoke all on function public.email_queue_rows() from public;
revoke all on function public.email_failure_rows() from public;
grant execute on function public.email_queue_rows() to authenticated;
grant execute on function public.email_failure_rows() to authenticated;

-- ROLLBACK:
--   drop function if exists public.email_queue_rows();
--   drop function if exists public.email_failure_rows();
