-- Segundo Cérebro v0.3: camada de "átomos" de conhecimento + busca híbrida.
-- Pré-requisito: supabase/auth_rls.sql já executado (cria public.is_owner()).
-- Idempotente: pode ser executado mais de uma vez.

set search_path = public, extensions;

do $$
begin
  if to_regprocedure('public.is_owner()') is null then
    raise exception 'public.is_owner() não existe. Execute supabase/auth_rls.sql antes desta migração.';
  end if;
end $$;

create extension if not exists vector with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Remove acentos de forma "immutable" (necessário para índices e triggers)
create or replace function public.brain_unaccent(input text)
returns text
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  select unaccent('unaccent'::regdictionary, coalesce(input, ''))
$$;

-- ---------------------------------------------------------------------------
-- brain_items: estado do processamento e classificação
-- ---------------------------------------------------------------------------
alter table public.brain_items
  add column if not exists category text,
  add column if not exists use_cases text[] not null default '{}',
  add column if not exists analysis_status text not null default 'pending',
  add column if not exists analysis_error text,
  add column if not exists analysis_updated_at timestamptz,
  add column if not exists analysis_attempts int not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'brain_items_analysis_status_check'
  ) then
    alter table public.brain_items
      add constraint brain_items_analysis_status_check
      check (analysis_status in ('pending', 'processing', 'done', 'partial', 'failed'));
  end if;
end $$;

create index if not exists brain_items_analysis_status_idx on public.brain_items (analysis_status);
create index if not exists brain_items_category_idx on public.brain_items (category);

-- ---------------------------------------------------------------------------
-- brain_atoms: cada coisa discreta dentro de um conteúdo (tipo aberto)
-- ---------------------------------------------------------------------------
create table if not exists public.brain_atoms (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.brain_items (id) on delete cascade,
  kind text not null,
  name text not null,
  content text,
  explanation text not null default '',
  use_for text,
  url text,
  language text,
  questions text[] not null default '{}',
  tags text[] not null default '{}',
  source_pos text,
  inferred boolean not null default false,
  fetch_status text,
  fetch_error text,
  fetched_content text,
  contents_summary text,
  fetched_at timestamptz,
  canonical_key text,
  fts tsvector,
  created_at timestamptz not null default now(),
  constraint brain_atoms_kind_check check (kind = lower(kind) and length(kind) between 2 and 40),
  constraint brain_atoms_name_check check (length(btrim(name)) > 0),
  constraint brain_atoms_fetch_status_check
    check (fetch_status is null or fetch_status in ('ok', 'inaccessible', 'skipped'))
);

create index if not exists brain_atoms_item_idx on public.brain_atoms (item_id);
create index if not exists brain_atoms_kind_idx on public.brain_atoms (kind);
create index if not exists brain_atoms_canonical_idx on public.brain_atoms (canonical_key);
create index if not exists brain_atoms_fts_idx on public.brain_atoms using gin (fts);
create index if not exists brain_atoms_tags_idx on public.brain_atoms using gin (tags);
create index if not exists brain_atoms_name_trgm_idx
  on public.brain_atoms using gin (public.brain_unaccent(lower(name)) gin_trgm_ops);

create or replace function public.brain_atoms_fts_update()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.fts :=
    setweight(to_tsvector('portuguese', public.brain_unaccent(new.name)), 'A') ||
    setweight(to_tsvector('portuguese', public.brain_unaccent(new.kind || ' ' || array_to_string(new.tags, ' '))), 'B') ||
    setweight(to_tsvector('portuguese', public.brain_unaccent(
      coalesce(new.explanation, '') || ' ' || coalesce(new.use_for, '') || ' ' ||
      array_to_string(new.questions, ' ') || ' ' || coalesce(new.contents_summary, '')
    )), 'B') ||
    setweight(to_tsvector('portuguese', public.brain_unaccent(
      coalesce(new.url, '') || ' ' || left(coalesce(new.content, ''), 20000)
    )), 'C');
  return new;
end $$;

