import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCaptureQueue } from '../../src/shared/services/captureQueue.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data
  };
}

function setup(overrides = {}) {
  const calls = { execute: [], saved: 0 };
  const queue = createCaptureQueue({
    execute: async (spec) => {
      calls.execute.push(spec);
      return { message: 'ok', warning: false };
    },
    findDuplicates: async () => [],
    storage: memoryStorage(),
    onItemSaved: () => { calls.saved++; },
    ...overrides
  });
  return { queue, calls };
}

const link = (url = 'https://a.com/x') => ({ kind: 'link', label: url, url, hint: '' });

test('enqueue devolve na hora e processa em segundo plano', async () => {
  const { queue, calls } = setup();
  const job = queue.enqueue(link());
  assert.equal(queue.getSnapshot().jobs[0].status, 'processing');
  await job.done;
  assert.equal(queue.getSnapshot().jobs[0].status, 'done');
  assert.equal(calls.execute.length, 1);
  assert.equal(calls.saved, 1);
  assert.equal(queue.hasActive(), false);
});

test('aviso do pipeline vira status warning e ainda atualiza o acervo', async () => {
  const { queue, calls } = setup({ execute: async () => ({ message: 'sem análise', warning: true }) });
  await queue.enqueue(link()).done;
  assert.equal(queue.getSnapshot().jobs[0].status, 'warning');
  assert.equal(calls.saved, 1);
});

test('falha vira status error com a mensagem e não atualiza o acervo', async () => {
  const { queue, calls } = setup({ execute: async () => { throw new Error('rede caiu'); } });
  await queue.enqueue(link()).done;
  const [job] = queue.getSnapshot().jobs;
  assert.equal(job.status, 'error');
  assert.equal(job.message, 'rede caiu');
  assert.equal(calls.saved, 0);
});

test('link repetido não é salvo: vira alerta aguardando decisão', async () => {
  const existing = [{ id: 'n1', title: 'Nota antiga', created_at: '2026-01-02T00:00:00Z' }];
  const { queue, calls } = setup({ findDuplicates: async () => existing });
  await queue.enqueue(link()).done;
  const snap = queue.getSnapshot();
  assert.equal(calls.execute.length, 0);
  assert.equal(snap.jobs[0].status, 'attention');
  assert.equal(snap.alerts.length, 1);
  assert.equal(snap.alerts[0].existing.id, 'n1');
  assert.equal(snap.alerts[0].url, 'https://a.com/x');
});

test('decisão "reprocessar" salva o link mesmo repetido e remove o alerta', async () => {
  const { queue, calls } = setup({ findDuplicates: async () => [{ id: 'n1', title: 't', created_at: 'x' }] });
  await queue.enqueue(link()).done;
  const [alert] = queue.getSnapshot().alerts;

  await queue.resolveAlert(alert.id, 'reprocess').done;

  assert.equal(calls.execute.length, 1);
  assert.equal(calls.execute[0].url, 'https://a.com/x');
  assert.equal(queue.getSnapshot().alerts.length, 0);
  assert.equal(calls.saved, 1);
});

test('decisão "ignorar" descarta o alerta sem salvar', async () => {
  const { queue, calls } = setup({ findDuplicates: async () => [{ id: 'n1', title: 't', created_at: 'x' }] });
  await queue.enqueue(link()).done;
  const [alert] = queue.getSnapshot().alerts;

  assert.equal(queue.resolveAlert(alert.id, 'ignore'), null);

  assert.equal(calls.execute.length, 0);
  assert.equal(queue.getSnapshot().alerts.length, 0);
});

test('o mesmo link enviado duas vezes seguidas só é processado uma vez', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const executed = [];
  const { queue } = setup({
    execute: async (spec) => { executed.push(spec); await gate; return { message: 'ok', warning: false }; }
  });

  const first = queue.enqueue(link());
  const second = queue.enqueue(link('https://a.com/x'));
  release();
  await Promise.all([first.done, second.done]);

  assert.equal(executed.length, 1);
  assert.equal(queue.getSnapshot().jobs.find((j) => j.id === second.id).status, 'skipped');
});

test('consulta de duplicata que falha não impede a captura', async () => {
  const { queue, calls } = setup({ findDuplicates: async () => { throw new Error('offline'); } });
  await queue.enqueue(link()).done;
  assert.equal(calls.execute.length, 1);
});

test('alertas sobrevivem a recarregar a página', async () => {
  const storage = memoryStorage();
  const dup = [{ id: 'n1', title: 'Antiga', created_at: '2026-01-02T00:00:00Z' }];
  const first = setup({ storage, findDuplicates: async () => dup });
  await first.queue.enqueue({ kind: 'link', label: 'x', url: 'https://a.com/x', hint: 'dica' }).done;

  const reloaded = setup({ storage });
  const [alert] = reloaded.queue.getSnapshot().alerts;
  assert.equal(alert.url, 'https://a.com/x');
  assert.equal(alert.hint, 'dica');
  assert.equal(alert.existing.title, 'Antiga');
});

test('storage corrompido é ignorado', () => {
  const { queue } = setup({ storage: memoryStorage({ 'sb.capture.alerts': '{lixo' }) });
  assert.deepEqual(queue.getSnapshot().alerts, []);
});

test('dismissJob remove o aviso da lista e subscribe é notificado', async () => {
  const { queue } = setup();
  const seen = [];
  const unsubscribe = queue.subscribe((snap) => seen.push(snap.jobs.length));
  const job = queue.enqueue(link());
  await job.done;
  queue.dismissJob(job.id);
  unsubscribe();
  queue.enqueue(link('https://b.com'));
  assert.equal(queue.getSnapshot().jobs.at(-1).status, 'processing');
  assert.ok(seen.includes(1));
  assert.equal(seen.at(-1), 0);
});

test('tarefa avulsa (run) roda em segundo plano, avisa o resultado e atualiza o acervo', async () => {
  const { queue, calls } = setup();
  await queue.enqueue({ kind: 'task', label: 'Reprocessando', run: async () => ({ message: 'Nota reprocessada.', warning: false }) }).done;
  const [job] = queue.getSnapshot().jobs;
  assert.equal(job.status, 'done');
  assert.equal(job.message, 'Nota reprocessada.');
  assert.equal(calls.execute.length, 0);
  assert.equal(calls.saved, 1);
});

test('tarefa avulsa que falha vira erro visível', async () => {
  const { queue } = setup();
  await queue.enqueue({ kind: 'task', label: 'Reprocessando', run: async () => { throw new Error('IA indisponível'); } }).done;
  const [job] = queue.getSnapshot().jobs;
  assert.equal(job.status, 'error');
  assert.equal(job.message, 'IA indisponível');
});
