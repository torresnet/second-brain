-- Segundo Cérebro v0.3.1: detecção de duplicatas (link repetido e notas muito parecidas) com decisão do usuário.
-- Pré-requisito: 20261017120000_knowledge_atoms.sql. Idempotente.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Chave normalizada de um link: ignora http/https, www, #fragmento, barra final e rastreadores
-- ---------------------------------------------------------------------------
create or replace function public.brain_url_key(input text)
returns text
language plpgsql
immutable
parallel safe
set search_path = public, extensions
as $$
declare
  s text := lower(btrim(coalesce(input, '')));
  q text;
  pos int;
begin
  if s = '' then
    return null;
  end if;
  s := regexp_replace(s, '^[a-z][a-z0-9+.-]*://', '');
  s := regexp_replace(s, '#.*$', '');
  s := regexp_replace(s, '^(www\.|m\.)', '');

  -- YouTube: youtu.be/ID e youtube.com/watch?v=ID são o mesmo vídeo
  if s ~ '^youtu\.be/' then
    s := 'youtube.com/watch?v=' || regexp_replace(regexp_replace(s, '^youtu\.be/', ''), '[/?&].*$', '');
  end if;

  pos := position('?' in s);
  if pos > 0 then
    q := substring(s from pos + 1);
    s := substring(s from 1 for pos - 1);
    q := array_to_string(array(
      select p
      from unnest(string_to_array(q, '&')) p
      where p <> '' and p !~ '^(utm_[^=]*|fbclid|gclid|igshid|igsh|si|feature|ref)(=|$)'
      order by p
    ), '&');
  end if;

  s := regexp_replace(s, '/+$', '');
  return s || case when coalesce(q, '') <> '' then '?' || q else '' end;
end $$;

alter table public.brain_items add column if not exists source_key text;
create index if not exists brain_items_source_key_idx on public.brain_items (source_key);

create or replace function public.brain_items_source_key_update()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.source_key := public.brain_url_key(new.source_url);
  return new;
end $$;

drop trigger if exists brain_items_source_key_trg on public.brain_items;
create trigger brain_items_source_key_trg
  before insert or update of source_url on public.brain_items
  for each row execute function public.brain_items_source_key_update();

update public.brain_items set source_key = public.brain_url_key(source_url)
where source_url is not null and source_key is distinct from public.brain_url_key(source_url);

-- ---------------------------------------------------------------------------
-- Decisões do usuário sobre pares de notas ("manter as duas")
-- ---------------------------------------------------------------------------
create table if not exists public.brain_duplicate_decisions (
  item_a uuid not null references public.brain_items (id) on delete cascade,
  item_b uuid not null references public.brain_items (id) on delete cascade,
  decision text not null default 'keep_both',
  created_at timestamptz not null default now(),
  primary key (item_a, item_b),
  constraint brain_duplicate_decisions_order check (item_a < item_b),
  constraint brain_duplicate_decisions_decision check (decision in ('keep_both'))
);

alter table public.brain_duplicate_decisions enable row level security;
revoke all on public.brain_duplicate_decisions from anon;

drop policy if exists brain_duplicate_decisions_owner on public.brain_duplicate_decisions;
create policy brain_duplicate_decisions_owner on public.brain_duplicate_decisions
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create or replace function public.brain_set_duplicate_decision(p_a uuid, p_b uuid, p_decision text default 'keep_both')
returns void
language plpgsql
security invoker
set search_path = public, extensions
as $$
begin
  if p_a is null or p_b is null or p_a = p_b then
    raise exception 'par_invalido';
  end if;
  insert into public.brain_duplicate_decisions (item_a, item_b, decision)
  values (least(p_a, p_b), greatest(p_a, p_b), p_decision)
  on conflict (item_a, item_b) do update set decision = excluded.decision, created_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- Antes de salvar: já existe nota com este link?
-- ---------------------------------------------------------------------------
create or replace function public.brain_find_duplicates_by_url(p_url text)
returns table (id uuid, title text, source_type text, created_at timestamptz)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select i.id, i.title, i.source_type, i.created_at
  from public.brain_items i
  where public.brain_url_key(p_url) is not null
    and i.source_key = public.brain_url_key(p_url)
  order by i.created_at
  limit 3
$$;

