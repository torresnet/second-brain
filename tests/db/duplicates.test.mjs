import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDb, unitVector, blend, MIGRATION_PATH, DUPLICATES_MIGRATION_PATH } from '../helpers/db.mjs';

let db;
before(async () => { db = await createDb(); });
after(async () => { await db.close(); });
beforeEach(async () => { await db.exec('truncate public.brain_items cascade'); });

const key = async (u) => (await db.query('select public.brain_url_key($1) k', [u])).rows[0].k;

async function item(title, { url = null, vec = null, raw = null, tags = [], entities = [], favorite = false } = {}) {
  const { rows } = await db.query(
    'insert into brain_items (title, source_url, raw_content, tags, entities, is_favorite) values ($1,$2,$3,$4,$5::jsonb,$6) returning id',
    [title, url, raw, `{${tags.join(',')}}`, JSON.stringify(entities), favorite]
  );
  const id = rows[0].id;
  if (vec) {
    await db.query(
      "insert into brain_chunks (item_id, chunk_type, chunk_index, content, embedding) values ($1, 'summary', 0, $2, $3::vector)",
      [id, title, `[${vec.join(',')}]`]
    );
  }
  return id;
}

const possible = async (id, min = 0.9) =>
  (await db.query('select * from public.brain_possible_duplicates($1, $2)', [id, min])).rows;

test('brain_url_key ignora esquema, www, fragmento, barra final, rastreadores e maiúsculas', async () => {
  const same = [
    'https://www.Exemplo.com/Pagina/?utm_source=x&utm_medium=y',
    'http://exemplo.com/pagina',
    'exemplo.com/pagina/#topo',
    'https://exemplo.com/pagina?fbclid=abc'
  ];
  const keys = await Promise.all(same.map(key));
  assert.equal(new Set(keys).size, 1, JSON.stringify(keys));
  assert.equal(keys[0], 'exemplo.com/pagina');
});

test('brain_url_key mantém parâmetros que identificam o conteúdo e ordena os demais', async () => {
  assert.equal(await key('https://site.com/p?b=2&a=1'), 'site.com/p?a=1&b=2');
  assert.notEqual(await key('https://site.com/p?id=1'), await key('https://site.com/p?id=2'));
});

test('brain_url_key trata YouTube (youtu.be = watch?v=) e Instagram (igsh)', async () => {
  assert.equal(await key('https://youtu.be/abc123?si=zzz'), await key('https://www.youtube.com/watch?v=abc123&feature=share'));
  assert.equal(await key('https://m.youtube.com/watch?v=abc123'), await key('https://youtube.com/watch?v=abc123'));
  assert.equal(await key('https://www.instagram.com/reel/XYZ/?igsh=aaa'), await key('https://instagram.com/reel/XYZ'));
  assert.notEqual(await key('https://youtu.be/abc123'), await key('https://youtu.be/outro'));
});

test('brain_url_key devolve null para vazio/nulo', async () => {
  assert.equal(await key(''), null);
  assert.equal(await key(null), null);
  assert.equal(await key('   '), null);
});

test('source_key é preenchida por trigger na criação e na troca do link, e nos itens antigos', async () => {
  const id = await item('A', { url: 'https://www.exemplo.com/x/?utm_source=a' });
  assert.equal((await db.query('select source_key from brain_items where id=$1', [id])).rows[0].source_key, 'exemplo.com/x');
  await db.query("update brain_items set source_url = 'https://outro.com/y' where id = $1", [id]);
  assert.equal((await db.query('select source_key from brain_items where id=$1', [id])).rows[0].source_key, 'outro.com/y');

  const old = await createDb({ applyMigration: false });
  await old.exec(readFileSync(MIGRATION_PATH, 'utf8'));
  await old.query("insert into brain_items (title, source_url) values ('velho', 'https://www.velho.com/a/')");
  await old.exec(readFileSync(DUPLICATES_MIGRATION_PATH, 'utf8'));
  assert.equal((await old.query('select source_key from brain_items')).rows[0].source_key, 'velho.com/a');
  await old.close();
});

test('migração de duplicatas é idempotente', async () => {
  await db.exec(readFileSync(DUPLICATES_MIGRATION_PATH, 'utf8'));
});

test('brain_find_duplicates_by_url acha o mesmo link escrito de outro jeito e nada para link novo', async () => {
  const id = await item('Aula', { url: 'https://www.youtube.com/watch?v=abc' });
  const found = (await db.query('select * from public.brain_find_duplicates_by_url($1)', ['https://youtu.be/abc?si=1'])).rows;
  assert.deepEqual(found.map(r => r.id), [id]);
  assert.equal((await db.query('select * from public.brain_find_duplicates_by_url($1)', ['https://youtu.be/outro'])).rows.length, 0);
  assert.equal((await db.query('select * from public.brain_find_duplicates_by_url($1)', [''])).rows.length, 0);
});

