-- Segundo Cérebro: esquema base (brain_items, brain_chunks) e RLS restrita ao dono.
-- Pré-requisito: supabase/auth_rls.sql executado (cria public.is_owner()).
-- Idempotente e seguro em produção: tabelas existentes não são alteradas; apenas o RLS e os grants são (re)aplicados.
-- Nota: os índices vetoriais (HNSW) de produção não são recriados aqui para não duplicar índices já existentes.

set search_path = public, extensions;

do $$
begin
  if to_regprocedure('public.is_owner()') is null then
    raise exception 'public.is_owner() não existe. Execute supabase/auth_rls.sql antes desta migração.';
  end if;
end $$;

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table if not exists public.brain_items (
  id uuid primary key default gen_random_uuid(),
  title text,
  summary text,
  source_type text default 'note',
  source_url text,
  raw_content text,
  key_takeaways jsonb default '[]',
  action_items jsonb default '[]',
  entities jsonb default '[]',
  stage text default 'seedling',
  tags text[] default '{}',
  metadata jsonb default '{}',
  is_favorite boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.brain_chunks (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.brain_items (id) on delete cascade,
  chunk_index int default 0,
  content text,
  embedding vector(768),
  created_at timestamptz default now()
);

-- Remove políticas antigas (inclusive as abertas ao anon) e recria só a do dono
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and tablename in ('brain_items', 'brain_chunks')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

alter table public.brain_items enable row level security;
alter table public.brain_chunks enable row level security;

revoke all on public.brain_items from anon;
revoke all on public.brain_chunks from anon;

create policy brain_items_owner on public.brain_items
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy brain_chunks_owner on public.brain_chunks
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- Busca semântica antiga (match_brain_chunks): todas as sobrecargas passam a respeitar o RLS
-- (security invoker, nunca definer) e só rodam para usuário autenticado.
do $$
declare f record;
begin
  for f in
    select oid::regprocedure as sig
    from pg_proc
    where proname = 'match_brain_chunks' and pronamespace = 'public'::regnamespace
  loop
    execute format('alter function %s security invoker', f.sig);
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
