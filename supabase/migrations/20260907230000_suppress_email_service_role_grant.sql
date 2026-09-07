-- suppress_email is called by the campaign unsubscribe endpoint through the
-- service-role client. 20260701230000 revoked default EXECUTE, so every
-- backend-called RPC needs an explicit service_role grant; Phase 0 shipped
-- with only the authenticated grant, which made the unsubscribe write a
-- silent no-op — and future campaigns would have kept mailing that person.
grant execute on function public.suppress_email(text, text, text) to service_role;
