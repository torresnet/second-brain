import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processItem } from '../../supabase/functions/_shared/process.ts';

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

function item(overrides = {}) {
  return {
    id: 'item-1', title: 'Vídeo sobre animação', summary: 'Resumo', source_type: 'reel',
    source_url: 'https://instagram.com/reel/abc', raw_content: 'Fala sobre o Remotion e o Motion Canvas.',
    key_takeaways: [], entities: [], tags: ['video'], metadata: {}, ...overrides
  };
}

function fakeStore(row, { claim = true, replaceError = null } = {}) {
  const calls = { replace: [], failed: [], examples: [] };
  return {
    calls,
    getItem: async () => row,
    claim: async () => claim,
    replace: async args => {
      if (replaceError) throw new Error(replaceError);
      calls.replace.push(args);
      return { atoms: args.atoms.length, chunks: args.chunks.length };
    },
    saveExamples: async (id, examples) => { calls.examples.push({ id, examples }); },
    markFailed: async (id, msg) => { calls.failed.push({ id, msg }); }
  };
}

function fakeGemini({ atomize, linkSummary, examples, embedErrors = [], failAtomize = false } = {}) {
  const calls = { prompts: [], embedTexts: [] };
  return {
    calls,
    generateJson: async prompt => {
      calls.prompts.push(prompt);
      if (prompt.includes('descreve o conteúdo de links')) {
        if (linkSummary instanceof Error) throw linkSummary;
        return linkSummary ?? { pages: [] };
      }
      if (prompt.includes('LEMBRAR e USAR')) {
        if (examples instanceof Error) throw examples;
        return examples ?? { examples: [] };
      }
      if (failAtomize) throw new Error('Gemini HTTP 429: cota');
      return typeof atomize === 'function' ? atomize(prompt) : atomize;
    },
    embedBatch: async texts => {
      calls.embedTexts.push(...texts);
      return {
        vectors: texts.map((_, i) => (embedErrors.length ? null : new Array(768).fill(i / 1000))),
        errors: embedErrors
      };
    }
  };
}

const html = '<html><head><title>Remotion</title></head><body><p>' + 'Crie vídeos com React de forma programática. '.repeat(10) + '</p></body></html>';
const okFetch = async url => ({ url, status: 200, contentType: 'text/html', body: html, truncated: false });

const baseAtomize = {
  category: 'Vídeo',
  use_cases: ['criar vídeos animados'],
  atoms: [
    { kind: 'Tool', name: 'Remotion', explanation: 'Cria vídeos com React', use_for: 'animação', url: 'https://remotion.dev', questions: ['Qual ferramenta cria vídeos com React?'], tags: ['video'] },
    { kind: 'ferramenta', name: 'Motion Canvas', explanation: 'Animações vetoriais', url: null, questions: ['q'] }
  ]
};

test('fluxo completo: átomos, varredura, resumo do link, trechos com vetor e gravação única', async () => {
  const store = fakeStore(item({ raw_content: 'Use o Remotion em remotion.dev e o Motion Canvas.' }));
  const gemini = fakeGemini({
    atomize: baseAtomize,
    linkSummary: { pages: [{ n: 1, summary: 'Framework para criar vídeos com React.', name: 'Remotion', kind: 'ferramenta' }] }
  });
  const result = await processItem('item-1', { store, gemini, safeFetch: okFetch, newId });

  assert.equal(result.status, 'done');
  assert.deepEqual(result.links, { ok: 1, inaccessible: 0, skipped: 0 });
  assert.equal(store.calls.replace.length, 1);
  const saved = store.calls.replace[0];
  assert.equal(saved.category, 'video');
  assert.deepEqual(saved.useCases, ['criar vídeos animados']);

  const remotion = saved.atoms.find(a => a.name === 'Remotion');
  assert.equal(remotion.kind, 'ferramenta');
  assert.equal(remotion.url, 'https://remotion.dev');
  assert.equal(remotion.inferred, false);
  assert.equal(remotion.fetch_status, 'ok');
  assert.equal(remotion.contents_summary, 'Framework para criar vídeos com React.');
  assert.ok(remotion.fetched_content.includes('Crie vídeos com React'));

  const motion = saved.atoms.find(a => a.name === 'Motion Canvas');
  assert.equal(motion.url, null);

  assert.ok(saved.chunks.every(c => c.embedding && c.embedding.length === 768));
  const atomChunks = saved.chunks.filter(c => c.chunk_type === 'atom');
  assert.equal(atomChunks.length, saved.atoms.length);
  assert.deepEqual(new Set(atomChunks.map(c => c.atom_id)), new Set(saved.atoms.map(a => a.id)));
  assert.deepEqual(saved.chunks.map(c => c.chunk_index), saved.chunks.map((_, i) => i));
  assert.ok(atomChunks.some(c => c.content.includes('O que tem no link: Framework')));
  assert.ok(atomChunks.some(c => c.content.includes('Perguntas que responde')));
});

