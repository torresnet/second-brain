-- Unificar notas: a mesclagem deixa de ser só uma concatenação.
-- Este RPC continua instantâneo e sem IA: junta o material (tags, entidades, favorito, links), guarda o conteúdo
-- ORIGINAL das duas notas em metadata e deixa um pedido de unificação (metadata.pending_unify) na nota mantida,
-- que volta para a fila de indexação. A Edge Function lê o pedido, pede à IA para unificar o conhecimento
-- (sem repetições, com título novo) e, se a cota da IA estiver esgotada, o pedido espera na fila até ela voltar.

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
  removed_source jsonb;
  request jsonb;
begin
  if p_keep is null or p_remove is null or p_keep = p_remove then
    raise exception 'par_invalido';
  end if;
  select * into k from public.brain_items where id = p_keep for update;
  select * into r from public.brain_items where id = p_remove for update;
  if k.id is null or r.id is null then
    raise exception 'item_nao_encontrado';
  end if;

  -- texto provisório (enquanto a IA não unifica): a nota mantida nunca perde conteúdo
  appended := case
    when btrim(coalesce(r.raw_content, '')) = '' or btrim(coalesce(r.raw_content, '')) = btrim(coalesce(k.raw_content, ''))
      then coalesce(k.raw_content, '')
    else coalesce(k.raw_content, '') || E'\n\n--- Mesclado da nota "' || coalesce(r.title, 'Sem título') || '" ('
         || coalesce(r.source_url, 'sem link') || E') ---\n' || r.raw_content
  end;

  -- a nota removida fica guardada por inteiro (recuperável), com o link e a data de criação
  removed_source := jsonb_build_object(
    'title', r.title, 'url', r.source_url, 'summary', r.summary, 'raw_content', r.raw_content,
    'created_at', r.created_at, 'merged_at', now()
  );

  -- pedido de unificação: o "antes" da nota mantida é guardado uma única vez; mesclagens seguidas só acrescentam fontes
  request := case
    when jsonb_typeof(k.metadata -> 'pending_unify') = 'object' then jsonb_set(
      k.metadata -> 'pending_unify', '{sources}',
      coalesce(k.metadata -> 'pending_unify' -> 'sources', '[]'::jsonb) || jsonb_build_array(removed_source)
    )
    else jsonb_build_object(
      'requested_at', now(),
      'base', jsonb_build_object('title', k.title, 'url', k.source_url, 'summary', k.summary, 'raw_content', k.raw_content, 'created_at', k.created_at),
      'sources', jsonb_build_array(removed_source)
    )
  end;

  update public.brain_items
  set raw_content = appended,
      source_url = coalesce(nullif(btrim(k.source_url), ''), r.source_url),
      tags = (select coalesce(array_agg(distinct t), '{}') from unnest(coalesce(k.tags, '{}') || coalesce(r.tags, '{}')) t),
      entities = (
        select coalesce(jsonb_agg(distinct e), '[]'::jsonb)
        from jsonb_array_elements(
          (case when jsonb_typeof(k.entities) = 'array' then k.entities else '[]'::jsonb end) ||
          (case when jsonb_typeof(r.entities) = 'array' then r.entities else '[]'::jsonb end)
        ) e
      ),
      metadata = jsonb_set(
        jsonb_set(
          coalesce(k.metadata, '{}'::jsonb), '{merged_sources}',
          coalesce(k.metadata -> 'merged_sources', '[]'::jsonb) || jsonb_build_array(removed_source)
        ),
        '{pending_unify}', request
      ),
      is_favorite = coalesce(k.is_favorite, false) or coalesce(r.is_favorite, false),
      analysis_status = 'pending',
      analysis_error = null,
      analysis_attempts = 0
  where id = p_keep;

  delete from public.brain_items where id = p_remove;
  return p_keep;
end $$;

revoke execute on function public.brain_merge_items(uuid, uuid) from public, anon;
grant execute on function public.brain_merge_items(uuid, uuid) to authenticated;