test('possível duplicata: mesmo link vira "mesmo_link" com similaridade 1, mesmo sem vetores', async () => {
  const a = await item('A', { url: 'https://exemplo.com/p' });
  const b = await item('B', { url: 'https://www.exemplo.com/p/?utm_source=z' });
  const rows = await possible(b);
  assert.deepEqual(rows.map(r => [r.id, r.reason, r.similarity]), [[a, 'mesmo_link', 1]]);
});

test('possível duplicata: vetores quase iguais acusam "muito_parecida"; assunto apenas relacionado não', async () => {
  const base = unitVector(3);
  const a = await item('A', { vec: base });
  const b = await item('B', { vec: blend(base, unitVector(4), 0.97) });
  await item('C', { vec: blend(base, unitVector(5), 0.6) });
  const rows = await possible(a, 0.9);
  assert.deepEqual(rows.map(r => r.id), [b]);
  assert.equal(rows[0].reason, 'muito_parecida');
  assert.ok(rows[0].similarity > 0.9);
  assert.deepEqual((await possible(b, 0.9)).map(r => r.id), [a]);
});

test('"manter as duas" é lembrado nos dois sentidos e não duplica o registro', async () => {
  const a = await item('A', { url: 'https://x.com/p' });
  const b = await item('B', { url: 'https://x.com/p' });
  await db.query('select public.brain_set_duplicate_decision($1,$2)', [b, a]);
  await db.query('select public.brain_set_duplicate_decision($1,$2)', [a, b]);
  assert.equal((await db.query('select count(*)::int n from brain_duplicate_decisions')).rows[0].n, 1);
  assert.deepEqual(await possible(a), []);
  assert.deepEqual(await possible(b), []);
});

test('decisão com par inválido é recusada', async () => {
  const a = await item('A');
  await assert.rejects(db.query('select public.brain_set_duplicate_decision($1,$1)', [a]), /par_invalido/);
});

test('apagar uma nota remove também as decisões ligadas a ela', async () => {
  const a = await item('A');
  const b = await item('B');
  await db.query('select public.brain_set_duplicate_decision($1,$2)', [a, b]);
  await db.query('delete from brain_items where id=$1', [a]);
  assert.equal((await db.query('select count(*)::int n from brain_duplicate_decisions')).rows[0].n, 0);
});

test('mesclar: junta conteúdo, tags, entidades e favorito; registra a origem; marca para reindexar; apaga a outra', async () => {
  const keep = await item('Original', { url: 'https://x.com/a', raw: 'texto A', tags: ['ia', 'video'], entities: ['n8n'] });
  const remove = await item('Repetida', { url: 'https://x.com/b', raw: 'texto B diferente', tags: ['video', 'crm'], entities: ['n8n', 'Supabase'], favorite: true });
  await db.query("select public.brain_replace_item_knowledge($1, '[]', '[]', 'ia', '{}', 'done', null)", [keep]);

  const result = (await db.query('select public.brain_merge_items($1,$2) id', [keep, remove])).rows[0].id;
  assert.equal(result, keep);
  const k = (await db.query('select * from brain_items where id=$1', [keep])).rows[0];
  assert.match(k.raw_content, /texto A/);
  assert.match(k.raw_content, /Mesclado da nota "Repetida" \(https:\/\/x\.com\/b\)/);
  assert.match(k.raw_content, /texto B diferente/);
  assert.deepEqual([...k.tags].sort(), ['crm', 'ia', 'video']);
  assert.deepEqual(k.entities.sort(), ['Supabase', 'n8n']);
  assert.equal(k.is_favorite, true);
  assert.equal(k.analysis_status, 'pending');
  assert.equal(k.metadata.merged_sources[0].title, 'Repetida');
  assert.equal((await db.query('select count(*)::int n from brain_items where id=$1', [remove])).rows[0].n, 0);
});

test('mesclar conteúdo idêntico não duplica o texto', async () => {
  const keep = await item('A', { raw: 'mesmo texto' });
  const remove = await item('B', { raw: 'mesmo texto' });
  await db.query('select public.brain_merge_items($1,$2)', [keep, remove]);
  assert.equal((await db.query('select raw_content from brain_items where id=$1', [keep])).rows[0].raw_content, 'mesmo texto');
});

test('mesclar apaga o conhecimento extraído da nota removida e recusa pares inválidos', async () => {
  const keep = await item('A', { raw: 'a' });
  const remove = await item('B', { raw: 'b' });
  await db.query(
    "select public.brain_replace_item_knowledge($1, $2::jsonb, '[]', 'ia', '{}', 'done', null)",
    [remove, JSON.stringify([{ id: crypto.randomUUID(), kind: 'ferramenta', name: 'X', explanation: 'y' }])]
  );
  await db.query('select public.brain_merge_items($1,$2)', [keep, remove]);
  assert.equal((await db.query('select count(*)::int n from brain_atoms')).rows[0].n, 0);
  await assert.rejects(db.query('select public.brain_merge_items($1,$1)', [keep]), /par_invalido/);
  await assert.rejects(db.query('select public.brain_merge_items($1,$2)', [keep, crypto.randomUUID()]), /item_nao_encontrado/);
});
