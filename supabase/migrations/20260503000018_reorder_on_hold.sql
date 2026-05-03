-- Place "On Hold" immediately after "Awaiting Payment" on the accounting
-- onboarding board. Position 17 sits between awaiting_payment (15) and
-- documents_verified (20).

update public.pipeline_stages
   set position = 17
 where board = 'accounting_onboarding'
   and code = 'on_hold';
