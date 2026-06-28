-- =============================================================================
-- Audit M4 (deep): user_effective_permissions was a SECURITY DEFINER view, so it
-- bypassed RLS and let any authenticated user read EVERY user's permission matrix
-- (anon was already revoked in 20260628010000). Convert to security_invoker so the
-- underlying RLS applies (user_groups / user_permissions are self-or-admin; the
-- group_permissions catalog is readable by all authenticated). Net effect:
--   - a user sees only their OWN effective permissions,
--   - admins still see anyone's (the admin Permissions page keeps working).
-- Verified live (impersonation): self-load 9/9 rows, admin sees any user, and a
-- cross-user read by a non-admin returns 0.
-- =============================================================================

alter view public.user_effective_permissions set (security_invoker = true);

-- ROLLBACK: alter view public.user_effective_permissions reset (security_invoker);
