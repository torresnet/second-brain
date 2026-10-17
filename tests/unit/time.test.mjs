import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRelativeBR } from '../../src/shared/utils/time.js';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('datas recentes ficam relativas', () => {
  assert.equal(formatRelativeBR(ago(20 * 1000), NOW), 'agora');
  assert.equal(formatRelativeBR(ago(5 * MIN), NOW), 'há 5 min');
  assert.equal(formatRelativeBR(ago(3 * HOUR), NOW), 'há 3 h');
  assert.equal(formatRelativeBR(ago(1 * DAY), NOW), 'ontem');
  assert.equal(formatRelativeBR(ago(4 * DAY), NOW), 'há 4 dias');
  assert.equal(formatRelativeBR(ago(14 * DAY), NOW), 'há 2 sem');
});

test('datas antigas viram dia e mês', () => {
  assert.match(formatRelativeBR('2026-03-05T12:00:00Z', NOW), /^5 de mar/);
});

test('datas de outro ano mostram o ano', () => {
  assert.match(formatRelativeBR('2024-03-05T12:00:00Z', NOW), /2024/);
});

test('data inválida ou ausente devolve vazio', () => {
  assert.equal(formatRelativeBR(null, NOW), '');
  assert.equal(formatRelativeBR('nao-e-data', NOW), '');
});
