import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDb, unitVector, blend, asVector, MIGRATION_PATH } from '../helpers/db.mjs';

let db;
before(async () => { db = await createDb(); });
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('truncate public.brain_items cascade');
});

async function newItem(title = 'Nota', extra = {}) {
  const r = await db.query(
    'insert into brain_items (title, source_type, category) values ($1, $2, $3) returning id',
    [title, extra.source_type ?? 'reel', extra.category ?? null]
  );
  return r.rows[0].id;
}

const uuid = () => crypto.randomUUID();

async function replace(itemId, atoms, chunks, { status = 'done', category = 'ia', useCases = ['x'] } = {}) {
  const r = await db.query(
    'select public.brain_replace_item_knowledge($1, $2::jsonb, $3::jsonb, $4, $5::text[], $6, $7) as r',
    [itemId, JSON.stringify(atoms), JSON.stringify(chunks), category, `{${useCases.join(',')}}`, status, null]
  );
  return r.rows[0].r;
}

async function search(embedding, text, keywords = [], { count = 14, kinds = null, category = null } = {}) {
  const r = await db.query(
    'select * from public.search_brain($1::vector, $2, $3::text[], $4, $5::text[], $6)',
    [embedding ? asVector(embedding) : null, text, `{${keywords.join(',')}}`, count, kinds ? `{${kinds.join(',')}}` : null, category]
  );
  return r.rows;
}

test('a migração é idempotente (roda duas vezes sem erro)', async () => {
  await db.exec(readFileSync(MIGRATION_PATH, 'utf8'));
});

test('falha com mensagem clara se is_owner() não existir', async () => {
  const bare = await createDb({ applyMigration: false });
  await bare.exec('drop function public.is_owner()');
  await assert.rejects(bare.exec(readFileSync(MIGRATION_PATH, 'utf8')), /is_owner/);
  await bare.close();
});

test('itens antigos entram como pending e chunks antigos ganham fts', async () => {
  const fresh = await createDb({ applyMigration: false });
  const it = await fresh.query("insert into brain_items (title) values ('Velho') returning id");
  await fresh.query("insert into brain_chunks (item_id, content) values ($1, 'automação de vendas')", [it.rows[0].id]);
  await fresh.exec(readFileSync(MIGRATION_PATH, 'utf8'));
  const item = await fresh.query('select analysis_status from brain_items');
  const chunk = await fresh.query('select fts is not null as ok from brain_chunks');
  assert.equal(item.rows[0].analysis_status, 'pending');
  assert.equal(chunk.rows[0].ok, true);
  await fresh.close();
});

test('grava átomos e trechos de forma atômica e idempotente', async () => {
  const item = await newItem();
  const atomId = uuid();
  const atoms = [{
    id: atomId, kind: 'ferramenta', name: 'Remotion', content: null,
    explanation: 'Cria vídeos com React.', use_for: 'animação programática',
    url: 'https://remotion.dev', questions: ['Qual ferramenta anima vídeos?'], tags: ['video', 'react'],
    canonical_key: 'url:remotion.dev'
  }];
  const chunks = [
    { atom_id: atomId, chunk_type: 'atom', chunk_index: 0, content: 'Remotion cria vídeos', embedding: unitVector(1) },
    { atom_id: null, chunk_type: 'summary', chunk_index: 1, content: 'Resumo do vídeo', embedding: null }
  ];
  const first = await replace(item, atoms, chunks);
  assert.deepEqual(first, { atoms: 1, chunks: 2 });
  await replace(item, atoms, chunks);
  const counts = await db.query('select (select count(*) from brain_atoms)::int a, (select count(*) from brain_chunks)::int c');
  assert.deepEqual(counts.rows[0], { a: 1, c: 2 });

  const stored = await db.query('select questions, tags, fts is not null as f from brain_atoms');
  assert.deepEqual(stored.rows[0].questions, ['Qual ferramenta anima vídeos?']);
  assert.deepEqual(stored.rows[0].tags, ['video', 'react']);
  assert.equal(stored.rows[0].f, true);

  const it = await db.query('select category, use_cases, analysis_status from brain_items');
  assert.deepEqual(it.rows[0], { category: 'ia', use_cases: ['x'], analysis_status: 'done' });
});

