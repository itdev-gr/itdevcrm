-- Consolidate existing duplicate web_dev jobs → one job per website.
-- Applied to prod via the Supabase Management API on 2026-06-25 (data-only change;
-- this file is the record). Idempotent + guarded so re-running is safe.
--
-- Decision (per product owner, 2026-06-25): archive the abandoned, NEVER-BILLED
-- (0 payment lines) duplicate web_dev jobs; keep the active job on each deal.
--   • Imperial Crystals  000044-WEBDEV   €1500 (closed, 0 pay)  -> archive
--   • NIOVI PAROUTI      000048-WEBDEV   €1600 (closed, 0 pay)  -> archive
--   • ΒΑΣΙΛΗΣ ΕΞΑΡΧΟΣ     000513-WEBDEV   €410   (closed, 0 pay)  -> archive
--   • ΒΑΣΙΛΗΣ ΕΞΑΡΧΟΣ     000513-WEBDEV-2 €564.52(closed, 0 pay)  -> archive
-- KEPT (genuinely separate / billed): DECOSTA (€362.90 + €450),
--   ΜΗΤΡΟΓΙΑΝΝΗΣ (Website €2950 + ChatGPT €96.77), ΦΟΥΡΝΑΡΗ (Migration + Support).
--
-- Backup: table jobs_webdev_dup_archive_backup_20260625 (full rows of the 4 jobs).
-- ROLLBACK:
--   update public.jobs set archived = false, archived_at = null, archived_reason = null
--    where archived_reason = 'webdev_dup_consolidate_20260625';

update public.jobs
set archived = true,
    archived_at = coalesce(archived_at, now()),
    archived_reason = 'webdev_dup_consolidate_20260625'
where code in ('000044-WEBDEV', '000048-WEBDEV', '000513-WEBDEV', '000513-WEBDEV-2')
  and service_type = 'web_dev'
  and not archived
  -- safety: never archive a job that has any billed/scheduled payment line
  and not exists (select 1 from public.deal_payment_lines l where l.job_id = public.jobs.id);
