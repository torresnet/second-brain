import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processItem } from '../../supabase/functions/_shared/process.ts';
import { buildEntry, categoryOf, redactSecrets } from '../../supabase/functions/_shared/errorlog.ts';
import {
  buildErrorEntry,
  classifyCategory,
  classifyStage,
  redactSecrets as redactClient
} from '../../src/shared/utils/errorLog.js';

// ---------- cliente ----------

test('cliente: classifica a categoria pelo texto do erro', () => {
  assert.equal(classifyCategory('Pipeline indisponível (HTTP 429).'), 'quota');
  assert.equal(classifyCategory('Falha no Gemini: Resource_Exhausted'), 'quota');
  assert.equal(classifyCategory('Sessão expirada. Entre novamente.'), 'auth');
  assert.equal(classifyCategory('O processamento demorou demais e foi cancelado.'), 'timeout');
  assert.equal(classifyCategory('Failed to fetch'), 'network');
  assert.equal(classifyCategory('Pipeline indisponível (HTTP 502).'), 'http');
  assert.equal(classifyCategory('Formato não suportado para análise (application/zip).'), 'unsupported');
  assert.equal(classifyCategory('O conteúdo do link não estava acessível à IA.'), 'unreadable');
  assert.equal(classifyCategory('algo estranho'), 'unknown');
});

test('cliente: deduz a etapa pelo aviso do pipeline', () => {
  assert.equal(classifyStage('Não foi possível baixar a mídia (login exigido).'), 'media_fetch');
  assert.equal(classifyStage('Falha no Gemini: 500'), 'ai');
  assert.equal(classifyStage('Falha ao gerar 2 vetor(es) de busca'), 'embedding');
  assert.equal(classifyStage('Pipeline indisponível (HTTP 502).'), 'pipeline');
});

test('cliente: remove tokens, query strings e chaves antes de gravar', () => {
  const dirty = 'GET https://api.exemplo.com/v1/x?key=ABC123&q=1 Authorization: Bearer abc.def-ghi token=segredo eyJhbGciOi.eyJzdWIiOiIx.assinatura';
  const clean = redactClient(dirty);
  for (const secret of ['ABC123', 'abc.def-ghi', 'segredo', 'eyJhbGciOi']) assert.ok(!clean.includes(secret), `${secret} vazou: ${clean}`);
  assert.ok(clean.includes('https://api.exemplo.com/v1/x'));
});

test('cliente: buildErrorEntry limita tamanho, higieniza o detalhe e guarda a causa', () => {
  const error = new Error('Não foi possível processar a gravação de áudio.', { cause: new Error('EncodingError: decodeAudioData') });
  const entry = buildErrorEntry({
    error, sourceType: 'voice', itemId: 'abc',
    detail: { url: 'https://youtu.be/x?si=privado', seconds: 12 }
  });
  assert.equal(entry.stage, 'pipeline');
  assert.equal(entry.severity, 'error');
  assert.equal(entry.source_type, 'voice');
  assert.equal(entry.item_id, 'abc');
  assert.equal(entry.detail.causa, 'EncodingError: decodeAudioData');
  assert.equal(entry.detail.url, 'https://youtu.be/x');

  const long = buildErrorEntry({ message: 'x'.repeat(5000), detail: { blob: 'y'.repeat(9000) } });
  assert.equal(long.message.length, 500);
  assert.equal(long.detail.truncado, true);

  assert.equal(buildErrorEntry({ error: null }).message, 'Falha sem detalhes.');
});

// ---------- Edge Function ----------

test('servidor: categoryOf e redactSecrets', () => {
  assert.equal(categoryOf(Object.assign(new Error('x'), { status: 429 })), 'quota');
  assert.equal(categoryOf(Object.assign(new Error('x'), { status: 403 })), 'auth');
  assert.equal(categoryOf(new Error('request timed out')), 'timeout');
  assert.equal(categoryOf(new Error('getaddrinfo ENOTFOUND host')), 'network');
  assert.equal(categoryOf(Object.assign(new Error('x'), { status: 502 })), 'http');
  assert.equal(categoryOf(new Error('boom')), 'unknown');
  assert.ok(!redactSecrets('https://generativelanguage.googleapis.com/v1/m?key=SEGREDO').includes('SEGREDO'));
  const entry = buildEntry({ stage: 'ai', category: 'unknown', severity: 'error', message: 'falhou em https://x.io/a?key=SEGREDO', detail: { u: 'https://x.io/b?token=Z' } });
  assert.ok(!JSON.stringify(entry).includes('SEGREDO'));
  assert.ok(!JSON.stringify(entry).includes('token=Z'));
});

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

