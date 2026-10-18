import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexStatus, noteExamples, noteOrigin } from '../../src/shared/utils/noteView.js';

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