drop trigger if exists brain_atoms_fts_trg on public.brain_atoms;
create trigger brain_atoms_fts_trg
  before insert or update on public.brain_atoms
  for each row execute function public.brain_atoms_fts_update();

-- ---------------------------------------------------------------------------
-- brain_chunks: vários trechos por item, ligados (ou não) a um átomo
-- ---------------------------------------------------------------------------
alter table public.brain_chunks
  add column if not exists chunk_type text not null default 'content',
  add column if not exists atom_id uuid references public.brain_atoms (id) on delete cascade,
  add column if not exists fts tsvector;

-- um item agora tem vários trechos: remove UNIQUE somente em (item_id), se existir
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.brain_chunks'::regclass
      and con.contype = 'u'
      and (select array_agg(att.attname::text order by att.attname)
           from pg_attribute att
           where att.attrelid = con.conrelid and att.attnum = any (con.conkey)) = array['item_id']
  loop
    execute format('alter table public.brain_chunks drop constraint %I', c.conname);
  end loop;
end $$;

create index if not exists brain_chunks_fts_idx on public.brain_chunks using gin (fts);
create index if not exists brain_chunks_item_idx on public.brain_chunks (item_id);
create index if not exists brain_chunks_atom_idx on public.brain_chunks (atom_id);

create or replace function public.brain_chunks_fts_update()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.fts := to_tsvector('portuguese', public.brain_unaccent(coalesce(new.content, '')));
  return new;
end $$;

drop trigger if exists brain_chunks_fts_trg on public.brain_chunks;
create trigger brain_chunks_fts_trg
  before insert or update of content on public.brain_chunks
  for each row execute function public.brain_chunks_fts_update();

update public.brain_chunks
set fts = to_tsvector('portuguese', public.brain_unaccent(coalesce(content, '')))
where fts is null;

-- ---------------------------------------------------------------------------
-- Segurança: somente o dono (mesmo padrão de auth_rls.sql)
-- ---------------------------------------------------------------------------
alter table public.brain_atoms enable row level security;
revoke all on public.brain_atoms from anon;