test('cobertura: link e código que a IA esqueceu viram átomos automaticamente', async () => {
  const raw = 'Veja https://github.com/acme/crm e rode:\n```bash\nnpm install acme-crm\n```\nFim.';
  const store = fakeStore(item({ raw_content: raw }));
  const gemini = fakeGemini({ atomize: { category: 'dev', use_cases: [], atoms: [] } });
  const safeFetch = async () => { throw new Error('rede indisponível'); };
  const result = await processItem('item-1', { store, gemini, safeFetch, newId });

  const saved = store.calls.replace[0];
  const link = saved.atoms.find(a => a.url === 'https://github.com/acme/crm');
  const code = saved.atoms.find(a => a.kind === 'codigo');
  assert.ok(link, 'link ausente');
  assert.equal(link.fetch_status, 'inaccessible');
  assert.match(link.fetch_error, /rede indisponível/);
  assert.equal(code.content, 'npm install acme-crm');
  assert.equal(code.language, 'bash');
  assert.equal(result.status, 'done');
  assert.ok(result.warnings.some(w => w.includes('completado')));
});

test('URL que a IA inventou (fora do texto) é marcada como inferida', async () => {
  const store = fakeStore(item({ raw_content: 'Fala do Remotion sem citar o site.' }));
  const gemini = fakeGemini({ atomize: baseAtomize });
  await processItem('item-1', { store, gemini, safeFetch: okFetch, newId });
  const remotion = store.calls.replace[0].atoms.find(a => a.name === 'Remotion');
  assert.equal(remotion.inferred, true);
});

test('falha total da IA: marca como falho e NÃO apaga o conhecimento anterior', async () => {
  const store = fakeStore(item());
  const gemini = fakeGemini({ failAtomize: true });
  const result = await processItem('item-1', { store, gemini, safeFetch: okFetch, newId });
  assert.equal(result.status, 'failed');
  assert.equal(store.calls.replace.length, 0);
  assert.equal(store.calls.failed.length, 1);
  assert.match(store.calls.failed[0].msg, /429/);
});

test('falha nos embeddings: salva como partial, trechos continuam pesquisáveis por texto', async () => {
  const store = fakeStore(item());
  const gemini = fakeGemini({ atomize: baseAtomize, embedErrors: ['Gemini HTTP 503'] });
  const result = await processItem('item-1', { store, gemini, safeFetch: okFetch, newId });
  assert.equal(result.status, 'partial');
  const saved = store.calls.replace[0];
  assert.equal(saved.status, 'partial');
  assert.ok(saved.chunks.length > 0 && saved.chunks.every(c => c.embedding === null));
  assert.match(saved.error, /vetor/);
});

test('item ocupado ou inexistente não é processado', async () => {
  const gemini = fakeGemini({ atomize: baseAtomize });
  const busy = await processItem('item-1', { store: fakeStore(item(), { claim: false }), gemini, safeFetch: okFetch, newId });
  assert.equal(busy.status, 'busy');
  const missing = await processItem('x', { store: fakeStore(null), gemini, safeFetch: okFetch, newId });
  assert.equal(missing.status, 'not_found');
  assert.equal(gemini.calls.prompts.length, 0);
});

test('textos longos são analisados em várias janelas e os átomos são unidos sem duplicar', async () => {
  const long = 'Parágrafo sobre automação e ferramentas. '.repeat(2000);
  const store = fakeStore(item({ raw_content: long }));
  let call = 0;
  const gemini = fakeGemini({
    atomize: () => {
      call++;
      return { category: 'ia', use_cases: [`uso ${call}`], atoms: [
        { kind: 'ferramenta', name: 'n8n', explanation: `parte ${call}`, url: null, questions: [`pergunta ${call}`] },
        { kind: 'ferramenta', name: `Única ${call}`, explanation: 'x' }
      ] };
    }
  });
  const result = await processItem('item-1', { store, gemini, safeFetch: okFetch, newId });
  assert.ok(call >= 2);
  const names = store.calls.replace[0].atoms.map(a => a.name);
  assert.equal(names.filter(n => n === 'n8n').length, 1);
  assert.ok(names.includes('Única 1') && names.includes('Única 2'));
  assert.equal(result.status, 'done');
  assert.ok(store.calls.replace[0].chunks.filter(c => c.chunk_type === 'content').length > 10);
});

