-- =============================================================================
-- 20260908180000_jobs_mutate_no_select_leak.sql
-- Συμπλήρωμα του 20260908160000, βρέθηκε από live probe: το
-- jobs_mutate_admin_or_service ήταν FOR ALL — και στο Postgres τα permissive
-- policies ίδιας εντολής ενώνονται με OR, οπότε το USING του (admin OR
-- current_user_can(service_type,'edit')) χάριζε SELECT σε ΟΛΑ τα jobs του
-- board σε όποιον έχει edit, παρακάμπτοντας ολόκληρο το jobs_select:
-- και το owner-only conjunct (3) του 20260908160000, ΚΑΙ το archived-hidden
-- του 20260904210000 (ένας board editor έβλεπε αρχειοθετημένα από 4/9).
-- Probe: μέλος social με edit έβλεπε 23/23 social jobs αντί για τα 4 δικά του.
--
-- Fix: το FOR ALL σπάει σε INSERT/UPDATE/DELETE με ΤΟ ΙΔΙΟ predicate — το
-- SELECT κυβερνάται πλέον ΜΟΝΟ από το jobs_select. Επιβεβαιωμένο στην prod
-- πριν το ship: ΚΑΝΕΝΑΣ χρήστης δεν έχει edit χωρίς view στο ίδιο board, άρα
-- κανείς δεν χάνει ορατότητα που χρησιμοποιούσε νόμιμα. Τα write predicates
-- μένουν με σκέτα (per-row) helper calls, όπως ορίζει το 20260904110000
-- («write policies touch one row at a time and are left alone»).
--
-- Σημείωση PG17 (βλ. 20260902150000/leads): με το UPDATE, το SELECT policy
-- εφαρμόζεται στο row — μέλος board δεν μπορεί πλέον ούτε να ΔΕΙ ούτε να
-- πειράξει ξένο owner-only job· admin/accounting (που κάνουν τα reassigns)
-- περνούν τα escapes του jobs_select και δεν παθαίνουν give-away.
-- =============================================================================

drop policy if exists jobs_mutate_admin_or_service on public.jobs;

create policy jobs_insert_admin_or_service
  on public.jobs for insert
  to authenticated
  with check (
    public.current_user_is_admin()
    or public.current_user_can(jobs.service_type, 'edit')
  );

create policy jobs_update_admin_or_service
  on public.jobs for update
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can(jobs.service_type, 'edit')
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can(jobs.service_type, 'edit')
  );

create policy jobs_delete_admin_or_service
  on public.jobs for delete
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can(jobs.service_type, 'edit')
  );

-- ROLLBACK:
--   drop policy if exists jobs_insert_admin_or_service on public.jobs;
--   drop policy if exists jobs_update_admin_or_service on public.jobs;
--   drop policy if exists jobs_delete_admin_or_service on public.jobs;
--   και ξανατρέξε το create policy jobs_mutate_admin_or_service block του
--   20260502000016_block_client_rpcs.sql (FOR ALL, ίδιο predicate).
