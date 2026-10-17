import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askBrain, sanitizeAnswer, fallbackKeywords, normalizeUnderstanding, buildContext } from '../../supabase/functions/_shared/ask.ts';

const atomRow = (over = {}) => ({
  id: 'a1', item_id: 'i1', kind: 'ferramenta', name: 'Remotion', content: null,
  explanation: 'Cria vídeos com React', use_for: 'animação', url: 'https://remotion.dev', language: null,
  inferred: false, fetch_status: 'ok', fetch_error: null, contents_summary: 'Framework de vídeo', ...over
});
const itemRow = (over = {}) => ({ id: 'i1', title: 'Reel de animação', summary: 'Resumo', source_type: 'reel', source_url: 'https://instagram.com/reel/x', category: 'video', ...over });
const hit = (over = {}) => ({ chunk_id: 'c1', item_id: 'i1', atom_id: 'a1', chunk_type: 'atom', content: 'x', score: 0.03, ...over });

function setup({ understand, answer, hits = [hit()], atoms = [atomRow()], items = [itemRow()], embedError = false, overview = { total_items: 5 } } = {}) {
  const calls = { search: [], prompts: [], overview: 0, loadContext: 0 };
  const gemini = {
    generateJson: async prompt => {
      calls.prompts.push(prompt);
      const isUnderstand = prompt.includes('interpreta perguntas');
      const source = isUnderstand ? understand : answer;
      if (source instanceof Error) throw source;
      return typeof source === 'function' ? source(prompt) : source;
    },
    embedBatch: async texts => {
      if (embedError) throw new Error('quota');
      return { vectors: texts.map(() => new Array(768).fill(0.1)), errors: [] };
    }
  };
  const deps = {
    gemini,
    search: async args => { calls.search.push(args); return args.kinds ? [hit({ chunk_id: 'c2', atom_id: 'a2', item_id: 'i2' })] : hits; },
    loadContext: async () => { calls.loadContext++; return { atoms, items }; },
    overview: async () => { calls.overview++; return overview; }
  };
  return { deps, calls };
}

const understandOk = { standalone_query: 'qual o link do remotion', intent: 'procurar_link', keywords: ['remotion', 'link'], expanded_terms: ['video react'], kinds_hint: null, needs_overview: false };

test('responde pedido de link com o link real do acervo', async () => {
  const { deps, calls } = setup({ understand: understandOk, answer: { answer: '**Remotion** — cria vídeos com React: https://remotion.dev', used_refs: ['A1'], confidence: 'alta' } });
  const res = await askBrain('qual o link do remotion?', [], deps);
  assert.match(res.answer, /https:\/\/remotion\.dev/);
  assert.equal(res.confidence, 'alta');
  assert.equal(res.degraded, false);
  assert.equal(res.sources.length, 1);
  assert.deepEqual(res.sources[0].atoms.map(a => a.name), ['Remotion']);
  assert.deepEqual(calls.search[0].keywords, ['remotion', 'link', 'video react']);
  assert.ok(calls.prompts.at(-1).includes('Fonte original: https://instagram.com/reel/x'));
});

test('link inventado pela IA é removido da resposta', async () => {
  const { deps } = setup({
    understand: understandOk,
    answer: { answer: 'Use [Remotion](https://remotion.dev) ou https://site-inventado.com/x e [outro](https://falso.io).', used_refs: ['A1'], confidence: 'alta' }
  });
  const res = await askBrain('link?', [], deps);
  assert.ok(res.answer.includes('[Remotion](https://remotion.dev)'));
  assert.ok(!res.answer.includes('site-inventado'));
  assert.ok(!res.answer.includes('falso.io'));
  assert.ok(res.answer.includes('outro (link não verificado)'));
});

test('sanitizeAnswer: pontuação final, barra final e raiz de URL conhecida', () => {
  const allowed = ['https://github.com/acme/crm/tree/main', 'https://remotion.dev'];
  assert.equal(sanitizeAnswer('Veja https://remotion.dev/.', allowed), 'Veja https://remotion.dev/.');
  assert.equal(sanitizeAnswer('Repo: https://github.com/acme/crm', allowed), 'Repo: https://github.com/acme/crm');
  assert.equal(sanitizeAnswer('Outro: https://github.com/outro/repo', allowed), 'Outro: [link não verificado]');
  assert.equal(sanitizeAnswer('sem links', allowed), 'sem links');
});

test('entendimento falha: segue com palavras-chave locais e marca degradado', async () => {
  const { deps, calls } = setup({
    understand: new Error('Gemini HTTP 503'),
    answer: { answer: 'ok https://remotion.dev', used_refs: [], confidence: 'media' }
  });
  const res = await askBrain('Qual ferramenta anima vídeos com React?', [], deps);
  assert.equal(res.degraded, true);
  assert.ok(calls.search[0].keywords.includes('ferramenta'));
  assert.ok(calls.search[0].keywords.includes('react'));
  assert.ok(!calls.search[0].keywords.includes('qual'));
});

test('falha na geração da resposta: devolve lista determinística com fontes', async () => {
  const { deps } = setup({ understand: understandOk, answer: new Error('Gemini HTTP 500') });
  const res = await askBrain('remotion', [], deps);
  assert.equal(res.degraded, true);
  assert.match(res.answer, /\*\*Remotion\*\*/);
  assert.match(res.answer, /https:\/\/remotion\.dev/);
  assert.equal(res.sources.length, 1);
});