test('uma janela com erro vira partial, sem perder as outras', async () => {
  const long = 'Texto longo sobre vendas e funil. '.repeat(2500);
  const store = fakeStore(item({ raw_content: long }));
  let call = 0;
  const gemini = fakeGemini({
    atomize: () => {
      call++;
      if (call === 1) throw new Error('Gemini HTTP 500');
      return { category: 'vendas', use_cases: [], atoms: [{ kind: 'conceito', name: `Conceito ${call}`, explanation: 'ok' }] };
    }
  });
  const result = await processItem('item-1', { store, gemini, safeFetch: okFetch, newId });
  assert.equal(result.status, 'partial');
  assert.ok(store.calls.replace[0].atoms.length >= 1);
});

test('links: sociais são pulados, privados ficam inacessíveis com motivo, limite de 5 varreduras', async () => {
  const atoms = Array.from({ length: 8 }, (_, i) => ({
    kind: 'ferramenta', name: `Tool${i}`, explanation: 'x', url: `https://site${i}.com/`
  }));
  atoms.push({ kind: 'link', name: 'Insta', explanation: 'x', url: 'https://instagram.com/p/xyz' });
  const raw = atoms.map(a => a.url).join(' ');
  const store = fakeStore(item({ raw_content: raw }));
  const fetched = [];
  const safeFetch = async url => {
    fetched.push(url);
    if (url.includes('site1')) return { url, status: 404, contentType: 'text/html', body: '', truncated: false };
    return okFetch(url);
  };
  const result = await processItem('item-1', { store, gemini: fakeGemini({ atomize: { atoms } }), safeFetch, newId });
  const saved = store.calls.replace[0].atoms;
  assert.ok(fetched.length <= 5);
  assert.ok(saved.filter(a => a.fetch_status).length <= 5);
  const social = saved.find(a => a.name === 'Insta');
  assert.ok(!social.fetch_status || social.fetch_status === 'skipped');
  const total = result.links.ok + result.links.inaccessible + result.links.skipped;
  assert.equal(total, saved.filter(a => a.fetch_status).length);
});

test('bloqueio SSRF vira "inacessível" sem derrubar o processamento', async () => {
  const store = fakeStore(item({ raw_content: 'Veja https://interno.exemplo.com/admin' }));
  const gemini = fakeGemini({ atomize: { atoms: [{ kind: 'link', name: 'Admin', explanation: 'x', url: 'https://interno.exemplo.com/admin' }] } });
  const safeFetch = async () => { throw new Error('Endereço interno bloqueado'); };
  const result = await processItem('item-1', { store, gemini, safeFetch, newId });
  assert.equal(result.status, 'done');
  const atom = store.calls.replace[0].atoms.find(a => a.name === 'Admin');
  assert.equal(atom.fetch_status, 'inaccessible');
  assert.match(atom.fetch_error, /interno/);
});

test('erro ao gravar marca o item como falho', async () => {
  const store = fakeStore(item(), { replaceError: 'item_nao_encontrado' });
  const result = await processItem('item-1', { store, gemini: fakeGemini({ atomize: baseAtomize }), safeFetch: okFetch, newId });
  assert.equal(result.status, 'failed');
  assert.equal(store.calls.failed.length, 1);
});

test('lixo vindo da IA (formatos inesperados) não quebra', async () => {
  const store = fakeStore(item());
  const gemini = fakeGemini({ atomize: { category: 123, use_cases: 'x', atoms: [null, 5, 'texto', { name: '' }, { kind: 'x' }, { name: 'Ok', explanation: 7, questions: 'não é lista', url: 'javascript:alert(1)' }] } });
  const result = await processItem('item-1', { store, gemini, safeFetch: okFetch, newId });
  assert.equal(result.status, 'done');
  const atoms = store.calls.replace[0].atoms;
  const ok = atoms.find(a => a.name === 'Ok');
  assert.equal(ok.url, null);
  assert.deepEqual(ok.questions, []);
});

