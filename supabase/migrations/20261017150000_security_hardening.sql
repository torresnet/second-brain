-- Segundo Cérebro: limpeza de segurança (auditoria de 17/10/2026).
-- Remove a busca legada match_brain_chunks: foi substituída por search_brain, nenhum código a chama e o corpo
-- dela nunca foi versionado (não dava para revisar pelo repositório).
-- Idempotente: pode ser executada de novo.

set search_path = public, extensions;

do $$
declare f record;
begin
  for f in
    select oid::regprocedure as sig
    from pg_proc
    where proname = 'match_brain_chunks' and pronamespace = 'public'::regnamespace
  loop
    execute format('drop function %s', f.sig);
  end loop;
end $$;
