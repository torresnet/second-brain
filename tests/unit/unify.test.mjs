import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNIFY_MAX_CHARS, parseUnified, pendingUnify, unifyTotalChars } from '../../supabase/functions/_shared/unify.ts';
import { buildUnifyPrompt } from '../../supabase/functions/_shared/prompts.ts';

const note = (title, url, raw) => ({ title, url, summary: null, raw_content: raw });
const request = (baseRaw, sourceRaw, urls = ['https://a.com/x', 'https://b.com/y']) => ({
  base: note('Nota A', urls[0], baseRaw),
  sources: [note('Nota B', urls[1], sourceRaw)]
});
const good = (content) => ({ title: 'Título novo.', summary: 'Resumo.', key_takeaways: ['Ponto 1', ' ', 'Ponto 2'], content });
const LONG = 'conteúdo '.repeat(40);

test('pendingUnify lê o pedido do metadata e ignora metadata sem pedido ou incompleto', () => {
  const meta = { pending_unify: { base: note('A', null, 'a'), sources: [note('B', null, 'b'), null, 'lixo'] } };
  assert.equal(pendingUnify(meta).sources.length, 1);
  assert.equal(pendingUnify({}), null);
  assert.equal(pendingUnify(null), null);
  assert.equal(pendingUnify({ pending_unify: { base: note('A', null, 'a'), sources: [] } }), null);
  assert.equal(pendingUnify({ pending_unify: 'x' }), null);
});

test('parseUnified normaliza título, resumo e pontos-chave e aceita o texto unificado', () => {
  const r = request(LONG, LONG);
  const parsed = parseUnified(good(`${LONG}\nhttps://a.com/x https://b.com/y`), r);
  assert.equal(parsed.title, 'Título novo');
  assert.deepEqual(parsed.keyTakeaways, ['Ponto 1', 'Ponto 2']);
  assert.equal(parsed.content.startsWith('conteúdo'), true);
  assert.deepEqual(parsed.restoredLinks, []);
});

test('parseUnified recusa resposta sem título, resumo ou pontos-chave', () => {
  const r = request(LONG, LONG);
  assert.equal(parseUnified({ ...good(LONG), title: '  ' }, r), null);
  assert.equal(parseUnified({ ...good(LONG), summary: '' }, r), null);
  assert.equal(parseUnified({ ...good(LONG), key_takeaways: [] }, r), null);
  assert.equal(parseUnified('texto solto', r), null);
  assert.equal(parseUnified(null, r), null);
});

test('parseUnified: texto bem menor que a maior nota é descartado (nada some por encurtar)', () => {
  const r = request(LONG, 'curto');
  const parsed = parseUnified(good('resumo curtinho'), r);
  assert.equal(parsed.content, null);
  assert.equal(parsed.title, 'Título novo');
});

test('parseUnified: links das notas originais que a IA tirou são anexados ao final', () => {
  const r = request(`${LONG} veja https://c.com/z`, LONG);
  const parsed = parseUnified(good(`${LONG} https://a.com/x`), r);
  assert.deepEqual(parsed.restoredLinks.sort(), ['https://b.com/y', 'https://c.com/z']);
  assert.match(parsed.content, /Links das notas originais:\n- https:\/\/(b\.com\/y|c\.com\/z)/);
  assert.ok(parsed.content.includes('https://b.com/y') && parsed.content.includes('https://c.com/z'));
});

test('parseUnified sem texto (notas grandes) só devolve o cabeçalho', () => {
  const parsed = parseUnified(good(undefined), request(LONG, LONG), { withContent: false });
  assert.equal(parsed.content, null);
  assert.equal(parsed.summary, 'Resumo.');
});

test('buildUnifyPrompt traz todas as notas, os links e pede o texto só quando cabe', () => {
  const r = request('texto da base', 'texto da outra');
  const full = buildUnifyPrompt([r.base, ...r.sources], true);
  assert.match(full, /NOTA 1 \(a mais antiga, é a base\)/);
  assert.match(full, /https:\/\/a\.com\/x/);
  assert.match(full, /https:\/\/b\.com\/y/);
  assert.match(full, /texto da outra/);
  assert.match(full, /"content": "\.\.\."/);

  const header = buildUnifyPrompt([r.base, ...r.sources], false);
  assert.doesNotMatch(header, /"content"/);
});

test('unifyTotalChars soma o texto de todas as notas', () => {
  assert.equal(unifyTotalChars(request('aaaa', 'bb')), 6);
  assert.ok(UNIFY_MAX_CHARS > 10_000);
});
