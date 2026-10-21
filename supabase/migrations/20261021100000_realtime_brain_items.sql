-- Publica brain_items no Realtime: a tela recebe as mudanças de status (processando/indexando) na hora.
-- O RLS continua valendo: cada sessão só recebe as linhas que já pode ler.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'brain_items'
  ) then
    alter publication supabase_realtime add table public.brain_items;
  end if;
end $$;
