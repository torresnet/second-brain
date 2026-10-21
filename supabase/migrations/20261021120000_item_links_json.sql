-- brain_item_links devolve ~11 mil linhas e o PostgREST corta em 1000: paginar custava uma execução
-- completa (~1,6 s) por página. Esta versão devolve tudo em um único valor jsonb, em uma só execução.

create or replace function public.brain_item_links_json(
  p_similar_per_item int default 2,
  p_min_similarity double precision default 0.62
)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
  from public.brain_item_links(p_similar_per_item, p_min_similarity) l
$$;

revoke execute on function public.brain_item_links_json(int, double precision) from public, anon;
grant execute on function public.brain_item_links_json(int, double precision) to authenticated;
