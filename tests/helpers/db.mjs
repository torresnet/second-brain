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

const AUTH_RLS_PATH = fileURLToPath(new URL('../../supabase/auth_rls.sql', import.meta.url));
const BASE_RLS_MIGRATION_PATH = fileURLToPath(new URL('../../supabase/migrations/20261017110000_base_schema_rls.sql', import.meta.url));
const HARDENING_MIGRATION_PATH = fileURLToPath(new URL('../../supabase/migrations/20261017150000_security_hardening.sql', import.meta.url));
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

export const RLS_AUTH_SQL = readFileSync(AUTH_RLS_PATH, 'utf8');
export const RLS_BASE_MIGRATION_SQL = readFileSync(BASE_RLS_MIGRATION_PATH, 'utf8');
export const HARDENING_MIGRATION_SQL = readFileSync(HARDENING_MIGRATION_PATH, 'utf8');

/**
 * Banco com o SQL real de produção (auth_rls.sql + todas as migrations) e papéis anon/authenticated,
 * sem o stub `is_owner() = true` de createDb. Reproduz os default privileges do Supabase.
 */
export async function createRlsDb({ ownerId, legacyMatchFunction = false } = {}) {
  const db = new PGlite({ extensions: { vector, pg_trgm, unaccent } });
  await db.exec(`
    create schema if not exists extensions;
    create extension if not exists vector with schema extensions;
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema auth, public, extensions to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
  `);
  if (legacyMatchFunction) {
    await db.exec(`
      create function public.match_brain_chunks(query_embedding extensions.vector(768), match_threshold float, match_count int)
      returns table (id uuid, content text) language plpgsql security definer
      as $$ begin return query select c.id, c.content from public.brain_chunks c limit match_count; end $$;
    `);
  }
  await db.exec(RLS_AUTH_SQL.replace(`:= '${ZERO_UUID}'`, `:= '${ownerId}'`));
  await db.exec(RLS_BASE_MIGRATION_SQL);
  await db.exec(readFileSync(MIGRATION_PATH, 'utf8'));
  await db.exec(readFileSync(DUPLICATES_MIGRATION_PATH, 'utf8'));
  await db.exec(readFileSync(EXAMPLES_MIGRATION_PATH, 'utf8'));
  await db.exec(HARDENING_MIGRATION_SQL);
  return db;
}

/** Executa `fn` como o papel/usuário dado (como o PostgREST faz) e volta a ser superusuário. */
export async function asUser(db, role, uid, fn) {
  await db.query('select set_config($1, $2, false)', ['test.uid', uid ?? '']);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query('select set_config($1, $2, false)', ['test.uid', '']);
  }
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
