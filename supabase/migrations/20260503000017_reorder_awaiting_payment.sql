-- Move "Awaiting Payment" to the second slot on the accounting onboarding
-- board, immediately after "New". Position 15 sits between new (10) and
-- documents_verified (20), so the rest of the order shifts down naturally.

update public.pipeline_stages
   set position = 15
 where board = 'accounting_onboarding'
   and code = 'awaiting_payment';
