-- Fix for 20260701230000 §3: per-schema ALTER DEFAULT PRIVILEGES entries are
-- ADDITIVE to the built-in defaults and cannot cancel the hard-wired
-- PUBLIC=EXECUTE on new functions. A GLOBAL entry replaces the built-in
-- default, so new functions created by postgres get no PUBLIC grant in any
-- schema. (Verified by scratch-probe: fn ACL still contained =X/postgres.)
alter default privileges for role postgres revoke execute on functions from public;
-- ROLLBACK:
--   alter default privileges for role postgres grant execute on functions to public;
