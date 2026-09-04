-- =============================================================================
-- 20260904210000_archived_jobs_admin_visibility.sql
-- Τα αρχειοθετημένα jobs δεν είναι απλώς κρυμμένα στο UI (απόφαση ιδιοκτήτη
-- 2026-09-04: «θα είναι hidden από όλους εκτός τους admin») — τα κόβουμε και
-- στη βάση. Το accounting τα κρατάει γιατί τα βλέπει στο JOBS & BILLING του
-- deal (ίδια απόφαση).
--
-- Το σώμα κάτω από τη νέα ρήτρα είναι ΑΥΤΟΥΣΙΟ το βελτιστοποιημένο σώμα των
-- 20260904110000 / 20260904130000. Κάθε helper με σταθερά ορίσματα μένει σε
-- (select ...) ώστε να αποτιμάται μία φορά ανά statement (InitPlan) και όχι
-- μία φορά ανά γραμμή. Το `archived` είναι `boolean not null default false`,
-- άρα το σκέτο `not archived` είναι ασφαλές — δεν υπάρχει null branch.
-- =============================================================================
drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs for select to authenticated
using (
  (not archived
   or (select public.current_user_is_admin())
   or (select public.current_user_in_group('accounting')))
  and (
    (select public.current_user_is_admin())
    or (select public.current_user_can('accounting_recurring', 'view'))
    or (select public.current_user_can('accounting_onboarding', 'view'))
    or service_type = any (coalesce((select public.current_user_boards('view')), '{}'::text[]))
  )
);
