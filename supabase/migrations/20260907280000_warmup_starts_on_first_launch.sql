-- =============================================================================
-- 20260907280000_warmup_starts_on_first_launch.sql
-- Κλείνει ένα κενό στο backend που το UI (task-4-review.md, το δεύτερο
-- Important) δεν μπορεί να διορθώσει μόνο του: το
-- email_marketing_settings.warmup_started_on είναι nullable, χωρίς default
-- (20260907200000_campaign_tables.sql:132), και ΚΑΝΕΝΑ σημείο του κώδικα δεν
-- το έγραφε ποτέ. Το campaign_daily_budget (20260907220000:125-127) βασίζει
-- το τρέχον σκαλί της σκάλας warm-up σε αυτή τη στήλη — όσο μένει NULL, ο
-- πραγματικός αποστολέας μένει καρφωμένος στο πρώτο σκαλί (500/ημέρα) για
-- πάντα, όποιο daily_cap κι αν έχει οριστεί σε μια καμπάνια. Αυτή είναι
-- ακριβώς η σημασιολογία που η σκάλα σχεδιάστηκε να έχει: το warm-up ξεκινά
-- την πρώτη φορά που πραγματικά ξεκινάει αποστολή.
--
-- Recreates ΜΟΝΟ το campaign_launch, αναπαράγοντας το σώμα του ακριβώς όπως
-- στέκεται στο 20260907220000_campaign_queue_ops.sql:160-217 (καμία άλλη
-- αλλαγή σε συμπεριφορά, έλεγχο μετάβασης, ή μήνυμα σφάλματος) και
-- προσθέτοντας ΜΟΝΟ ένα UPDATE στο email_marketing_settings μετά την
-- επιτυχή εκκίνηση, γραμμένο μόνο όταν η στήλη είναι ήδη NULL — ώστε μια
-- δεύτερη ή τρίτη καμπάνια να μην ξαναμηδενίζει τη σκάλα κάθε φορά που
-- ξεκινάει.
--
-- Ίδιο revoke/grant ζευγάρι, αναλλοίωτο.
--
-- Isolation (ρητή απαίτηση του ιδιοκτήτη, όπως και στα προηγούμενα
-- migrations αυτής της δουλειάς): μηδενική επαφή με leads/clients/email_log/
-- email_outbox/email_templates ή οτιδήποτε κάτω από supabase/functions/
-- send-email/.
-- =============================================================================

create or replace function public.campaign_launch(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign    public.email_campaigns;
  v_errors      text[] := '{}';
  v_has_pending boolean;
begin
  if not (select public.current_user_is_admin()) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into v_campaign from public.email_campaigns where id = p_campaign_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'errors', array['campaign_not_found']);
  end if;

  -- Launch ξεκινά μόνο από 'ready' (μετά το build_campaign_recipients) ή
  -- 'scheduled'. Το 'paused' έχει δικό του ρήμα (resume) — δεν το δεχόμαστε
  -- εδώ, ώστε το ξεκίνημα να είναι πάντα ρητή, ξεχωριστή ενέργεια.
  if v_campaign.status not in ('ready', 'scheduled') then
    v_errors := v_errors || 'invalid_state';
  end if;
  if v_campaign.prepared_at is null then
    v_errors := v_errors || 'not_prepared';
  end if;
  if coalesce(btrim(v_campaign.subject), '') = '' then
    v_errors := v_errors || 'empty_subject';
  end if;
  if coalesce(btrim(v_campaign.body_md), '') = '' then
    v_errors := v_errors || 'empty_body';
  end if;

  select exists(
    select 1 from public.email_campaign_recipients
     where campaign_id = p_campaign_id and status = 'pending'
  ) into v_has_pending;
  if not v_has_pending then
    v_errors := v_errors || 'no_pending_recipients';
  end if;

  if coalesce(array_length(v_errors, 1), 0) > 0 then
    return jsonb_build_object('ok', false, 'errors', v_errors);
  end if;

  update public.email_campaigns
     set status = 'sending', started_at = coalesce(started_at, now()), updated_at = now()
   where id = p_campaign_id;

  -- ΝΕΟ (20260907280000): ξεκίνα τη σκάλα warm-up εδώ, την πρώτη φορά που
  -- πραγματικά χρειάζεται — μόνο όταν είναι ακόμα NULL, ώστε επόμενες
  -- εκκινήσεις να μην την ξαναμηδενίζουν.
  update public.email_marketing_settings
     set warmup_started_on = current_date
   where id = true and warmup_started_on is null;

  return jsonb_build_object('ok', true, 'campaign_id', p_campaign_id, 'status', 'sending');
end;
$$;

revoke execute on function public.campaign_launch(uuid) from public, anon;
grant execute on function public.campaign_launch(uuid) to authenticated;

-- ROLLBACK: recreate public.campaign_launch(uuid) verbatim as it stands in
--   20260907220000_campaign_queue_ops.sql:160-217 (identical body minus the
--   "ΝΕΟ" email_marketing_settings UPDATE block above), then re-run that same
--   revoke/grant pair. Does not by itself clear any warmup_started_on value
--   this version already set — that is real historical warm-up progress on
--   the sending domain, not migration state to be undone.
