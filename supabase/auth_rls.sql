-- Segundo Cérebro: acesso restrito ao dono (usuário único)
-- Execute no SQL Editor do Supabase DEPOIS de criar o seu usuário em Authentication > Users.
-- 1) Substitua o UUID abaixo pelo "User UID" desse usuário.
-- 2) Em Authentication > Sign In / Providers, desative "Allow new users to sign up".

create or replace function public.is_owner()
returns boolean
language sql
stable
as $$
  select auth.uid() = '00000000-0000-0000-0000-000000000000'::uuid
$$;

-- Usada pelo n8n para validar o token e confirmar o dono (o UUID fica só aqui)
create or replace function public.owner_check()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('is_owner', public.is_owner())
$$;

revoke execute on function public.owner_check() from public, anon;
grant execute on function public.owner_check() to authenticated;

-- Remove políticas antigas (inclusive as abertas ao anon)
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

-- Busca semântica só para usuário autenticado
do $$
declare f record;
begin
  for f in
    select oid::regprocedure as sig
    from pg_proc
    where proname = 'match_brain_chunks' and pronamespace = 'public'::regnamespace
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
