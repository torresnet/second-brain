-- Segundo Cérebro: identidade do dono (usuário único). Execute no SQL Editor do Supabase ANTES das migrations.
-- 1) Crie o seu usuário em Authentication > Users e copie o "User UID".
-- 2) Troque o UUID de zeros abaixo pelo seu User UID. O script aborta se o valor não for trocado.
-- 3) Em Authentication > Sign In / Providers, desative "Allow new users to sign up".
-- O acesso é só por e-mail e senha (sem segundo fator): use uma senha forte e exclusiva deste app.
-- As políticas RLS das tabelas ficam em migrations/20261017110000_base_schema_rls.sql (e nas demais migrations).
-- Idempotente: pode ser executado de novo (por exemplo, para trocar o dono).

create table if not exists public.brain_owner (
  user_id uuid primary key
);

-- Ninguém lê nem escreve a tabela diretamente pela API: só a função is_owner() (security definer) a consulta.
alter table public.brain_owner enable row level security;
revoke all on public.brain_owner from public, anon, authenticated;

do $$
declare
  v_owner constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  if v_owner = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Troque o UUID de zeros pelo User UID do dono (Authentication > Users) antes de executar.';
  end if;
  delete from public.brain_owner;
  insert into public.brain_owner (user_id) values (v_owner);
end $$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.brain_owner where user_id = auth.uid())
$$;

-- Usada pelo n8n e pelas Edge Functions para validar o token e confirmar o dono
create or replace function public.owner_check()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object('is_owner', public.is_owner())
$$;

revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;
revoke execute on function public.owner_check() from public, anon;
grant execute on function public.owner_check() to authenticated;
