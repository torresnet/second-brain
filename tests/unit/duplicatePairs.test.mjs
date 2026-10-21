import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDuplicatePair, previewText, alertTotal, pickAlertTab } from '../../src/shared/utils/duplicatePairs.js';

const row = (over = {}) => ({
  a_id: 'b-new', a_title: 'Nova', a_summary: ' resumo da nova ', a_source_url: 'https://x.com/p', a_source_type: 'youtube', a_created_at: '2026-10-20T10:00:00Z',
  b_id: 'a-old', b_title: null, b_summary: null, b_source_url: null, b_source_type: null, b_created_at: '2026-10-01T10:00:00Z',
  similarity: 0.934, reason: 'muito_parecida',
  ...over
});

test('par: a nota mais antiga vem primeiro, independente da ordem da consulta', () => {
  const pair = toDuplicatePair(row());
  assert.equal(pair.older.id, 'a-old');
  assert.equal(pair.newer.id, 'b-new');
  assert.equal(pair.newer.summary, 'resumo da nova');
});

test('par: título, tipo e link ausentes ganham valores padrão', () => {
  const { older } = toDuplicatePair(row());
  assert.deepEqual([older.title, older.type, older.url, older.summary], ['Sem título', 'note', '', '']);
});

test('par: rótulo mostra o motivo e a chave é a mesma nos dois sentidos', () => {
  assert.equal(toDuplicatePair(row()).label, '93% parecidas');
  const link = toDuplicatePair(row({ reason: 'mesmo_link', similarity: 1 }));
  assert.equal(link.label, 'Mesmo link');
  assert.equal(link.reason, 'mesmo_link');
  const swapped = toDuplicatePair(row({ a_id: 'a-old', b_id: 'b-new' }));
  assert.equal(swapped.key, link.key);
});

test('par: data inválida não quebra a ordenação', () => {
  const pair = toDuplicatePair(row({ a_created_at: 'xx' }));
  assert.equal(pair.older.id, 'b-new');
});

test('previewText: mantém textos curtos, corta longos em fim de palavra e junta espaços', () => {
  assert.equal(previewText('  um   texto\ncurto '), 'um texto curto');
  const long = 'palavra '.repeat(100);
  const out = previewText(long, 50);
  assert.ok(out.endsWith('…'));
  assert.ok(out.length <= 51);
  assert.ok(!out.slice(0, -1).endsWith('palav'));
  assert.equal(previewText(null), '');
});

test('alertTotal soma as três origens e ignora valores inválidos', () => {
  assert.equal(alertTotal({ links: 1, dups: 2, errors: 3 }), 6);
  assert.equal(alertTotal({ links: -4, dups: 'x', errors: null }), 0);
  assert.equal(alertTotal(undefined), 0);
});

test('pickAlertTab escolhe a primeira aba com pendências, senão fica na atual', () => {
  const order = ['links', 'dups', 'errors'];
  assert.equal(pickAlertTab({ links: 0, dups: 2, errors: 5 }, order, 'links'), 'dups');
  assert.equal(pickAlertTab({ links: 0, dups: 0, errors: 0 }, order, 'errors'), 'errors');
});
