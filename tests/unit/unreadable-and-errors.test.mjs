import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUnreadableCapture } from '../../supabase/functions/_shared/text.ts';
import { createGemini, describeGeminiHttpError } from '../../supabase/functions/_shared/gemini.ts';
import { processItem } from '../../supabase/functions/_shared/process.ts';
import { askBrain } from '../../supabase/functions/_shared/ask.ts';

test('isUnreadableCapture reconhece as marcas de captura sem conteúdo', () => {
  assert.equal(isUnreadableCapture(['youtube', 'conteudo-inacessivel', 'inbox']), true);
  assert.equal(isUnreadableCapture(['instagram', 'erro-extracao']), true);
  assert.equal(isUnreadableCapture(['motion-design']), false);
  assert.equal(isUnreadableCapture(null), false);
  assert.equal(isUnreadableCapture(undefined), false);
});

test('describeGeminiHttpError: cota e sobrecarga viram texto curto, sem URL nem detalhe do provedor', () => {
  const quota = describeGeminiHttpError(429, 'You exceeded your current quota. See https://ai.google.dev/gemini-api/docs/rate-limits Please retry in 3h40m');
  assert.match(quota, /limite de uso/i);
  assert.doesNotMatch(quota, /https?:|ai\.google|retry/i);
  assert.match(describeGeminiHttpError(503, 'overloaded'), /sobrecarregada/i);
  assert.doesNotMatch(describeGeminiHttpError(400, 'API key not valid https://x.y'), /https?:/);
});

test('createGemini devolve a mensagem amigável no erro 429 e preserva o status', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: { message: 'Quota exceeded https://ai.dev/rate-limit' } }), { status: 429 });
  const gemini = createGemini({ apiKey: 'k', model: 'm', embeddingModel: 'e', fetchImpl, sleep: async () => {} });
  await assert.rejects(
    () => gemini.generateJson('oi', { attempts: 1 }),
    err => err.status === 429 && /limite de uso/i.test(err.message) && !/https?:/.test(err.message)
  );
});

test('createGemini troca para a chave reserva quando a principal estoura a cota', async () => {
  const used = [];
  const fetchImpl = async (_url, init) => {
    const key = init.headers['x-goog-api-key'];
    used.push(key);
    if (key === 'k1') return new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 });
  };
  const gemini = createGemini({ apiKey: 'k1', fallbackApiKey: 'k2', model: 'm', embeddingModel: 'e', fetchImpl, sleep: async () => {} });
  assert.deepEqual(await gemini.generateJson('oi', { attempts: 1 }), { ok: true });
  await gemini.generateJson('oi', { attempts: 1 });
  assert.deepEqual(used, ['k1', 'k2', 'k2']);
});

test('createGemini sem reserva continua falhando no 429', async () => {
  const fetchImpl = async () => new Response('{}', { status: 429 });
  const gemini = createGemini({ apiKey: 'k1', model: 'm', embeddingModel: 'e', fetchImpl, sleep: async () => {} });
  await assert.rejects(() => gemini.generateJson('oi', { attempts: 1 }), err => err.status === 429);
});

function store(row) {
  const calls = { failed: [], deferred: [], replace: [] };
  return {
    calls,
    getItem: async () => row,
    claim: async () => true,
    replace: async args => { calls.replace.push(args); return { atoms: 0, chunks: 0 }; },
    saveExamples: async () => {},
    markFailed: async (id, msg) => { calls.failed.push({ id, msg }); },
    markDeferred: async (id, msg) => { calls.deferred.push({ id, msg }); }
  };
}

test('captura ilegível não chama a IA e termina como falha explicando o motivo', async () => {
  const row = {
    id: 'i1', title: 'Conteúdo Inacessível - Vídeo do YouTube', summary: 'Não foi possível carregar', source_type: 'article',
    source_url: 'https://www.youtube.com/watch?v=x', raw_content: 'rodapé', key_takeaways: [], entities: [],
    tags: ['conteudo-inacessivel', 'youtube', 'erro-extracao'], metadata: {}
  };
  const s = store(row);
  let aiCalls = 0;
  const gemini = { generateJson: async () => { aiCalls++; return {}; }, embedBatch: async () => { aiCalls++; return { vectors: [], errors: [] }; } };
  const result = await processItem('i1', { store: s, gemini, safeFetch: async () => ({}), newId: () => 'id' });
  assert.equal(result.status, 'failed');
  assert.equal(aiCalls, 0);
  assert.equal(s.calls.replace.length, 0);
  assert.equal(s.calls.failed.length, 1);
  assert.match(s.calls.failed[0].msg, /não pôde ser lido/i);
  assert.match(result.warnings[0], /capture o link novamente/i);
});

test('cota da IA esgotada (429) deixa a nota pendente em vez de falha definitiva', async () => {
  const row = {
    id: 'i2', title: 'Guia', summary: 's', source_type: 'article', source_url: 'https://example.com',
    raw_content: 'texto do artigo', key_takeaways: [], entities: [], tags: ['inbox'], metadata: {}
  };
  const s = store(row);
  const quota = Object.assign(new Error('A IA atingiu o limite de uso por agora.'), { status: 429 });
  const gemini = { generateJson: async () => { throw quota; }, embedBatch: async () => ({ vectors: [], errors: [] }) };
  const result = await processItem('i2', { store: s, gemini, safeFetch: async () => ({}), newId: () => 'id' });
  assert.equal(result.status, 'quota');
  assert.equal(s.calls.failed.length, 0);
  assert.equal(s.calls.deferred.length, 1);
  assert.equal(s.calls.replace.length, 0);
});

test('Perguntar ignora notas ilegíveis ao montar a resposta reduzida', async () => {
  const good = { id: 'i-good', title: 'Guia de motion design', summary: 's', source_type: 'pdf', source_url: null, category: null, tags: ['motion-design'] };
  const bad = { id: 'i-bad', title: 'Conteúdo Inacessível - Vídeo do YouTube', summary: 's', source_type: 'article', source_url: 'https://www.youtube.com/watch?v=x', category: null, tags: ['conteudo-inacessivel'] };
  const atom = (over) => ({
    id: 'a', item_id: 'i', kind: 'ferramenta', name: 'X', content: null, explanation: null, use_for: null, url: null, language: null,
    inferred: false, fetch_status: null, fetch_error: null, contents_summary: null, ...over
  });
  const atoms = [atom({ id: 'a-bad', item_id: 'i-bad', name: 'YouTube' }), atom({ id: 'a-good', item_id: 'i-good', name: 'Remotion' })];
  const deps = {
    gemini: { generateJson: async () => { throw new Error('fora do ar'); }, embedBatch: async () => ({ vectors: [null], errors: ['x'] }) },
    search: async () => [
      { chunk_id: 'c1', item_id: 'i-bad', atom_id: 'a-bad', chunk_type: 'atom', content: 'YouTube', score: 0.9 },
      { chunk_id: 'c2', item_id: 'i-good', atom_id: 'a-good', chunk_type: 'atom', content: 'Remotion', score: 0.5 }
    ],
    loadContext: async () => ({ atoms, items: [bad, good] }),
    overview: async () => ({})
  };
  const result = await askBrain('quais ferramentas de vídeo eu salvei', [], deps);
  assert.equal(result.degraded, true);
  assert.match(result.answer, /Remotion/);
  assert.doesNotMatch(result.answer, /YouTube/);
  assert.deepEqual(result.sources.map(s => s.item_id), ['i-good']);
});