drop policy if exists brain_atoms_owner on public.brain_atoms;
create policy brain_atoms_owner on public.brain_atoms
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- Reserva de processamento: evita dois processos no mesmo item
-- ---------------------------------------------------------------------------
create or replace function public.brain_claim_item(p_item_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  claimed int;
begin
  -- processos que morrem sem terminar (tempo esgotado) não podem repetir para sempre
  update public.brain_items
  set analysis_status = 'failed', analysis_attempts = 0,
      analysis_error = 'A indexação foi interrompida 3 vezes por tempo esgotado. Reprocesse a nota manualmente.',
      analysis_updated_at = now()
  where id = p_item_id and analysis_status = 'processing' and analysis_attempts >= 3
    and (analysis_updated_at is null or analysis_updated_at < now() - interval '10 minutes');
  get diagnostics claimed = row_count;
  if claimed > 0 then
    return false;
  end if;

  update public.brain_items
  set analysis_status = 'processing', analysis_updated_at = now(), analysis_error = null,
      analysis_attempts = analysis_attempts + 1
  where id = p_item_id
    and (
      analysis_status <> 'processing'
      or analysis_updated_at is null
      or analysis_updated_at < now() - interval '10 minutes'
    );
  get diagnostics claimed = row_count;
  return claimed > 0;
end $$;

-- ---------------------------------------------------------------------------
-- Gravação atômica do conhecimento de um item (tudo ou nada)
-- ---------------------------------------------------------------------------
create or replace function public.brain_replace_item_knowledge(
  p_item_id uuid,
  p_atoms jsonb,
  p_chunks jsonb,
  p_category text,
  p_use_cases text[],
  p_status text,
  p_error text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  atom_count int;
  chunk_count int;
begin
  if p_status not in ('done', 'partial', 'failed') then
    raise exception 'status_invalido: %', p_status;
  end if;
  if not exists (select 1 from public.brain_items where id = p_item_id) then
    raise exception 'item_nao_encontrado';
  end if;

  delete from public.brain_chunks where item_id = p_item_id;
  delete from public.brain_atoms where item_id = p_item_id;

  insert into public.brain_atoms (
    id, item_id, kind, name, content, explanation, use_for, url, language,
    questions, tags, source_pos, inferred, fetch_status, fetch_error,
    fetched_content, contents_summary, fetched_at, canonical_key
  )
  select
    x.id, p_item_id, x.kind, x.name, x.content, coalesce(x.explanation, ''), x.use_for, x.url, x.language,
    coalesce(x.questions, '{}'), coalesce(x.tags, '{}'), x.source_pos, coalesce(x.inferred, false),
    x.fetch_status, x.fetch_error, x.fetched_content, x.contents_summary, x.fetched_at, x.canonical_key
  from jsonb_to_recordset(coalesce(p_atoms, '[]'::jsonb)) as x(
    id uuid, kind text, name text, content text, explanation text, use_for text, url text, language text,
    questions text[], tags text[], source_pos text, inferred boolean, fetch_status text, fetch_error text,
    fetched_content text, contents_summary text, fetched_at timestamptz, canonical_key text
  );
  get diagnostics atom_count = row_count;

  insert into public.brain_chunks (item_id, atom_id, chunk_type, chunk_index, content, embedding)
  select
    p_item_id, x.atom_id, x.chunk_type, x.chunk_index, x.content,
    case when x.embedding is null or jsonb_typeof(x.embedding) <> 'array' then null
         else (x.embedding::text)::vector end
  from jsonb_to_recordset(coalesce(p_chunks, '[]'::jsonb)) as x(
    atom_id uuid, chunk_type text, chunk_index int, content text, embedding jsonb
  );
  get diagnostics chunk_count = row_count;

  update public.brain_items
  set category = coalesce(nullif(btrim(p_category), ''), category),
      use_cases = coalesce(p_use_cases, '{}'),
      analysis_status = p_status,
      analysis_error = p_error,
      analysis_attempts = 0,
      analysis_updated_at = now()
  where id = p_item_id;

  return jsonb_build_object('atoms', atom_count, 'chunks', chunk_count);
end $$;

-- ---------------------------------------------------------------------------
-- Busca híbrida: significado (vetor) + texto + nome, fundidos por RRF
-- ---------------------------------------------------------------------------
create or replace function public.search_brain(
  query_embedding vector(768),
  query_text text default '',
  keywords text[] default '{}',
  match_count int default 14,
  filter_kinds text[] default null,
  filter_category text default null
)
returns table (
  chunk_id uuid,
  item_id uuid,
  atom_id uuid,
  chunk_type text,
  content text,
  score double precision
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  kws text[];
  tsq tsquery;
  piece tsquery;
  w text;
  rrf_k constant int := 60;
  pool constant int := 40;
begin
  -- palavras-chave (sem acento, minúsculas); se não vierem, extrai do texto
  select coalesce(array_agg(distinct k), '{}') into kws
  from (
    select public.brain_unaccent(lower(btrim(k))) as k
    from unnest(
      case when coalesce(array_length(keywords, 1), 0) > 0 then keywords
           else regexp_split_to_array(coalesce(query_text, ''), '[^[:alnum:]]+') end
    ) as k
  ) s
  where length(k) >= 2;

  foreach w in array kws loop
    piece := plainto_tsquery('portuguese', w);
    if numnode(piece) > 0 then
      tsq := case when tsq is null then piece else tsq || piece end;
    end if;
    -- sem acento o stemmer não casa singular/plural ("animacao" x "animacoes"):
    -- reforça com prefixo da raiz (só palavras simples, para não gerar tsquery inválida)
    if length(w) >= 6 and w ~ '^[a-z0-9]+$' then
      piece := to_tsquery('simple', left(w, length(w) - 2) || ':*');
      tsq := case when tsq is null then piece else tsq || piece end;
    end if;
  end loop;

  return query
  with
  base as (
    select c.id as cid, c.item_id as iid, c.atom_id as aid, c.chunk_type as ctype, c.content as ccontent,
           c.embedding as cemb, c.fts as cfts, a.name as aname, a.canonical_key as akey, a.url as aurl
    from public.brain_chunks c
    join public.brain_items i on i.id = c.item_id
    left join public.brain_atoms a on a.id = c.atom_id
    where (filter_kinds is null or a.kind = any (filter_kinds))
      and (filter_category is null or i.category = filter_category)
  ),
  sem as (
    select b.cid, row_number() over (order by b.cemb <=> query_embedding) as rnk
    from base b
    where query_embedding is not null and b.cemb is not null
    order by b.cemb <=> query_embedding
    limit pool
  ),
  lex as (
    select b.cid, row_number() over (order by ts_rank_cd(b.cfts, tsq) desc) as rnk
    from base b
    where tsq is not null and b.cfts @@ tsq
    order by ts_rank_cd(b.cfts, tsq) desc
    limit pool
  ),
  nm as (
    select b.cid, row_number() over (order by hits desc) as rnk
    from (
      select b2.cid,
             (select count(*) from unnest(kws) k
              where length(k) >= 3 and (
                public.brain_unaccent(lower(coalesce(b2.aname, ''))) like '%' || k || '%'
                or lower(coalesce(b2.akey, '')) like '%' || k || '%'
                or lower(coalesce(b2.aurl, '')) like '%' || k || '%')) as hits
      from base b2
      where b2.aid is not null
    ) b
    where b.hits > 0
    order by hits desc
    limit pool
  ),
  fused as (
    select f.cid, sum(f.part) as total
    from (
      select cid, 1.0 / (rrf_k + rnk) as part from sem
      union all select cid, 1.0 / (rrf_k + rnk) as part from lex
      union all select cid, 1.3 / (rrf_k + rnk) as part from nm
    ) f
    group by f.cid
  ),
  ranked as (
    select b.cid, b.iid, b.aid, b.ctype, b.ccontent, fu.total,
           -- trechos "soltos" do mesmo item competem entre si; átomos não
           case when b.aid is null
                then row_number() over (partition by b.iid, (b.aid is null) order by fu.total desc)
                else 1 end as per_item
    from fused fu
    join base b on b.cid = fu.cid
  )
  select r.cid, r.iid, r.aid, r.ctype, r.ccontent, r.total::double precision
  from ranked r
  where r.per_item <= 3
  order by r.total desc
  limit greatest(match_count, 1);
end $$;

-- Panorama do acervo ("o que você tem aí?")
create or replace function public.brain_overview()
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'total_items', (select count(*) from public.brain_items),
    'total_atoms', (select count(*) from public.brain_atoms),
    'by_category', coalesce((
      select jsonb_object_agg(coalesce(category, 'sem categoria'), n)
      from (select category, count(*) n from public.brain_items group by category) c), '{}'::jsonb),
    'by_source', coalesce((
      select jsonb_object_agg(source_type, n)
      from (select source_type, count(*) n from public.brain_items group by source_type) s), '{}'::jsonb),
    'by_kind', coalesce((
      select jsonb_object_agg(kind, n)
      from (select kind, count(*) n from public.brain_atoms group by kind) k), '{}'::jsonb),
    'top_tags', coalesce((
      select jsonb_agg(t order by n desc)
      from (select t, count(*) n from public.brain_items, unnest(tags) t group by t order by n desc limit 15) tg), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'source_type', source_type, 'category', category))
      from (select id, title, source_type, category from public.brain_items order by created_at desc limit 8) r), '[]'::jsonb)
  )
$$;

-- Funções só para usuário autenticado
revoke execute on function public.search_brain(vector, text, text[], int, text[], text) from public, anon;
grant execute on function public.search_brain(vector, text, text[], int, text[], text) to authenticated;
revoke execute on function public.brain_overview() from public, anon;
grant execute on function public.brain_overview() to authenticated;
revoke execute on function public.brain_claim_item(uuid) from public, anon;
grant execute on function public.brain_claim_item(uuid) to authenticated;
revoke execute on function public.brain_replace_item_knowledge(uuid, jsonb, jsonb, text, text[], text, text) from public, anon;
grant execute on function public.brain_replace_item_knowledge(uuid, jsonb, jsonb, text, text[], text, text) to authenticated;
