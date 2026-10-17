import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, unitVector, blend } from '../helpers/db.mjs';

let db;
before(async () => { db = await createDb(); });
after(async () => { await db.close(); });
beforeEach(async () => { await db.exec('truncate public.brain_items cascade'); });

const uuid = () => crypto.randomUUID();

async function item(title, { entities = [], atoms = [], summaryVec = null } = {}) {
  const { rows } = await db.query(
    'insert into brain_items (title, entities) values ($1, $2::jsonb) returning id',
    [title, JSON.stringify(entities)]
  );
  const id = rows[0].id;
  const atomRows = atoms.map(a => ({ id: uuid(), kind: 'ferramenta', explanation: 'x', ...a }));
  const chunks = summaryVec
    ? [{ atom_id: null, chunk_type: 'summary', chunk_index: 0, content: title, embedding: summaryVec }]
    : [];
  await db.query(
    "select public.brain_replace_item_knowledge($1, $2::jsonb, $3::jsonb, 'ia', '{}', 'done', null)",
    [id, JSON.stringify(atomRows), JSON.stringify(chunks)]
  );
  return id;
}

const links = async (...args) =>
  (await db.query('select * from public.brain_item_links(' + args.join(',') + ')')).rows;

test('notas que citam a mesma ferramenta/link ficam ligadas (shared) com o nome em comum', async () => {
  const a = await item('Nota A', { atoms: [{ name: 'Remotion', canonical_key: 'url:remotion.dev' }, { name: 'n8n', canonical_key: 'url:n8n.io' }] });
  const b = await item('Nota B', { atoms: [{ name: 'remotion.dev', canonical_key: 'url:remotion.dev' }] });
  await item('Nota C', { atoms: [{ name: 'Outra', canonical_key: 'url:outra.dev' }] });
  const rows = await links();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].link_type, 'shared');
  assert.deepEqual([rows[0].source_id, rows[0].target_id].sort(), [a, b].sort());
  assert.ok(rows[0].labels.includes('Remotion') || rows[0].labels.includes('remotion.dev'));
  assert.ok(['Nota A', 'Nota B'].includes(rows[0].source_title));
});

test('entidades em comum (wikilinks) também ligam notas, sem diferenciar maiúsculas', async () => {
  await item('Nota A', { entities: ['Supabase', 'CRM'] });
  await item('Nota B', { entities: ['supabase'] });
  const rows = await links();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].link_type, 'shared');
  assert.ok(rows[0].weight >= 1);
});

test('várias coisas em comum viram uma única ligação com peso maior', async () => {
  await item('A', { entities: ['X', 'Y'], atoms: [{ name: 'T', canonical_key: 'k:t' }] });
  await item('B', { entities: ['x', 'y'], atoms: [{ name: 'T', canonical_key: 'k:t' }] });
  const rows = await links();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].weight, 3);
});

test('assunto parecido (vetores próximos) cria ligação "similar"; distante não', async () => {
  const base = unitVector(5);
  const a = await item('A', { summaryVec: base });
  const b = await item('B', { summaryVec: blend(base, unitVector(6), 0.95) });
  await item('C', { summaryVec: unitVector(300) });
  const rows = await links(2, 0.7);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].link_type, 'similar');
  assert.deepEqual([rows[0].source_id, rows[0].target_id].sort(), [a, b].sort());
  assert.ok(rows[0].weight > 0.9);
});

test('par já ligado por "shared" não duplica como "similar"', async () => {
  const base = unitVector(9);
  await item('A', { entities: ['Z'], summaryVec: base });
  await item('B', { entities: ['z'], summaryVec: blend(base, unitVector(10), 0.95) });
  const rows = await links(2, 0.5);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].link_type, 'shared');
});

test('sem notas, sem vetores e sem entidades inválidas não dá erro', async () => {
  assert.deepEqual(await links(), []);
  await item('Solta');
  await db.query("update brain_items set entities = '\"texto\"'::jsonb");
  assert.deepEqual(await links(), []);
});

test('nunca liga uma nota a ela mesma', async () => {
  await item('A', { entities: ['X', 'x'], atoms: [{ name: 'T', canonical_key: 'k:t' }, { name: 'T2', canonical_key: 'k:t2' }] });
  assert.deepEqual(await links(), []);
});
