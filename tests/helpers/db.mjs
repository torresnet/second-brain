import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';

export const MIGRATION_PATH = fileURLToPath(
  new URL('../../supabase/migrations/20261017120000_knowledge_atoms.sql', import.meta.url)
);
export const DUPLICATES_MIGRATION_PATH = fileURLToPath(
  new URL('../../supabase/migrations/20261017130000_duplicates.sql', import.meta.url)
);

export const EXAMPLES_MIGRATION_PATH = fileURLToPath(
  new URL('../../supabase/migrations/20261017140000_practical_examples.sql', import.meta.url)
);

// Reproduz o que já existe em produção antes da migração
const BASE_SCHEMA = `
  create schema if not exists extensions;
  create extension if not exists vector with schema extensions;
  create role anon;
  create role authenticated;
  set search_path = public, extensions;
  create table public.brain_items (
    id uuid primary key default gen_random_uuid(),
    title text, summary text, source_type text default 'note', source_url text, raw_content text,
    key_takeaways jsonb default '[]', action_items jsonb default '[]', entities jsonb default '[]',
    stage text default 'seedling', tags text[] default '{}', metadata jsonb default '{}',
    is_favorite boolean default false, created_at timestamptz default now()
  );
  create table public.brain_chunks (
    id uuid primary key default gen_random_uuid(),
    item_id uuid references public.brain_items(id) on delete cascade,
    chunk_index int default 0, content text, embedding vector(768),
    created_at timestamptz default now()
  );
  create function public.is_owner() returns boolean language sql stable as 'select true';
`;

export async function createDb({ applyMigration = true } = {}) {
  const db = new PGlite({ extensions: { vector, pg_trgm, unaccent } });
  await db.exec(BASE_SCHEMA);
  if (applyMigration) {
    await db.exec(readFileSync(MIGRATION_PATH, 'utf8'));
    await db.exec(readFileSync(DUPLICATES_MIGRATION_PATH, 'utf8'));
    await db.exec(readFileSync(EXAMPLES_MIGRATION_PATH, 'utf8'));
  }
  return db;
}

export function unitVector(index, dims = 768) {
  const v = new Array(dims).fill(0);
  v[index] = 1;
  return v;
}

export function blend(a, b, wa = 0.5) {
  return a.map((x, i) => x * wa + b[i] * (1 - wa));
}

export const asVector = (arr) => `[${arr.join(',')}]`;