test('nota só com resumo (sem raw_content) ainda gera trecho de resumo', async () => {
  const store = fakeStore(item({ raw_content: null, summary: 'Ideia: usar n8n para SDR no WhatsApp.' }));
  const gemini = fakeGemini({ atomize: { category: 'automacao', atoms: [{ kind: 'ideia', name: 'SDR no WhatsApp com n8n', explanation: 'Automatizar atendimento' }] } });
  const result = await processItem('item-1', { store, gemini, safeFetch: okFetch, newId });
  assert.equal(result.status, 'done');
  const chunks = store.calls.replace[0].chunks;
  assert.ok(chunks.some(c => c.chunk_type === 'summary' && c.content.includes('SDR')));
});

test('texto muito longo: todos os trechos entram na busca por texto, vetores só por amostragem', async () => {
  const long = Array.from({ length: 3000 }, (_, i) => `Frase número ${i} sobre vendas e automação de atendimento.`).join(' ');
  const store = fakeStore(item({ raw_content: long }));
  const gemini = fakeGemini({ atomize: baseAtomize });
  const result = await processItem('item-1', { store, gemini, safeFetch: okFetch, newId });
  assert.equal(result.status, 'done');
  const chunks = store.calls.replace[0].chunks;
  const content = chunks.filter(c => c.chunk_type === 'content');
  assert.ok(content.length > 80);
  const embeddedContent = content.filter(c => c.embedding);
  assert.ok(embeddedContent.length <= 41 && embeddedContent.length >= 20);
  assert.ok(chunks.filter(c => c.chunk_type !== 'content').every(c => c.embedding));
  assert.deepEqual(chunks.map(c => c.chunk_index), chunks.map((_, i) => i));
  assert.equal(gemini.calls.embedTexts.length, chunks.filter(c => c.embedding).length);
});

test('exemplos práticos: até 5, normalizados, enviados à gravação e pesquisáveis', async () => {
  const store = fakeStore(item({ raw_content: 'Use o Remotion em remotion.dev e o Motion Canvas.' }));
  const many = Array.from({ length: 7 }, (_, i) => ({ title: `Exemplo ${i}`, scenario: 'cenário', how: `Use o Remotion no passo ${i}.`, uses: ['Remotion'] }));
  const gemini = fakeGemini({ atomize: baseAtomize, examples: { examples: [...many, { title: '', how: 'sem título' }, null] } });
  const result = await processItem('item-1', { store, gemini, safeFetch: okFetch, newId });

  assert.equal(result.status, 'done');
  const saved = store.calls.replace[0];
  const savedExamples = store.calls.examples[0].examples;
  assert.equal(savedExamples.length, 5);
  assert.equal(savedExamples[0].title, 'Exemplo 0');
  assert.deepEqual(savedExamples[0].uses, ['Remotion']);
  const summary = saved.chunks.find(c => c.chunk_type === 'summary');
  assert.match(summary.content, /Como aplicar na prática: Exemplo 0/);
});

test('exemplos práticos: menos de 5 (ou nenhum) é válido', async () => {
  const store = fakeStore(item());
  const gemini = fakeGemini({ atomize: baseAtomize, examples: { examples: [{ title: 'Só um', how: 'Faça assim.' }] } });
  await processItem('item-1', { store, gemini, safeFetch: okFetch, newId });
  assert.equal(store.calls.examples[0].examples.length, 1);

  const empty = fakeStore(item());
  await processItem('item-1', { store: empty, gemini: fakeGemini({ atomize: baseAtomize }), safeFetch: okFetch, newId });
  assert.deepEqual(empty.calls.examples[0].examples, []);
});

test('exemplos práticos: falha da IA vira aviso, não impede salvar e preserva os anteriores (null)', async () => {
  const store = fakeStore(item());
  const gemini = fakeGemini({ atomize: baseAtomize, examples: new Error('Gemini HTTP 503') });
  const result = await processItem('item-1', { store, gemini, safeFetch: okFetch, newId });
  assert.equal(result.status, 'done');
  assert.equal(store.calls.examples.length, 0);
  assert.ok(result.warnings.some(w => w.includes('exemplos práticos')));
});

