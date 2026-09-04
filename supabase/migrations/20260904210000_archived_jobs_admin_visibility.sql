-- =============================================================================
-- 20260904210000_archived_jobs_admin_visibility.sql
-- Τα αρχειοθετημένα jobs δεν είναι απλώς κρυμμένα στο UI (απόφαση ιδιοκτήτη
-- 2026-09-04: «θα είναι hidden από όλους εκτός τους admin») — τα κόβουμε και
-- στη βάση. Το accounting τα κρατάει γιατί τα βλέπει στο JOBS & BILLING του
-- deal (ίδια απόφαση).
--
-- Owner follow-up (final-review C1, 2026-09-04): το job_archived notification
-- δείχνει στον υπεύθυνο (owner_user_id) του job, τεχνικό χρήστη — και η
-- παραπάνω ρήτρα τον έκοβε ακριβώς αυτόν, οπότε το click στο notification
-- κατέληγε σε "You don't have access to this job". Απόφαση: ο υπεύθυνος
-- μπορεί να ανοίξει ΜΟΝΟ τη δική του κάρτα· η στήλη Αρχειοθετημένα παραμένει
-- admin-only (δεν προστίθεται τίποτα στα boards/list queries, που είναι
-- gated στο isAdmin ανεξάρτητα από RLS).
--
-- Το σώμα κάτω από τη νέα ρήτρα είναι ΑΥΤΟΥΣΙΟ το βελτιστοποιημένο σώμα των
-- 20260904110000 / 20260904130000. Κάθε helper με σταθερά ορίσματα μένει σε
-- (select ...) ώστε να αποτιμάται μία φορά ανά statement (InitPlan) και όχι
-- μία φορά ανά γραμμή. Το `archived` είναι `boolean not null default false`,
-- άρα το σκέτο `not archived` είναι ασφαλές — δεν υπάρχει null branch. Το
-- `owner_user_id = (select auth.uid())` κρατάει το `owner_user_id` σκέτο
-- (row-dependent, σωστό ως έχει) ενώ το `auth.uid()` μένει σε (select ...)
-- ώστε να παραμείνει InitPlan.
-- =============================================================================
drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs for select to authenticated
using (
  (not archived
   or (select public.current_user_is_admin())
   or (select public.current_user_in_group('accounting'))
   or owner_user_id = (select auth.uid()))
  and (
    (select public.current_user_is_admin())
    or (select public.current_user_can('accounting_recurring', 'view'))
    or (select public.current_user_can('accounting_onboarding', 'view'))
    or service_type = any (coalesce((select public.current_user_boards('view')), '{}'::text[]))
  )
);
