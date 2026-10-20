import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drainPending } from '../../supabase/functions/_shared/worker.ts';

function setup(ids, statuses = {}, { stepMs = 10_000 } = {}) {
  let clock = 0;
  const processed = [];
  return {
    processed,
    deps: {
      now: () => clock,
      startBudgetMs: 70_000,
      maxItems: 5,
      listPending: async (exclude) => ids.filter((id) => !exclude.includes(id)).slice(0, 1),
      processOne: async (id) => {
        processed.push(id);
        clock += stepMs;
        return { status: statuses[id] ?? 'done' };
      }
    }
  };
}

test('processa pendentes em sequência sem repetir o mesmo item', async () => {
  const { deps, processed } = setup(['a', 'b', 'c']);
  const summary = await drainPending(deps);
  assert.deepEqual(processed, ['a', 'b', 'c']);
  assert.equal(summary.processed, 3);
});

test('para de iniciar itens quando o orçamento de tempo acaba', async () => {
  const { deps, processed } = setup(['a', 'b', 'c', 'd'], {}, { stepMs: 40_000 });
  await drainPending(deps);
  assert.deepEqual(processed, ['a', 'b']);
});

test('respeita o máximo de itens por execução', async () => {
  const { deps, processed } = setup(['1', '2', '3', '4', '5', '6', '7']);
  await drainPending({ ...deps, maxItems: 2 });
  assert.equal(processed.length, 2);
});

test('interrompe ao atingir a cota da IA', async () => {
  const { deps, processed } = setup(['a', 'b', 'c'], { b: 'quota' });
  const summary = await drainPending(deps);
  assert.deepEqual(processed, ['a', 'b']);
  assert.equal(summary.quotaHit, true);
  assert.equal(summary.processed, 1);
});

test('item ocupado ou falho não trava a fila', async () => {
  const { deps } = setup(['a', 'b', 'c'], { a: 'busy', b: 'failed' });
  const summary = await drainPending(deps);
  assert.deepEqual({ p: summary.processed, b: summary.busy, f: summary.failed }, { p: 1, b: 1, f: 1 });
});

test('fila vazia termina sem processar nada', async () => {
  const { deps } = setup([]);
  assert.equal((await drainPending(deps)).attempted, 0);
});
