import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexStatus, noteExamples, noteOrigin, unifiedInfo } from '../../src/shared/utils/noteView.js';

test('origem: link original encurtado, sem protocolo e sem www', () => {
  assert.deepEqual(noteOrigin({ source_url: 'https://www.instagram.com/p/abc/' }), { href: 'https://www.instagram.com/p/abc/', text: 'instagram.com/p/abc' });
});

test('origem: sem link mostra o arquivo enviado ou o tipo da nota', () => {
  assert.deepEqual(noteOrigin({ source_url: null, metadata: { extracted_from_file: 'aula.pdf' } }), { href: null, text: 'Arquivo enviado: aula.pdf' });
  assert.equal(noteOrigin({ source_type: 'audio' }).text, 'Gravação de voz');
  assert.equal(noteOrigin({ source_type: 'note' }).text, 'Anotação de texto');
  assert.equal(noteOrigin({ source_url: 'javascript:alert(1)' }).href, null);
  assert.equal(noteOrigin({}).text, 'Sem link de origem');
});

test('indexação: falha mostra o motivo amigável e oferece indexar de novo', () => {
  const s = indexStatus({ analysis_status: 'failed', analysis_error: 'Análise por IA falhou na parte 1/1: O Gemini demorou demais para responder.' });
  assert.equal(s.tone, 'danger');
  assert.equal(s.label, 'Falha na indexação');
  assert.equal(s.action, 'Indexar novamente');
  assert.equal(s.reason, 'O processamento demorou demais. Tente novamente.');
});

test('indexação: falha sem detalhe tem motivo padrão; pendente oferece indexar agora', () => {
  assert.equal(indexStatus({ analysis_status: 'failed' }).reason, 'Não foi possível indexar esta nota.');
  const pending = indexStatus({ analysis_status: 'pending' });
  assert.equal(pending.action, 'Indexar agora');
  assert.equal(pending.tone, 'warn');
  assert.equal(indexStatus({ analysis_status: 'pending', analysis_error: 'HTTP 429' }).reason, 'A IA atingiu o limite de uso por agora. Tente novamente mais tarde.');
});

test('indexação: nota indexada não mostra motivo; nota sem status não mostra nada', () => {
  assert.deepEqual(indexStatus({ analysis_status: 'done', analysis_error: 'antigo' }), { tone: 'ok', label: 'Indexada', action: 'Reprocessar', reason: '' });
  assert.equal(indexStatus({}), null);
  assert.equal(indexStatus({ analysis_status: 'desconhecido' }), null);
});

test('exemplos: no máximo 5, e "próximas ações" antigas só aparecem quando não há exemplos', () => {
  const ex = (n) => ({ title: `E${n}`, scenario: '', how: 'como', uses: [] });
  assert.equal(noteExamples({ practical_examples: [1, 2, 3, 4, 5, 6, 7].map(ex), action_items: ['a'] }).length, 5);
  assert.deepEqual(noteExamples({ practical_examples: [ex(1)], action_items: ['a'] }).map(e => e.title), ['E1']);
  assert.deepEqual(
    noteExamples({ practical_examples: [], action_items: ['a1', '', 'a2', 'a3', 'a4', 'a5', 'a6'] }).map(e => e.title),
    ['a1', 'a2', 'a3', 'a4', 'a5']
  );
  assert.deepEqual(noteExamples({}), []);
});

const mergedSource = { title: 'Segunda nota', url: 'https://www.b.com/y/', created_at: '2026-10-02T10:00:00Z' };

test('selo de unificação: nota nunca mesclada não tem selo', () => {
  assert.equal(unifiedInfo({ metadata: {} }), null);
  assert.equal(unifiedInfo({ metadata: { merged_sources: [] } }), null);
  assert.equal(unifiedInfo({}), null);
});

test('selo de unificação: nota unificada lista as duas fontes com os dois links', () => {
  const info = unifiedInfo({
    source_url: 'https://a.com/x',
    metadata: { merged_sources: [mergedSource], unified_base: { title: 'Primeira nota', url: 'https://a.com/x', created_at: '2026-10-01T10:00:00Z' } }
  });
  assert.equal(info.label, 'Unificada');
  assert.equal(info.count, 2);
  assert.equal(info.pending, false);
  assert.deepEqual(info.sources.map(s => [s.title, s.href, s.text]), [
    ['Primeira nota', 'https://a.com/x', 'a.com/x'],
    ['Segunda nota', 'https://www.b.com/y/', 'b.com/y']
  ]);
  assert.equal(info.sources[1].date, '2026-10-02T10:00:00Z');
});

test('selo de unificação: enquanto a IA não terminou o selo avisa que está na fila', () => {
  const info = unifiedInfo({
    metadata: {
      merged_sources: [mergedSource],
      pending_unify: { base: { title: 'Primeira nota', url: 'https://a.com/x' }, sources: [mergedSource] }
    }
  });
  assert.equal(info.label, 'Unificação na fila');
  assert.equal(info.pending, true);
  assert.equal(info.sources[0].title, 'Primeira nota');
});

test('selo de unificação: link inseguro ou ausente não vira href', () => {
  const info = unifiedInfo({ metadata: { merged_sources: [{ title: 'X', url: 'javascript:alert(1)' }, { url: null }] }, source_url: null });
  assert.deepEqual(info.sources.map(s => s.href), [null, null, null]);
  assert.equal(info.sources[2].title, 'Sem título');
  assert.equal(info.count, 3);
});

test('noteOriginLinks lista repositórios e sites, sem repetir o link principal nem aceitar esquemas perigosos', async () => {
  const { noteOriginLinks } = await import('../../src/shared/utils/noteView.js');
  const links = noteOriginLinks({
    source_url: 'https://site.com/a',
    metadata: { origin_links: [
      { url: 'https://github.com/dono/repo', kind: 'repo', label: 'dono/repo' },
      { url: 'https://site.com/a/', kind: 'site' },
      { url: 'javascript:alert(1)', kind: 'site' },
      'https://exemplo.dev'
    ] }
  });
  assert.deepEqual(links.map(l => [l.kind, l.href]), [['repo', 'https://github.com/dono/repo'], ['site', 'https://exemplo.dev']]);
});