test('falha no embedding: busca só por texto e marca degradado', async () => {
  const { deps, calls } = setup({ understand: understandOk, answer: { answer: 'x', used_refs: [], confidence: 'media' }, embedError: true });
  const res = await askBrain('remotion', [], deps);
  assert.equal(calls.search[0].embedding, null);
  assert.equal(res.degraded, true);
});

test('kinds_hint dispara segunda busca e mescla sem duplicar', async () => {
  const { deps, calls } = setup({
    understand: { ...understandOk, kinds_hint: ['codigo'] },
    answer: { answer: 'x', used_refs: [], confidence: 'media' }
  });
  await askBrain('codigo', [], deps);
  assert.equal(calls.search.length, 2);
  assert.deepEqual(calls.search[1].kinds, ['codigo']);
});

test('confiança "nenhuma" não devolve fontes', async () => {
  const { deps } = setup({ understand: understandOk, answer: { answer: 'Não encontrei isso no seu Segundo Cérebro.', used_refs: [], confidence: 'nenhuma' } });
  const res = await askBrain('algo inexistente', [], deps);
  assert.deepEqual(res.sources, []);
  assert.equal(res.confidence, 'nenhuma');
});

test('sem resultados: não carrega contexto e a resposta vem da IA', async () => {
  const { deps, calls } = setup({
    hits: [], understand: understandOk,
    answer: { answer: 'Não encontrei isso no seu Segundo Cérebro.', used_refs: [], confidence: 'nenhuma' }
  });
  const res = await askBrain('x', [], deps);
  assert.equal(calls.loadContext, 0);
  assert.match(res.answer, /Não encontrei/);
});

test('panorama consulta o resumo real do acervo e o inclui no contexto', async () => {
  const { deps, calls } = setup({
    understand: { ...understandOk, intent: 'panorama', needs_overview: true },
    answer: { answer: 'Você tem 5 itens.', used_refs: [], confidence: 'alta' }
  });
  await askBrain('o que você tem aí?', [], deps);
  assert.equal(calls.overview, 1);
  assert.ok(calls.prompts.at(-1).includes('"total_items":5'));
});

test('histórico entra na interpretação (perguntas de continuação)', async () => {
  const { deps, calls } = setup({ understand: understandOk, answer: { answer: 'x', used_refs: [], confidence: 'media' } });
  await askBrain('e qual é grátis?', [{ role: 'user', content: 'ferramentas de animação' }, { role: 'assistant', content: 'Remotion e Motion Canvas' }], deps);
  assert.ok(calls.prompts[0].includes('ferramentas de animação'));
  assert.ok(calls.prompts[0].includes('e qual é grátis?'));
});

test('used_refs limita as fontes aos itens realmente usados', async () => {
  const atoms = [atomRow(), atomRow({ id: 'a2', item_id: 'i2', name: 'Outra', url: 'https://outra.dev' })];
  const items = [itemRow(), itemRow({ id: 'i2', title: 'Outra nota' })];
  const hits = [hit(), hit({ chunk_id: 'c9', atom_id: 'a2', item_id: 'i2' })];
  const { deps } = setup({ understand: understandOk, hits, atoms, items, answer: { answer: 'Remotion', used_refs: ['[A1]'], confidence: 'alta' } });
  const res = await askBrain('x', [], deps);
  assert.deepEqual(res.sources.map(s => s.item_id), ['i1']);
});

test('buildContext respeita o limite de tamanho e avisa o que omitiu', () => {
  const atoms = Array.from({ length: 60 }, (_, i) => atomRow({ id: `a${i}`, name: `Tool ${i}`, content: 'x'.repeat(5000), url: `https://t${i}.dev` }));
  const hits = atoms.map((a, i) => hit({ chunk_id: `c${i}`, atom_id: a.id }));
  const ctx = buildContext(hits, atoms, [itemRow()], null);
  assert.ok(ctx.text.length < 36000);
  assert.match(ctx.text, /omitido/);
  assert.ok(ctx.atomByRef.size < 60);
});

test('utilitários: palavras-chave locais e normalização de entendimento', () => {
  assert.deepEqual(fallbackKeywords('Quais ferramentas fazem animação dentro do Claude?'), ['ferramentas', 'animacao', 'claude']);
  const u = normalizeUnderstanding({ keywords: 'não é lista', intent: 5, kinds_hint: [] }, 'minha pergunta sobre crm');
  assert.equal(u.standalone_query, 'minha pergunta sobre crm');
  assert.ok(u.keywords.includes('crm'));
  assert.equal(u.kinds_hint, null);
  assert.equal(u.needs_overview, false);
});

test('sanitizeAnswer também barra domínios sem https:// que não estão no acervo', () => {
  const allowed = ['https://remotion.dev'];
  assert.equal(sanitizeAnswer('Acesse remotion.dev ou evil.com/login agora', allowed), 'Acesse remotion.dev ou [link não verificado] agora');
});

test('links só valem se vierem de url/fonte/código — não de resumos de páginas externas', async () => {
  const atoms = [atomRow({ contents_summary: 'Veja também https://plantado.evil.com/x', explanation: 'texto https://plantado2.evil.com' })];
  const { deps } = setup({
    understand: understandOk, atoms,
    answer: { answer: 'Use https://plantado.evil.com/x e https://remotion.dev', used_refs: ['A1'], confidence: 'alta' }
  });
  const res = await askBrain('x', [], deps);
  assert.ok(!res.answer.includes('plantado'));
  assert.ok(res.answer.includes('https://remotion.dev'));
});
