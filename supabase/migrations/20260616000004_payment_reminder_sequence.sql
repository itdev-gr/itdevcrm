-- Payment reminder sequence restructure:
--   payment_due_soon      → 7 days BEFORE  (unchanged here)
--   payment_due_today     → on the due date → reverted to its old generic copy
--   payment_overdue       → 1 day AFTER    → the "outstanding / pay ASAP" copy
--   payment_final_notice  → 7 days AFTER   → NEW: final notice (services paused)
-- All amounts use {{amount_gross}} (= [ΠΟΣΟ]). DB rows are authoritative for sending.

-- 1. Revert the due-date email to its original generic copy.
update public.email_templates
   set subject = 'Η πληρωμή σας λήγει σήμερα',
       body = $body$Αγαπητέ/ή {{client_name}},

Η πληρωμή για την υπηρεσία {{service_type}} ποσού {{amount_gross}}€ λήγει σήμερα {{due_date}}.

Με εκτίμηση,
ITDEV Λογιστήριο$body$,
       variables = 'client_name, service_type, amount_gross, due_date',
       updated_at = now()
 where key = 'payment_due_today';

-- 2. The 1-day-after email gets the "outstanding payment / pay ASAP" copy.
update public.email_templates
   set body = $body$Καλησπέρα σας,

Ελπίζουμε να είστε καλά.

Θα θέλαμε να σας ενημερώσουμε ότι υπάρχει εκκρεμότητα σχετικά με την προγραμματισμένη πληρωμή της μεταξύ μας συνεργασίας.

Παρακαλούμε όπως μεριμνήσετε για την τακτοποίηση του ποσού το συντομότερο δυνατό, ώστε να συνεχιστεί ομαλά και απρόσκοπτα η παροχή των υπηρεσιών μας.

Ποσό πληρωμής: {{amount_gross}}€

Παρακάτω θα βρείτε τους διαθέσιμους τρόπους πληρωμής:

Τράπεζα Εθνικής

IBAN: GR4401101670000091004687462
SWIFT/BIC: ETHNGRAA
Δικαιούχος: IT DEV EE
Τράπεζα: Εθνική Τράπεζα Ελλάδος (NBG)

Τράπεζα Πειραιώς

IBAN: GR31 0172 1470 0051 4711 0472 667
SWIFT/BIC: PIRBGRAA
Δικαιούχος: IT DEV E.E. / IT DEV S.P.
Α.Φ.Μ.: 802223278

Viva Wallet

Άμεσος σύνδεσμος πληρωμής:
https://pay.vivawallet.com/it-dev

Σε περίπτωση που η πληρωμή έχει ήδη πραγματοποιηθεί, παρακαλούμε αγνοήστε το παρόν μήνυμα και αποστείλετέ μας το σχετικό αποδεικτικό, ώστε να ενημερώσουμε το αρχείο μας.

Παραμένουμε στη διάθεσή σας για οποιαδήποτε διευκρίνιση ή απορία.$body$,
       variables = 'amount_gross',
       description = 'Payment reminder — 1 day after the due date (outstanding)',
       updated_at = now()
 where key = 'payment_overdue';

