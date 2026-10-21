-- Segundo Cérebro: lista de todos os pares de notas duplicadas (mesmo link ou muito parecidas),
-- com o que for preciso para compará-las sem abrir as notas. Pré-requisito: 20261017130000_duplicates.sql. Idempotente.

set search_path = public, extensions;

create or replace function public.brain_duplicate_pairs(
  p_min_similarity double precision default 0.9,
  p_limit int default 50
)
returns table (
  a_id uuid, a_title text, a_summary text, a_source_url text, a_source_type text, a_created_at timestamptz,
  b_id uuid, b_title text, b_summary text, b_source_url text, b_source_type text, b_created_at timestamptz,
  similarity double precision,
  reason text
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with emb as (
    select distinct on (c.item_id) c.item_id, c.embedding
    from public.brain_chunks c
    where c.embedding is not null
    order by c.item_id, (c.chunk_type = 'summary') desc, c.chunk_index
  ),
  same_link as (
    select i.id as a, j.id as b
    from public.brain_items i
    join public.brain_items j on j.source_key = i.source_key and i.id < j.id
    where i.source_key is not null
  ),
  near_pairs as (
    select e1.item_id as a, e2.item_id as b, 1 - (e1.embedding <=> e2.embedding) as sim
    from emb e1
    join emb e2 on e1.item_id < e2.item_id
    where (e1.embedding <=> e2.embedding) <= 1 - p_min_similarity
  ),
  pairs as (
    select a, b, 1.0::double precision as sim, 'mesmo_link'::text as why from same_link
    union all
    select s.a, s.b, s.sim, 'muito_parecida'::text
    from near_pairs s
    where not exists (select 1 from same_link l where l.a = s.a and l.b = s.b)
  )
  select ia.id, ia.title, ia.summary, ia.source_url, ia.source_type, ia.created_at,
         ib.id, ib.title, ib.summary, ib.source_url, ib.source_type, ib.created_at,
         p.sim, p.why
  from pairs p
  join public.brain_items ia on ia.id = p.a
  join public.brain_items ib on ib.id = p.b
  where not exists (
    select 1 from public.brain_duplicate_decisions d
    where d.item_a = p.a and d.item_b = p.b
  )
  order by p.sim desc, greatest(ia.created_at, ib.created_at) desc
  limit greatest(coalesce(p_limit, 50), 1)
$$;

revoke execute on function public.brain_duplicate_pairs(double precision, int) from public, anon;
grant execute on function public.brain_duplicate_pairs(double precision, int) to authenticated;
