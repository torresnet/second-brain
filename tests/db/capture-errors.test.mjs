import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRlsDb, asUser, CAPTURE_ERRORS_MIGRATION_PATH } from '../helpers/db.mjs';

const OWNER = '11111111-1111-1111-1111-111111111111';
const ITEM = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function setup() {
  const db = await createRlsDb({ ownerId: OWNER });
  await db.query(`insert into public.brain_items (id, title) values ($1, 'Reel')`, [ITEM]);
  return db;
}

test('capture_errors: o dono registra, lista, resolve e apaga falhas', async () => {
  const db = await setup();
  await asUser(db, 'authenticated', OWNER, async () => {
    await db.query(
      `insert into public.capture_errors (stage, category, severity, source_type, item_id, message, detail)
       values ('media_fetch', 'unreadable', 'error', 'reel', $1, 'Não foi possível baixar a mídia', '{"url":"https://instagram.com/reel/x"}')`,
      [ITEM]);
    await db.query(`insert into public.capture_errors (message, severity) values ('aviso solto', 'warning')`);

    const open = await db.query(`select message, stage, category from public.capture_errors where resolved_at is null order by created_at, message`);
    assert.equal(open.rows.length, 2);
    assert.equal(open.rows.find(r => r.message === 'aviso solto').stage, 'pipeline');
    assert.equal(open.rows.find(r => r.message === 'aviso solto').category, 'unknown');

    await db.query(`update public.capture_errors set resolved_at = now() where severity = 'error'`);
    assert.equal(Number((await db.query(`select count(*)::int n from public.capture_errors where resolved_at is null`)).rows[0].n), 1);

    await db.query(`delete from public.capture_errors where resolved_at is not null`);
    assert.equal(Number((await db.query(`select count(*)::int n from public.capture_errors`)).rows[0].n), 1);
  });
});

test('capture_errors: valores fora do domínio e mensagens gigantes são recusados', async () => {
  const db = await setup();
  await asUser(db, 'authenticated', OWNER, async () => {
    await assert.rejects(db.query(`insert into public.capture_errors (message, stage) values ('x', 'inexistente')`), /capture_errors_stage/);
    await assert.rejects(db.query(`insert into public.capture_errors (message, category) values ('x', 'inexistente')`), /capture_errors_category/);
    await assert.rejects(db.query(`insert into public.capture_errors (message, severity) values ('x', 'fatal')`), /capture_errors_severity/);
    await assert.rejects(db.query(`insert into public.capture_errors (message) values ($1)`, ['x'.repeat(1001)]), /capture_errors_message_len/);
  });
});

test('capture_errors: apagar a nota mantém a falha no histórico (item_id vira nulo)', async () => {
  const db = await setup();
  await db.query(`insert into public.capture_errors (item_id, message) values ($1, 'falha')`, [ITEM]);
  await db.query(`delete from public.brain_items where id = $1`, [ITEM]);
  const { rows } = await db.query(`select item_id from public.capture_errors`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].item_id, null);
});

test('capture_errors: a migration é idempotente', async () => {
  const db = await setup();
  const sql = readFileSync(CAPTURE_ERRORS_MIGRATION_PATH, 'utf8');
  await db.exec(sql);
  await db.exec(sql);
});