test('status inválido é recusado e nada é alterado', async () => {
  const item = await newItem();
  await replace(item, [], [{ chunk_type: 'summary', chunk_index: 0, content: 'a', embedding: null }]);
  await assert.rejects(replace(item, [], [], { status: 'qualquer' }), /status_invalido/);
  const c = await db.query('select count(*)::int n from brain_chunks');
  assert.equal(c.rows[0].n, 1);
});

test('erro no meio da gravação desfaz tudo (átomo inválido)', async () => {
  const item = await newItem();
  await replace(item, [{ id: uuid(), kind: 'nota', name: 'Antigo', explanation: 'x' }],
    [{ chunk_type: 'summary', chunk_index: 0, content: 'antigo', embedding: null }]);
  await assert.rejects(replace(item, [{ id: uuid(), kind: 'MAIÚSCULA', name: 'Novo', explanation: 'x' }], []));
  const names = await db.query('select name from brain_atoms');
  assert.deepEqual(names.rows.map(r => r.name), ['Antigo']);
});

test('item inexistente é recusado', async () => {
  await assert.rejects(replace(uuid(), [], []), /item_nao_encontrado/);
});

test('excluir o item remove átomos e trechos (cascade)', async () => {
  const item = await newItem();
  const a = uuid();
  await replace(item, [{ id: a, kind: 'codigo', name: 'x', explanation: 'y' }],
    [{ atom_id: a, chunk_type: 'atom', chunk_index: 0, content: 'x', embedding: null }]);
  await db.query('delete from brain_items where id = $1', [item]);
  const r = await db.query('select (select count(*) from brain_atoms)::int a, (select count(*) from brain_chunks)::int c');
  assert.deepEqual(r.rows[0], { a: 0, c: 0 });
});

test('busca por texto ignora acentos e plural ("animacao" acha "animações")', async () => {
  const item = await newItem();
  const a = uuid();
  await replace(item, [{ id: a, kind: 'ferramenta', name: 'Motion Canvas', explanation: 'Cria animações vetoriais' }],
    [{ atom_id: a, chunk_type: 'atom', chunk_index: 0, content: 'Motion Canvas: cria animações vetoriais', embedding: null }]);
  const rows = await search(null, 'ferramentas de animacao', ['animacao']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].atom_id, a);
});

test('pergunta em linguagem natural funciona com semântica OR (palavra ausente não zera)', async () => {
  const item = await newItem();
  const a = uuid();
  await replace(item, [{ id: a, kind: 'repositorio', name: 'crm-simples', explanation: 'Cadastro de clientes' }],
    [{ atom_id: a, chunk_type: 'atom', chunk_index: 0, content: 'crm-simples cadastro de clientes', embedding: null }]);
  const rows = await search(null, 'quero um sistema de cadastro de clientes com zzzxyz', []);
  assert.equal(rows[0]?.atom_id, a);
});

test('busca semântica ordena pelo vetor mais próximo', async () => {
  const item = await newItem();
  const a = uuid(), b = uuid();
  await replace(item, [
    { id: a, kind: 'ferramenta', name: 'Alpha', explanation: 'a' },
    { id: b, kind: 'ferramenta', name: 'Beta', explanation: 'b' }
  ], [
    { atom_id: a, chunk_type: 'atom', chunk_index: 0, content: 'zzz', embedding: unitVector(10) },
    { atom_id: b, chunk_type: 'atom', chunk_index: 1, content: 'yyy', embedding: unitVector(20) }
  ]);
  const rows = await search(blend(unitVector(20), unitVector(21), 0.9), '', []);
  assert.equal(rows[0].atom_id, b);
});

test('acerto pelo nome supera semântica fraca (link da ferramenta X)', async () => {
  const item = await newItem();
  const target = uuid(), other = uuid();
  await replace(item, [
    { id: target, kind: 'ferramenta', name: 'Remotion', explanation: 'x', url: 'https://remotion.dev' },
    { id: other, kind: 'ferramenta', name: 'Outra', explanation: 'x' }
  ], [
    { atom_id: target, chunk_type: 'atom', chunk_index: 0, content: 'a', embedding: unitVector(50) },
    { atom_id: other, chunk_type: 'atom', chunk_index: 1, content: 'b', embedding: unitVector(60) }
  ]);
  const rows = await search(unitVector(60), 'link do remotion', ['link', 'remotion']);
  assert.equal(rows[0].atom_id, target);
});