-- ---------------------------------------------------------------------------
-- Depois de salvar: esta nota tem o mesmo link ou é muito parecida com outra?
-- ---------------------------------------------------------------------------
create or replace function public.brain_possible_duplicates(
  p_item_id uuid,
  p_min_similarity double precision default 0.9
)
returns table (
  id uuid,
  title text,
  source_type text,
  created_at timestamptz,
  similarity double precision,
  reason text
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with me as (
    select c.embedding
    from public.brain_chunks c
    where c.item_id = p_item_id and c.embedding is not null
    order by (c.chunk_type = 'summary') desc, c.chunk_index
    limit 1
  ),
  cand as (
    select o.item_id, 1 - (o.embedding <=> me.embedding) as sim
    from me
    cross join lateral (
      select distinct on (c.item_id) c.item_id, c.embedding
      from public.brain_chunks c
      where c.item_id <> p_item_id and c.embedding is not null
      order by c.item_id, (c.chunk_type = 'summary') desc, c.chunk_index
    ) o
  ),
  same_link as (
    select i2.id
    from public.brain_items i1
    join public.brain_items i2 on i2.source_key = i1.source_key and i2.id <> i1.id
    where i1.id = p_item_id and i1.source_key is not null
  )
  select i.id, i.title, i.source_type, i.created_at,
         case when sl.id is not null then 1.0 else cand.sim end as similarity,
         case when sl.id is not null then 'mesmo_link' else 'muito_parecida' end as reason
  from public.brain_items i
  left join cand on cand.item_id = i.id
  left join same_link sl on sl.id = i.id
  where i.id <> p_item_id
    and (sl.id is not null or cand.sim >= p_min_similarity)
    and not exists (
      select 1 from public.brain_duplicate_decisions d
      where d.item_a = least(p_item_id, i.id) and d.item_b = greatest(p_item_id, i.id)
    )
  order by similarity desc, i.created_at
  limit 3
$$;

-- ---------------------------------------------------------------------------
-- Mesclar: junta o conteúdo de p_remove em p_keep e apaga p_remove (tudo ou nada)
-- ---------------------------------------------------------------------------
create or replace function public.brain_merge_items(p_keep uuid, p_remove uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  k public.brain_items%rowtype;
  r public.brain_items%rowtype;
  appended text;
begin
  if p_keep is null or p_remove is null or p_keep = p_remove then
    raise exception 'par_invalido';
  end if;
  select * into k from public.brain_items where id = p_keep for update;
  select * into r from public.brain_items where id = p_remove for update;
  if k.id is null or r.id is null then
    raise exception 'item_nao_encontrado';
  end if;

  appended := case
    when btrim(coalesce(r.raw_content, '')) = '' or btrim(coalesce(r.raw_content, '')) = btrim(coalesce(k.raw_content, ''))
      then coalesce(k.raw_content, '')
    else coalesce(k.raw_content, '') || E'\n\n--- Mesclado da nota "' || coalesce(r.title, 'Sem título') || '" ('
         || coalesce(r.source_url, 'sem link') || E') ---\n' || r.raw_content
  end;

  update public.brain_items
  set raw_content = appended,
      tags = (select coalesce(array_agg(distinct t), '{}') from unnest(coalesce(k.tags, '{}') || coalesce(r.tags, '{}')) t),
      entities = (
        select coalesce(jsonb_agg(distinct e), '[]'::jsonb)
        from jsonb_array_elements(
          (case when jsonb_typeof(k.entities) = 'array' then k.entities else '[]'::jsonb end) ||
          (case when jsonb_typeof(r.entities) = 'array' then r.entities else '[]'::jsonb end)
        ) e
      ),
      metadata = jsonb_set(
        coalesce(k.metadata, '{}'::jsonb), '{merged_sources}',
        coalesce(k.metadata -> 'merged_sources', '[]'::jsonb) ||
          jsonb_build_array(jsonb_build_object('title', r.title, 'url', r.source_url, 'merged_at', now()))
      ),
      is_favorite = coalesce(k.is_favorite, false) or coalesce(r.is_favorite, false),
      analysis_status = 'pending',
      analysis_error = null,
      analysis_attempts = 0
  where id = p_keep;

  delete from public.brain_items where id = p_remove;
  return p_keep;
end $$;

-- Somente usuário autenticado
revoke execute on function public.brain_set_duplicate_decision(uuid, uuid, text) from public, anon;
grant execute on function public.brain_set_duplicate_decision(uuid, uuid, text) to authenticated;
revoke execute on function public.brain_find_duplicates_by_url(text) from public, anon;
grant execute on function public.brain_find_duplicates_by_url(text) to authenticated;
revoke execute on function public.brain_possible_duplicates(uuid, double precision) from public, anon;
grant execute on function public.brain_possible_duplicates(uuid, double precision) to authenticated;
revoke execute on function public.brain_merge_items(uuid, uuid) from public, anon;
grant execute on function public.brain_merge_items(uuid, uuid) to authenticated;
