-- =============================================================================
-- 2026-08-25: AI accounting assistant — conversation storage.
--
-- The accounting-chat edge function answers accounting questions via OpenAI
-- tool-calling; every data tool runs with the CALLER'S JWT so RLS applies
-- (no service-role reads of client data). These tables only persist the chat
-- history per user: conversations + messages. The function writes assistant/
-- tool rows with the service role AFTER verifying conversation ownership.
--
-- No function redefinitions in this migration (all objects are new), so no
-- pg_get_functiondef md5 pre/post capture is required.
-- =============================================================================

create table if not exists public.ai_chat_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_chat_conversations_user
  on public.ai_chat_conversations (user_id, updated_at desc);

create table if not exists public.ai_chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_chat_conversations (id) on delete cascade,
  role            text not null check (role in ('user', 'assistant', 'tool')),
  content         text not null default '',
  tool_name       text,
  tool_payload    jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists ai_chat_messages_conversation
  on public.ai_chat_messages (conversation_id, created_at);

alter table public.ai_chat_conversations enable row level security;
alter table public.ai_chat_messages enable row level security;

-- Own conversations only. Message writes for assistant/tool come from the
-- service role (bypasses RLS) after the function checks ownership.
drop policy if exists ai_chat_conversations_own on public.ai_chat_conversations;
create policy ai_chat_conversations_own on public.ai_chat_conversations
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists ai_chat_messages_own on public.ai_chat_messages;
create policy ai_chat_messages_own on public.ai_chat_messages
  for all to authenticated
  using (exists (select 1 from public.ai_chat_conversations c
                  where c.id = conversation_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.ai_chat_conversations c
                       where c.id = conversation_id and c.user_id = auth.uid()));

-- ROLLBACK:
--   drop table if exists public.ai_chat_messages;
--   drop table if exists public.ai_chat_conversations;