test('exemplos práticos: resposta fora do formato é ignorada sem derrubar o processamento', async () => {
  const store = fakeStore(item());
  const gemini = fakeGemini({ atomize: baseAtomize, examples: { examples: 'texto solto' } });
  const result = await processItem('item-1', { store, gemini, safeFetch: okFetch, newId });
  assert.equal(result.status, 'done');
  assert.equal(store.calls.examples.length, 0);
});

test('nota rápida: a IA gera título (se não digitado), resumo e pontos-chave e limpa a pendência', async () => {
  const store = fakeStore(item({
    title: 'Preciso lembrar de', source_type: 'note', source_url: null, summary: 'Preciso lembrar de',
    raw_content: 'Preciso lembrar de renovar o domínio até sexta e cobrar o cliente da proposta.',
    key_takeaways: ['Preciso lembrar de renovar'], metadata: { pending_headline: { title: true }, outro: 1 }
  }));
  store.calls.headline = [];
  store.saveHeadline = async (id, patch) => { store.calls.headline.push({ id, patch }); };
  const gemini = fakeGemini({
    atomize: { ...baseAtomize, title: 'Renovar domínio e cobrar proposta.', summary: 'Duas tarefas pendentes.', key_takeaways: ['Renovar o domínio até sexta', ' ', 'Cobrar o cliente da proposta'] }
  });

  await processItem('item-1', { store, gemini, safeFetch: okFetch, newId });

  const atomizeCalls = gemini.calls.prompts.filter(p => p.includes('indexador de um Segundo Cérebro'));
  assert.equal(atomizeCalls.length, 1);
  assert.match(atomizeCalls[0], /CABEÇALHO DA NOTA/);
  assert.equal(gemini.calls.prompts.length, 3, 'análise (com cabeçalho) + resumo do link + exemplos, sem chamada extra para o título');
  assert.equal(store.calls.headline.length, 1);
  const { patch } = store.calls.headline[0];
  assert.equal(patch.title, 'Renovar domínio e cobrar proposta');
  assert.deepEqual(patch.keyTakeaways, ['Renovar o domínio até sexta', 'Cobrar o cliente da proposta']);
  assert.deepEqual(patch.metadata, { outro: 1 });
});

test('nota rápida com título digitado: mantém o título e só gera pontos-chave', async () => {
  const store = fakeStore(item({ source_type: 'note', metadata: { pending_headline: { title: false } } }));
  store.calls.headline = [];
  store.saveHeadline = async (id, patch) => { store.calls.headline.push(patch); };
  const gemini = fakeGemini({ atomize: { ...baseAtomize, title: 'Outro título', summary: 'Resumo novo.', key_takeaways: ['Ponto A'] } });

  await processItem('item-1', { store, gemini, safeFetch: okFetch, newId });

  assert.doesNotMatch(gemini.calls.prompts[0], /"title": "\.\.\."/);

  assert.equal(store.calls.headline[0].title, null);
  assert.deepEqual(store.calls.headline[0].keyTakeaways, ['Ponto A']);
});

test('nota rápida: se a IA falhar no título, a pendência continua e a indexação segue', async () => {
  const store = fakeStore(item({ source_type: 'note', metadata: { pending_headline: { title: true } } }));
  store.calls.headline = [];
  store.saveHeadline = async (id, patch) => { store.calls.headline.push(patch); };
  const gemini = fakeGemini({ atomize: { ...baseAtomize, title: '', key_takeaways: [] } });

  const result = await processItem('item-1', { store, gemini, safeFetch: okFetch, newId });

  assert.equal(store.calls.headline.length, 0);
  assert.equal(store.calls.replace.length, 1);
  assert.ok(result.warnings.some(w => w.includes('título e pontos-chave')));
});

test('IA sobrecarregada (5xx) em todas as partes: nota volta para pendente, não para falha', async () => {
  const store = fakeStore(item());
  store.calls.deferred = [];
  store.markDeferred = async (id, msg) => { store.calls.deferred.push({ id, msg }); };
  const gemini = fakeGemini({ atomize: () => { throw Object.assign(new Error('x'), { status: 503 }); } });

  const result = await processItem('item-1', { store, gemini, safeFetch: okFetch, newId });

  assert.equal(result.status, 'quota');
  assert.equal(store.calls.failed.length, 0);
  assert.equal(store.calls.deferred.length, 1);
  assert.match(store.calls.deferred[0].msg, /sobrecarregada/);
});
