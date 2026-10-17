import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterItemsLocally } from '../../src/shared/utils/search.js';

const items = [
  { id: '1', title: 'Webhook do WhatsApp no n8n', summary: 'API oficial da Meta', tags: ['automação'] },
  { id: '2', title: 'Busca híbrida com pgvector', summary: 'Postgres e full-text', tags: ['supabase'] },
  { id: '3', title: 'Ganchos para Reels', summary: null, tags: null }
];

test('encontra por palavras no título, resumo e tags, ignorando acentos e caixa', () => {
  assert.deepEqual(filterItemsLocally(items, 'HIBRIDA').map(i => i.id), ['2']);
  assert.deepEqual(filterItemsLocally(items, 'meta webhook').map(i => i.id), ['1']);
  assert.deepEqual(filterItemsLocally(items, 'automacao').map(i => i.id), ['1']);
});

test('todas as palavras precisam aparecer', () => {
  assert.deepEqual(filterItemsLocally(items, 'reels supabase'), []);
});

test('texto vazio não devolve nada', () => {
  assert.deepEqual(filterItemsLocally(items, '  '), []);
});

test('títulos que casam vêm antes dos que casam só no resumo', () => {
  const list = [
    { id: 'a', title: 'Outro assunto', summary: 'fala de n8n' },
    { id: 'b', title: 'Curso de n8n', summary: '' }
  ];
  assert.deepEqual(filterItemsLocally(list, 'n8n').map(i => i.id), ['b', 'a']);
});
