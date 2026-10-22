-- Ligações entre notas no estilo Obsidian: poucas e deliberadas.
-- Antes, qualquer par de notas que citasse a mesma coisa ganhava uma ligação, então um termo genérico
-- ("índice de comandos", citado por 97 notas) gerava ~4.600 ligações sozinho: 11 mil para 410 notas.
-- Agora:
--  1. termos citados por mais de p_max_key_notes notas não ligam notas entre si (já aparecem como nó de tag/entidade);
--  2. termos raros pesam mais (idf) e o par é ordenado por esse peso;
--  3. cada nota mantém só as p_max_links_per_item ligações mais fortes (par fica se estiver no topo de qualquer ponta).

drop function if exists public.brain_item_links(int, double precision);

create or replace function public.brain_item_links(
  p_similar_per_item int default 2,
  p_min_similarity double precision default 0.62,
  p_max_key_notes int default 8,
  p_max_links_per_item int default 3
)
returns table (
  source_id uuid,
  source_title text,
  target_id uuid,
  target_title text,
  link_type text,
  weight double precision,
  labels text[]
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with mentions as (
    select a.item_id, a.canonical_key as k, a.name as label
    from public.brain_atoms a
    where a.canonical_key is not null
    union
    select i.id, 'ent:' || lower(btrim(e)), btrim(e)
    from public.brain_items i,
         jsonb_array_elements_text(case when jsonb_typeof(i.entities) = 'array' then i.entities else '[]'::jsonb end) e
    where btrim(e) <> ''
  ),
  key_freq as (
    select k, count(distinct item_id) as notes from mentions group by k
  ),
  specific as (
    select m.item_id, m.k, m.label, f.notes
    from mentions m
    join key_freq f on f.k = m.k
    where f.notes between 2 and greatest(p_max_key_notes, 2)
  ),
  shared_all as (
    select m1.item_id as s, m2.item_id as t,
           array_agg(distinct m1.label) as labels,
           count(distinct m1.k)::double precision as weight,
           sum(1.0 / ln(1 + m1.notes)) as score
    from specific m1
    join specific m2 on m1.k = m2.k and m1.item_id < m2.item_id
    group by m1.item_id, m2.item_id
  ),
  endpoints as (
    select s as node, s, t, score from shared_all
    union all
    select t as node, s, t, score from shared_all
  ),
  endpoint_ranked as (
    select s, t, row_number() over (partition by node order by score desc, s, t) as pos
    from endpoints
  ),
  shared as (
    select a.s, a.t, a.labels, a.weight
    from shared_all a
    where exists (
      select 1 from endpoint_ranked r
      where r.s = a.s and r.t = a.t and r.pos <= greatest(p_max_links_per_item, 1)
    )
  ),
  summ as (
    select distinct on (c.item_id) c.item_id, c.embedding
    from public.brain_chunks c
    where c.embedding is not null
    order by c.item_id, (c.chunk_type = 'summary') desc, c.chunk_index
  ),
  sim as (
    select x.item_id as a, n.item_id as b, 1 - (x.embedding <=> n.embedding) as similarity
    from summ x
    cross join lateral (
      select o.item_id, o.embedding
      from summ o
      where o.item_id <> x.item_id
      order by o.embedding <=> x.embedding
      limit greatest(p_similar_per_item, 0)
    ) n
  ),
  sim_pairs as (
    select least(a, b) as s, greatest(a, b) as t, max(similarity) as similarity
    from sim
    where similarity >= p_min_similarity
    group by 1, 2
  ),
  links as (
    select s, t, 'shared'::text as link_type, weight, labels from shared
    union all
    select sp.s, sp.t, 'similar', sp.similarity, '{}'::text[]
    from sim_pairs sp
    where not exists (select 1 from shared h where h.s = sp.s and h.t = sp.t)
  )
  select l.s, si.title, l.t, ti.title, l.link_type, l.weight, l.labels
  from links l
  join public.brain_items si on si.id = l.s
  join public.brain_items ti on ti.id = l.t
$$;

revoke execute on function public.brain_item_links(int, double precision, int, int) from public, anon;
grant execute on function public.brain_item_links(int, double precision, int, int) to authenticated;

-- Mesmas duas entradas de antes: o app continua chamando com p_min_similarity opcional
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
