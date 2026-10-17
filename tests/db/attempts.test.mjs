import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDb, MIGRATION_PATH } from '../helpers/db.mjs';

test('item que morre 3 vezes por tempo esgotado vira "failed" em vez de repetir para sempre', async () => {
  const db = await createDb();
  const { rows } = await db.query("insert into brain_items (title) values ('x') returning id");
  const id = rows[0].id;
  const claim = async () => (await db.query('select public.brain_claim_item($1) r', [id])).rows[0].r;
  const age = () => db.query("update brain_items set analysis_updated_at = now() - interval '11 minutes' where id = $1", [id]);

  assert.equal(await claim(), true); await age();
  assert.equal(await claim(), true); await age();
  assert.equal(await claim(), true); await age();
  assert.equal(await claim(), false);
  const item = (await db.query('select analysis_status, analysis_error, analysis_attempts from brain_items')).rows[0];
  assert.equal(item.analysis_status, 'failed');
  assert.match(item.analysis_error, /3 vezes/);
  assert.equal(item.analysis_attempts, 0);
  assert.equal(await claim(), true, 'depois de falhar, a nova tentativa manual é permitida');
  await db.close();
});

test('gravação com sucesso zera as tentativas', async () => {
  const db = await createDb();
  const { rows } = await db.query("insert into brain_items (title) values ('x') returning id");
  const id = rows[0].id;
  await db.query('select public.brain_claim_item($1)', [id]);
  await db.query("select public.brain_replace_item_knowledge($1, '[]'::jsonb, '[]'::jsonb, 'ia', '{}', 'done', null)", [id]);
  const item = (await db.query('select analysis_attempts, analysis_status from brain_items')).rows[0];
  assert.deepEqual(item, { analysis_attempts: 0, analysis_status: 'done' });
  await db.close();
});

test('UNIQUE antigo em brain_chunks(item_id) é removido para permitir vários trechos por item', async () => {
  const db = await createDb({ applyMigration: false });
  await db.exec('alter table brain_chunks add constraint brain_chunks_item_unique unique (item_id)');
  await db.exec(readFileSync(MIGRATION_PATH, 'utf8'));
  const { rows } = await db.query("insert into brain_items (title) values ('x') returning id");
  await db.query("insert into brain_chunks (item_id, chunk_index, content) values ($1, 0, 'a'), ($1, 1, 'b')", [rows[0].id]);
  const count = (await db.query('select count(*)::int n from brain_chunks')).rows[0].n;
  assert.equal(count, 2);
  await db.close();
});

test('UNIQUE (item_id, chunk_index) é preservado (a gravação apaga antes de inserir)', async () => {
  const db = await createDb({ applyMigration: false });
  await db.exec('alter table brain_chunks add constraint brain_chunks_pair unique (item_id, chunk_index)');
  await db.exec(readFileSync(MIGRATION_PATH, 'utf8'));
  const { rows } = await db.query("insert into brain_items (title) values ('x') returning id");
  const id = rows[0].id;
  const chunks = JSON.stringify([{ atom_id: null, chunk_type: 'summary', chunk_index: 0, content: 'a', embedding: null }]);
  await db.query("select public.brain_replace_item_knowledge($1, '[]'::jsonb, $2::jsonb, 'ia', '{}', 'done', null)", [id, chunks]);
  await db.query("select public.brain_replace_item_knowledge($1, '[]'::jsonb, $2::jsonb, 'ia', '{}', 'done', null)", [id, chunks]);
  assert.equal((await db.query('select count(*)::int n from brain_chunks')).rows[0].n, 1);
  await db.close();
});