test('filtra por tipo de átomo e por categoria', async () => {
  const i1 = await newItem('A', { category: 'ia' });
  const i2 = await newItem('B', { category: 'marketing' });
  const a = uuid(), b = uuid();
  await replace(i1, [{ id: a, kind: 'codigo', name: 'resize', explanation: 'redimensiona imagem' }],
    [{ atom_id: a, chunk_type: 'atom', chunk_index: 0, content: 'redimensiona imagem', embedding: null }], { category: 'ia' });
  await replace(i2, [{ id: b, kind: 'ferramenta', name: 'Canva', explanation: 'redimensiona imagem' }],
    [{ atom_id: b, chunk_type: 'atom', chunk_index: 0, content: 'redimensiona imagem', embedding: null }], { category: 'marketing' });
  assert.equal((await search(null, 'imagem', ['imagem'])).length, 2);
  assert.deepEqual((await search(null, 'imagem', ['imagem'], { kinds: ['codigo'] })).map(r => r.atom_id), [a]);
  assert.deepEqual((await search(null, 'imagem', ['imagem'], { category: 'marketing' })).map(r => r.atom_id), [b]);
});

test('vários átomos do mesmo item aparecem todos (lista de ferramentas)', async () => {
  const item = await newItem();
  const ids = Array.from({ length: 6 }, uuid);
  await replace(item, ids.map((id, i) => ({ id, kind: 'ferramenta', name: `Tool${i}`, explanation: 'anima vídeos' })),
    ids.map((id, i) => ({ atom_id: id, chunk_type: 'atom', chunk_index: i, content: `Tool${i} anima vídeos`, embedding: null })));
  const rows = await search(null, 'anima videos', ['anima', 'videos']);
  assert.equal(rows.length, 6);
});

test('trechos soltos do mesmo item são limitados a 3', async () => {
  const item = await newItem();
  const chunks = Array.from({ length: 8 }, (_, i) => ({ atom_id: null, chunk_type: 'content', chunk_index: i, content: `funil de vendas parte ${i}`, embedding: null }));
  await replace(item, [], chunks);
  const rows = await search(null, 'funil', ['funil']);
  assert.equal(rows.length, 3);
});

test('busca sem nenhum termo útil devolve vazio sem erro', async () => {
  const rows = await search(null, '', []);
  assert.deepEqual(rows, []);
});

test('termos com caracteres especiais não quebram a busca', async () => {
  const rows = await search(null, "o que é 'a' & (b) | !c <-> d:*", []);
  assert.ok(Array.isArray(rows));
});

test('brain_claim_item impede processamento duplicado e libera após 10 min', async () => {
  const item = await newItem();
  assert.equal((await db.query('select public.brain_claim_item($1) r', [item])).rows[0].r, true);
  assert.equal((await db.query('select public.brain_claim_item($1) r', [item])).rows[0].r, false);
  await db.query("update brain_items set analysis_updated_at = now() - interval '11 minutes' where id = $1", [item]);
  assert.equal((await db.query('select public.brain_claim_item($1) r', [item])).rows[0].r, true);
});

test('brain_overview resume o acervo', async () => {
  const item = await newItem('Vídeo', { category: 'ia' });
  const a = uuid();
  await replace(item, [{ id: a, kind: 'ferramenta', name: 'X', explanation: 'y' }], []);
  const o = (await db.query('select public.brain_overview() o')).rows[0].o;
  assert.equal(o.total_items, 1);
  assert.equal(o.total_atoms, 1);
  assert.deepEqual(o.by_kind, { ferramenta: 1 });
  assert.deepEqual(o.by_category, { ia: 1 });
});

test('RLS habilitada e política do dono existente em brain_atoms', async () => {
  const r = await db.query(`select relrowsecurity from pg_class where relname = 'brain_atoms'`);
  assert.equal(r.rows[0].relrowsecurity, true);
  const p = await db.query(`select policyname from pg_policies where tablename = 'brain_atoms'`);
  assert.deepEqual(p.rows.map(x => x.policyname), ['brain_atoms_owner']);
});
