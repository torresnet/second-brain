import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickForReview, createOpenedTracker } from '../../src/shared/utils/review.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-17T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data
  };
}

test('ignora itens salvos há menos de 7 dias', () => {
  const items = [{ id: 'a', created_at: daysAgo(3) }];
  assert.deepEqual(pickForReview(items, {}, NOW), []);
});

test('ignora itens abertos recentemente', () => {
  const items = [{ id: 'a', created_at: daysAgo(40) }];
  assert.deepEqual(pickForReview(items, { a: NOW - 5 * DAY }, NOW), []);
});

test('volta a sugerir item aberto há muito tempo', () => {
  const items = [{ id: 'a', created_at: daysAgo(90) }];
  const [pick] = pickForReview(items, { a: NOW - 30 * DAY }, NOW);
  assert.equal(pick.item.id, 'a');
  assert.equal(pick.reason, 'Aberto pela última vez há 30 dias');
});

test('favoritos vêm antes, depois os nunca abertos', () => {
  const items = [
    { id: 'antigo-aberto', created_at: daysAgo(200) },
    { id: 'nunca-aberto', created_at: daysAgo(20) },
    { id: 'favorito', created_at: daysAgo(10), is_favorite: true }
  ];
  const opened = { 'antigo-aberto': NOW - 60 * DAY };
  const ids = pickForReview(items, opened, NOW).map((p) => p.item.id);
  assert.deepEqual(ids, ['favorito', 'nunca-aberto', 'antigo-aberto']);
});

test('limita a quantidade e explica o motivo', () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, created_at: daysAgo(10 + i) }));
  const picks = pickForReview(items, {}, NOW, { limit: 3 });
  assert.equal(picks.length, 3);
  assert.equal(picks[0].reason, 'Salvo há 15 dias e nunca aberto');
});

test('tracker guarda quando cada nota foi aberta', () => {
  const storage = memoryStorage();
  const tracker = createOpenedTracker(storage, () => NOW);
  tracker.markOpened('a');
  assert.deepEqual(tracker.getAll(), { a: NOW });
  const reloaded = createOpenedTracker(storage, () => NOW);
  assert.deepEqual(reloaded.getAll(), { a: NOW });
});

test('tracker sobrevive a armazenamento corrompido ou indisponível', () => {
  const broken = memoryStorage({ 'sb:opened': '{nao-e-json' });
  assert.deepEqual(createOpenedTracker(broken, () => NOW).getAll(), {});

  const throwing = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } };
  const tracker = createOpenedTracker(throwing, () => NOW);
  assert.doesNotThrow(() => tracker.markOpened('a'));
  assert.deepEqual(tracker.getAll(), { a: NOW });
});
