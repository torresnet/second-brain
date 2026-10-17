import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRlsDb, asUser, RLS_AUTH_SQL, RLS_BASE_MIGRATION_SQL } from '../helpers/db.mjs';
import { PGlite } from '@electric-sql/pglite';

const OWNER = '11111111-1111-1111-1111-111111111111';
const STRANGER = '22222222-2222-2222-2222-222222222222';
const DATA_TABLES = ['brain_items', 'brain_chunks', 'brain_atoms', 'brain_duplicate_decisions'];
const RPCS = [
  'owner_check', 'is_owner', 'search_brain', 'brain_overview', 'brain_claim_item', 'brain_replace_item_knowledge',
  'brain_item_links', 'brain_set_duplicate_decision', 'brain_find_duplicates_by_url', 'brain_possible_duplicates',
  'brain_merge_items', 'brain_set_practical_examples', 'match_brain_chunks'
];

const ITEM_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ITEM_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

async function seeded(options = {}) {
  const db = await createRlsDb({ ownerId: OWNER, ...options });
  await db.query(`insert into public.brain_items (id, title, raw_content) values ($1, 'Nota A', 'segredo A'), ($2, 'Nota B', 'segredo B')`, [ITEM_A, ITEM_B]);
  await db.query(`insert into public.brain_atoms (item_id, kind, name) values ($1, 'ferramenta', 'Atomo A')`, [ITEM_A]);
  await db.query(`insert into public.brain_chunks (item_id, content) values ($1, 'trecho A')`, [ITEM_A]);
  await db.query(`insert into public.brain_duplicate_decisions (item_a, item_b) values ($1, $2)`, [ITEM_A, ITEM_B]);
  return db;
}

const count = async (db, table) => Number((await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n);

test('RLS: todas as tabelas do schema public têm RLS ativo (pega tabela nova esquecida)', async () => {
  const db = await seeded();
  const { rows } = await db.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`);
  assert.deepEqual(rows, []);
  const policies = await db.query(`select tablename, roles::text as roles from pg_policies where schemaname = 'public'`);
  for (const table of DATA_TABLES) {
    const mine = policies.rows.filter(p => p.tablename === table);
    assert.ok(mine.length >= 1, `${table} sem política`);
    assert.ok(mine.every(p => p.roles === '{authenticated}'), `${table} com política fora de authenticated`);
  }
  assert.equal(policies.rows.filter(p => p.tablename === 'brain_owner').length, 0);
});

test('RLS: anon não acessa nenhuma tabela nem função', async () => {
  const db = await seeded();
  await asUser(db, 'anon', null, async () => {
    for (const table of [...DATA_TABLES, 'brain_owner']) {
      await assert.rejects(db.query(`select * from public.${table}`), /permission denied/, table);
    }
    await assert.rejects(db.query(`insert into public.brain_items (title) values ('x')`), /permission denied/);
  });
  const { rows } = await db.query(
    `select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
     from pg_proc p where pronamespace = 'public'::regnamespace and proname = any($1)`, [RPCS]);
  assert.ok(rows.length >= RPCS.length - 1);
  for (const r of rows) {
    assert.equal(r.anon, false, `${r.proname} executável por anon`);
    assert.equal(r.auth, true, `${r.proname} não executável por authenticated`);
  }
});

test('RLS: usuário autenticado que não é o dono não lê, cria, altera nem apaga nada', async () => {
  const db = await seeded();
  await asUser(db, 'authenticated', STRANGER, async () => {
    for (const table of DATA_TABLES) assert.equal(await count(db, table), 0, `${table} visível`);
    await assert.rejects(db.query(`insert into public.brain_items (title) values ('invasor')`), /row-level security/);
    await assert.rejects(db.query(`insert into public.brain_chunks (item_id, content) values ($1, 'x')`, [ITEM_A]), /row-level security/);
    await assert.rejects(db.query(`insert into public.brain_atoms (item_id, kind, name) values ($1, 'ferramenta', 'x')`, [ITEM_A]), /row-level security/);
    assert.equal((await db.query(`update public.brain_items set title = 'hack' returning id`)).rows.length, 0);
    assert.equal((await db.query(`delete from public.brain_items returning id`)).rows.length, 0);
    await assert.rejects(db.query(`select * from public.brain_owner`), /permission denied/);

    assert.equal((await db.query('select public.is_owner() as ok')).rows[0].ok, false);
    assert.deepEqual((await db.query('select public.owner_check() as r')).rows[0].r, { is_owner: false });
    assert.equal((await db.query('select public.brain_overview() as o')).rows[0].o.total_items, 0);
    assert.equal((await db.query(`select public.brain_claim_item($1) as ok`, [ITEM_A])).rows[0].ok, false);
    assert.equal((await db.query(`select * from public.brain_possible_duplicates($1)`, [ITEM_A])).rows.length, 0);
    assert.equal((await db.query(`select * from public.brain_find_duplicates_by_url('https://exemplo.com')`)).rows.length, 0);
    assert.equal((await db.query(`select * from public.brain_item_links()`)).rows.length, 0);
    await assert.rejects(db.query(`select public.brain_merge_items($1, $2)`, [ITEM_A, ITEM_B]), /item_nao_encontrado/);
    await assert.rejects(db.query(`select public.brain_set_practical_examples($1, '[]'::jsonb)`, [ITEM_A]), /item_nao_encontrado/);
    await assert.rejects(db.query(`select public.brain_set_duplicate_decision($1, $2)`, [ITEM_A, ITEM_B]), /row-level security/);
    await assert.rejects(
      db.query(`select public.brain_replace_item_knowledge($1, '[]'::jsonb, '[]'::jsonb, 'x', '{}', 'done', null)`, [ITEM_A]),
      /item_nao_encontrado/);
  });
  assert.equal(await count(db, 'brain_items'), 2, 'dados do dono intactos');
});

test('RLS: sem sessão (uid nulo) nunca é dono', async () => {
  const db = await seeded();
  await asUser(db, 'authenticated', null, async () => {
    assert.equal((await db.query('select public.is_owner() as ok')).rows[0].ok, false);
    assert.equal(await count(db, 'brain_items'), 0);
  });
});

test('RLS: o dono tem acesso completo às tabelas e às funções', async () => {
  const db = await seeded();
  await asUser(db, 'authenticated', OWNER, async () => {
    assert.equal(await count(db, 'brain_items'), 2);
    assert.equal(await count(db, 'brain_atoms'), 1);
    assert.equal(await count(db, 'brain_chunks'), 1);
    assert.equal(await count(db, 'brain_duplicate_decisions'), 1);
    assert.deepEqual((await db.query('select public.owner_check() as r')).rows[0].r, { is_owner: true });
    assert.equal((await db.query('select public.brain_overview() as o')).rows[0].o.total_items, 2);
    await db.query(`insert into public.brain_items (title) values ('minha nova nota')`);
    assert.equal((await db.query(`update public.brain_items set title = 'editada' where id = $1 returning id`, [ITEM_A])).rows.length, 1);
    await db.query(`select public.brain_merge_items($1, $2)`, [ITEM_A, ITEM_B]);
    assert.equal(await count(db, 'brain_items'), 2);
    assert.equal((await db.query(`delete from public.brain_items returning id`)).rows.length, 2);
  });
});

test('RLS: brain_owner guarda o dono e o script recusa o UUID de zeros', async () => {
  const db = await seeded();
  assert.deepEqual((await db.query('select user_id from public.brain_owner')).rows, [{ user_id: OWNER }]);
  const fresh = new PGlite();
  await fresh.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`);
  await assert.rejects(fresh.exec(RLS_AUTH_SQL), /Troque o UUID/);
  const { rows } = await fresh.query(`select count(*)::int as n from pg_proc where proname = 'is_owner'`);
  assert.equal(rows[0].n, 0, 'sem dono definido nenhuma função is_owner é criada');
});

