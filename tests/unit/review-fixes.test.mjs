import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processItem } from '../../supabase/functions/_shared/process.ts';
import { askBrain, sanitizeAnswer, buildContext, normalizeUnderstanding } from '../../supabase/functions/_shared/ask.ts';
import { extractUrls, canonicalKey } from '../../supabase/functions/_shared/text.ts';
import { normalizeAtoms } from '../../supabase/functions/_shared/atoms.ts';

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

function store(row) {
  const calls = { replace: 0, failed: [] };
  return {
    calls,
    getItem: async () => row,
    claim: async () => true,
    replace: async a => { calls.replace++; return { atoms: a.atoms.length, chunks: a.chunks.length }; },
    markFailed: async (id, msg) => { calls.failed.push(msg); }
  };
}

const row = (over = {}) => ({
  id: 'i', title: 'T', summary: 's', source_type: 'note', source_url: null, raw_content: 'conteúdo curto',
  key_takeaways: [], entities: [], tags: [], metadata: {}, analysis_status: 'done', ...over
});

test('reprocesso parcial NÃO apaga o conhecimento anterior bom', async () => {
  const s = store(row());
  const gemini = {
    generateJson: async () => ({ atoms: [{ kind: 'ideia', name: 'X', explanation: 'y' }] }),
    embedBatch: async texts => ({ vectors: texts.map(() => null), errors: ['Gemini HTTP 503'] })
  };
  const res = await processItem('i', { store: s, gemini, safeFetch: async () => { throw new Error('x'); }, newId });
  assert.equal(res.status, 'failed');
  assert.equal(s.calls.replace, 0);
  assert.match(s.calls.failed[0], /conhecimento anterior foi mantido/);
});

test('primeira indexação parcial ainda grava o que conseguiu (nada a preservar)', async () => {
  const s = store(row({ analysis_status: 'pending' }));
  const gemini = {
    generateJson: async () => ({ atoms: [{ kind: 'ideia', name: 'X', explanation: 'y' }] }),
    embedBatch: async texts => ({ vectors: texts.map(() => null), errors: ['Gemini HTTP 503'] })
  };
  const res = await processItem('i', { store: s, gemini, safeFetch: async () => { throw new Error('x'); }, newId });
  assert.equal(res.status, 'partial');
  assert.equal(s.calls.replace, 1);
});

test('trechos recuperados do conteúdo original entram no contexto da resposta', () => {
  const hits = [{ chunk_id: 'c', item_id: 'i1', atom_id: null, chunk_type: 'content', content: 'Parágrafo exato da transcrição sobre funil', score: 1 }];
  const ctx = buildContext(hits, [], [{ id: 'i1', title: 'Vídeo', summary: 'r', source_type: 'reel', source_url: null, category: null }], null);
  assert.match(ctx.text, /Trecho do conteúdo original: Parágrafo exato da transcrição sobre funil/);
});

test('sanitizeAnswer preserva links legítimos cercados por negrito/itálico do markdown', () => {
  const allowed = ['https://x.com/a'];
  assert.equal(sanitizeAnswer('**https://x.com/a**', allowed), '**https://x.com/a**');
  assert.equal(sanitizeAnswer('_https://x.com/a_', allowed), '_https://x.com/a_');
});

test('kinds_hint em inglês é normalizado para os tipos gravados', () => {
  const u = normalizeUnderstanding({ kinds_hint: ['repository', 'Tool'] }, 'q');
  assert.deepEqual(u.kinds_hint, ['repositorio', 'ferramenta']);
});

test('arquivos .sh/.run/.app em comandos não viram links', () => {
  assert.deepEqual(extractUrls('rode chmod +x setup.sh e depois ./install.run ou abra Foo.app'), []);
  assert.deepEqual(extractUrls('acesse remotion.dev'), ['https://remotion.dev']);
});

test('átomos com a mesma URL mas conteúdo distinto não se fundem; nomes sem letras latinas não colidem', () => {
  const atoms = normalizeAtoms([
    { kind: 'repositorio', name: 'crm', url: 'https://github.com/a/crm', explanation: 'repo' },
    { kind: 'comando', name: 'clonar crm', url: 'https://github.com/a/crm', content: 'git clone https://github.com/a/crm', explanation: 'clona' },
    { kind: 'conceito', name: '😀😀', explanation: 'a' },
    { kind: 'conceito', name: 'مرحبا', explanation: 'b' }
  ], newId, ['https://github.com/a/crm']);
  assert.equal(atoms.length, 4);
  assert.notEqual(canonicalKey('conceito', '😀😀'), canonicalKey('conceito', 'مرحبا'));
});

test('kinds_hint inválido não derruba a consulta', async () => {
  const deps = {
    gemini: {
      generateJson: async p => (p.includes('interpreta perguntas')
        ? { standalone_query: 'q', intent: 'listar', keywords: ['a'], expanded_terms: [], kinds_hint: ['tool'], needs_overview: false }
        : { answer: 'ok', used_refs: [], confidence: 'media' }),
      embedBatch: async t => ({ vectors: t.map(() => new Array(768).fill(0)), errors: [] })
    },
    search: async args => { assert.ok(args.kinds === null || args.kinds[0] === 'ferramenta'); return []; },
    loadContext: async () => ({ atoms: [], items: [] }),
    overview: async () => ({})
  };
  const res = await askBrain('q', [], deps);
  assert.equal(res.answer, 'ok');
});
