-- Log de erros e falhas da captura (links, YouTube, Reels, PDF, áudio, imagem, vídeo...).
-- Uma linha por falha ou aviso, com a etapa, a categoria e o contexto para diagnóstico.
set search_path = public, extensions;

do $$
begin
  if to_regprocedure('public.is_owner()') is null then
    raise exception 'Aplique supabase/auth_rls.sql e a migration base antes desta (public.is_owner() não existe).';
  end if;
end $$;

create table if not exists public.capture_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  stage text not null default 'pipeline',
  category text not null default 'unknown',
  severity text not null default 'error',
  source_type text,
  item_id uuid references public.brain_items (id) on delete set null,
  message text not null,
  detail jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  constraint capture_errors_stage check (stage in ('pipeline', 'media_fetch', 'ai', 'embedding', 'crawl', 'save')),
  constraint capture_errors_category check (category in ('quota', 'timeout', 'network', 'http', 'auth', 'unreadable', 'unsupported', 'unknown')),
  constraint capture_errors_severity check (severity in ('error', 'warning')),
  constraint capture_errors_message_len check (char_length(message) <= 1000)
);

create index if not exists capture_errors_created_idx on public.capture_errors (created_at desc);
create index if not exists capture_errors_open_idx on public.capture_errors (created_at desc) where resolved_at is null;
create index if not exists capture_errors_item_idx on public.capture_errors (item_id) where item_id is not null;

alter table public.capture_errors enable row level security;
revoke all on public.capture_errors from anon;

drop policy if exists capture_errors_owner on public.capture_errors;
create policy capture_errors_owner on public.capture_errors
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