test('RLS: trocar o dono (reexecutar auth_rls.sql) revoga o acesso do anterior', async () => {
  const db = await seeded();
  await db.exec(RLS_AUTH_SQL.replace(`:= '00000000-0000-0000-0000-000000000000'`, `:= '${STRANGER}'`));
  await asUser(db, 'authenticated', OWNER, async () => assert.equal(await count(db, 'brain_items'), 0));
  await asUser(db, 'authenticated', STRANGER, async () => assert.equal(await count(db, 'brain_items'), 2));
});

test('RLS: is_owner tem search_path fixo e é security definer; a migration base é idempotente', async () => {
  const db = await seeded();
  const { rows } = await db.query(`select prosecdef, proconfig::text as cfg from pg_proc where proname = 'is_owner'`);
  assert.equal(rows[0].prosecdef, true);
  assert.match(rows[0].cfg, /search_path=public, pg_temp/);
  await db.exec(RLS_BASE_MIGRATION_SQL);
  await db.exec(RLS_BASE_MIGRATION_SQL);
  assert.equal(await count(db, 'brain_items'), 2);
});

test('RLS: match_brain_chunks legada vira security invoker e fecha para anon', async () => {
  const db = await createRlsDb({ ownerId: OWNER, legacyMatchFunction: true });
  await db.query(`insert into public.brain_chunks (content) values ('segredo')`);
  const { rows } = await db.query(`select prosecdef, has_function_privilege('anon', oid, 'execute') as anon from pg_proc where proname = 'match_brain_chunks'`);
  assert.deepEqual(rows, [{ prosecdef: false, anon: false }]);
  await asUser(db, 'authenticated', STRANGER, async () => {
    assert.equal((await db.query(`select * from public.match_brain_chunks(null, 0.1, 10)`)).rows.length, 0);
  });
  await asUser(db, 'authenticated', OWNER, async () => {
    assert.equal((await db.query(`select * from public.match_brain_chunks(null, 0.1, 10)`)).rows.length, 1);
  });
});
