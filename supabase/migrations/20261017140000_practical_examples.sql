-- Segundo Cérebro v0.3.2: "Como aplicar na prática" (até 5 exemplos por nota, gerados pela IA).
-- Pré-requisito: 20261017120000_knowledge_atoms.sql. Idempotente.

set search_path = public, extensions;

alter table public.brain_items
  add column if not exists practical_examples jsonb not null default '[]'::jsonb;

-- Grava os exemplos de uma nota (lista vazia limpa; a IA nunca é obrigada a gerar 5)
create or replace function public.brain_set_practical_examples(p_item_id uuid, p_examples jsonb)
returns void
language plpgsql
security invoker
set search_path = public, extensions
as $$
begin
  if p_examples is null or jsonb_typeof(p_examples) <> 'array' then
    raise exception 'exemplos_invalidos';
  end if;
  update public.brain_items set practical_examples = p_examples where id = p_item_id;
  if not found then
    raise exception 'item_nao_encontrado';
  end if;
end $$;

revoke execute on function public.brain_set_practical_examples(uuid, jsonb) from public, anon;
grant execute on function public.brain_set_practical_examples(uuid, jsonb) to authenticated;