-- 3. NEW template: final notice, 7 days after the due date.
insert into public.email_templates (key, description, subject, body, variables, client_facing)
values (
  'payment_final_notice',
  'Payment final notice — 7 days after the due date (service pause warning)',
  'Τελική ενημέρωση για εκκρεμότητα πληρωμής',
  $body$Καλησπέρα σας,

Ελπίζουμε να είστε καλά.

Θα θέλαμε να σας ενημερώσουμε ότι, παρά την προηγούμενη υπενθύμιση, παραμένει σε εκκρεμότητα η προγραμματισμένη πληρωμή της μεταξύ μας συνεργασίας.

Καθώς έχει παρέλθει το χρονικό διάστημα των 7 ημερών από την αρχική ενημέρωση, σας ενημερώνουμε ότι, σε περίπτωση μη τακτοποίησης της οφειλής, οι σχετικές ενέργειες και υπηρεσίες θα τεθούν προσωρινά σε παύση.

Η παύση των ενεργειών θα παραμείνει σε ισχύ έως την εξόφληση του εκκρεμούς ποσού και την αποστολή του σχετικού αποδεικτικού πληρωμής.

Ποσό πληρωμής: {{amount_gross}}€

Παρακάτω θα βρείτε τους διαθέσιμους τρόπους πληρωμής:

Τράπεζα Εθνικής

IBAN: GR4401101670000091004687462
SWIFT/BIC: ETHNGRAA
Δικαιούχος: IT DEV EE
Τράπεζα: Εθνική Τράπεζα Ελλάδος (NBG)

Τράπεζα Πειραιώς

IBAN: GR31 0172 1470 0051 4711 0472 667
SWIFT/BIC: PIRBGRAA
Δικαιούχος: IT DEV E.E. / IT DEV S.P.
Α.Φ.Μ.: 802223278

Viva Wallet

Άμεσος σύνδεσμος πληρωμής:
https://pay.vivawallet.com/it-dev

Σε περίπτωση που η πληρωμή έχει ήδη πραγματοποιηθεί, παρακαλούμε αγνοήστε το παρόν μήνυμα και αποστείλετέ μας το σχετικό αποδεικτικό, ώστε να ενημερώσουμε άμεσα το αρχείο μας και να αποφευχθεί η παύση των ενεργειών.

Παραμένουμε στη διάθεσή σας για οποιαδήποτε διευκρίνιση.$body$,
  'amount_gross',
  true
)
on conflict (key) do update
  set description = excluded.description, subject = excluded.subject,
      body = excluded.body, variables = excluded.variables,
      client_facing = excluded.client_facing, updated_at = now();

-- 4. Wire the cron: also fire payment_final_notice 7 days after the due date.
create or replace function public.enqueue_payment_reminders()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  tkey text;
  dkey text;
  prefix text;
  created int := 0;
begin
  for r in
    select dp.id as payment_id, dp.service_type, dp.amount_gross, dp.start_date as due_date,
           dp.deal_id, c.name as client_name, c.email as to_email
      from public.deal_payments dp
      join public.deals d on d.id = dp.deal_id and d.archived = false
      join public.clients c on c.id = d.client_id
     where dp.status in ('pending', 'overdue')
       and c.email is not null and c.email <> ''
       and dp.start_date in (current_date + 7, current_date, current_date - 1, current_date - 7)
  loop
    if r.due_date = current_date + 7 then
      tkey := 'payment_due_soon'; prefix := 'pay_soon';
    elsif r.due_date = current_date then
      tkey := 'payment_due_today'; prefix := 'pay_today';
    elsif r.due_date = current_date - 1 then
      tkey := 'payment_overdue'; prefix := 'pay_overdue';
    else
      tkey := 'payment_final_notice'; prefix := 'pay_final';
    end if;

    dkey := prefix || ':' || r.payment_id;

    if exists (select 1 from public.email_log where dedupe_key = dkey and status = 'sent') then
      continue;
    end if;
    if exists (select 1 from public.email_outbox where dedupe_key = dkey and status in ('pending','sent')) then
      continue;
    end if;

    insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
    values ('accounting', r.to_email, tkey,
            jsonb_build_object('client_name', r.client_name, 'service_type', r.service_type,
                               'amount_gross', r.amount_gross, 'due_date', to_char(r.due_date, 'DD/MM/YYYY'),
                               'deal_id', r.deal_id),
            dkey);
    created := created + 1;
  end loop;
  return created;
end $$;

-- ROLLBACK:
--  - enqueue_payment_reminders: remove `current_date - 7` from the window and the
--    final `else` branch (revert to the 3-window version from 20260616000002).
--  - delete from public.email_templates where key='payment_final_notice';
--  - restore payment_overdue body to the prior "...έληξε στις {{due_date}}. Παρακαλούμε
--    επικοινωνήστε με το λογιστήριο: accounting@itdev.gr." copy, variables back to
--    'client_name, service_type, amount_gross, due_date'.
--  - payment_due_today already holds its original copy (this migration restored it).