const row = (overrides = {}) => ({
  id: 'item-1', title: 'Reel de teste', summary: 'Resumo', source_type: 'reel',
  source_url: 'https://instagram.com/reel/abc', raw_content: 'Fala sobre o Remotion em remotion.dev.',
  key_takeaways: [], entities: [], tags: ['video'], metadata: {}, ...overrides
});

function store(item, { logFails = false } = {}) {
  const logged = [];
  return {
    logged,
    getItem: async () => item,
    claim: async () => true,
    replace: async args => ({ atoms: args.atoms.length, chunks: args.chunks.length }),
    saveExamples: async () => {},
    markFailed: async () => {},
    markDeferred: async () => {},
    logEvent: async (id, entry) => {
      if (logFails) throw new Error('banco fora do ar');
      logged.push({ id, ...entry });
    }
  };
}

function gemini({ atomizeError, embedErrors = [] } = {}) {
  return {
    generateJson: async prompt => {
      if (prompt.includes('descreve o conteúdo de links') || prompt.includes('LEMBRAR e USAR')) return { pages: [], examples: [] };
      if (atomizeError) throw atomizeError;
      return { category: 'video', use_cases: [], atoms: [{ kind: 'ferramenta', name: 'Remotion', explanation: 'x', url: 'https://remotion.dev', questions: ['q'] }] };
    },
    embedBatch: async texts => ({ vectors: texts.map(() => (embedErrors.length ? null : new Array(768).fill(0.1))), errors: embedErrors })
  };
}

const okFetch = async url => ({ url, status: 200, contentType: 'text/html', body: '<p>' + 'texto '.repeat(80) + '</p>', truncated: false });
const run = (st, g, safeFetch = okFetch) => processItem('item-1', { store: st, gemini: g, safeFetch, newId });

test('log: falha total da IA registra erro na etapa "ai" ligado à nota, sem segredos', async () => {
  const st = store(row());
  const err = new Error('Gemini HTTP 500 em https://generativelanguage.googleapis.com/v1/models/x?key=SEGREDO');
  const result = await run(st, gemini({ atomizeError: err }));
  assert.equal(result.status, 'failed');
  assert.equal(st.logged.length, 1);
  const [entry] = st.logged;
  assert.equal(entry.id, 'item-1');
  assert.equal(entry.stage, 'ai');
  assert.equal(entry.severity, 'error');
  assert.equal(entry.detail.source_type, 'reel');
  assert.ok(!JSON.stringify(entry).includes('SEGREDO'));
});

test('log: cota esgotada vira aviso de categoria "quota" (a nota segue pendente)', async () => {
  const st = store(row());
  const result = await run(st, gemini({ atomizeError: Object.assign(new Error('cota'), { status: 429 }) }));
  assert.equal(result.status, 'quota');
  assert.equal(st.logged.length, 1);
  assert.equal(st.logged[0].category, 'quota');
  assert.equal(st.logged[0].severity, 'warning');
});

test('log: captura ilegível registra categoria "unreadable" sem chamar a IA', async () => {
  const st = store(row({ tags: ['conteudo-inacessivel'] }));
  const result = await run(st, gemini({ atomizeError: new Error('não deveria chamar') }));
  assert.equal(result.status, 'failed');
  assert.equal(st.logged.length, 1);
  assert.equal(st.logged[0].category, 'unreadable');
});

test('log: falha de embeddings e link inacessível viram avisos, e o item segue como parcial', async () => {
  const st = store(row());
  const blocked = async () => { throw new Error('bloqueado'); };
  const result = await run(st, gemini({ embedErrors: ['HTTP 500'] }), blocked);
  assert.equal(result.status, 'partial');
  const stages = st.logged.map(l => l.stage).sort();
  assert.deepEqual(stages, ['crawl', 'embedding']);
  assert.ok(st.logged.every(l => l.severity === 'warning'));
});

test('log: sucesso limpo não registra nada', async () => {
  const st = store(row());
  const result = await run(st, gemini());
  assert.equal(result.status, 'done');
  assert.deepEqual(st.logged, []);
});

test('log: falha ao gravar o log nunca derruba o processamento', async () => {
  const st = store(row(), { logFails: true });
  const result = await run(st, gemini({ atomizeError: new Error('Gemini HTTP 500') }));
  assert.equal(result.status, 'failed');
});
