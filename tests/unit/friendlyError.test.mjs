import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyError } from '../../src/shared/utils/friendlyError.js';

const RAW_429 = 'Análise por IA falhou na parte 1/1: Gemini HTTP 429: You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. Please retry in 3h40m39.4s.';

test('cota do Gemini vira mensagem curta, sem URL nem jargão do provedor', () => {
  const text = friendlyError(RAW_429);
  assert.match(text, /limite de uso/i);
  assert.doesNotMatch(text, /https?:|Gemini|quota|retry/i);
});

test('sobrecarga, tempo esgotado e rede têm mensagem própria', () => {
  assert.match(friendlyError('Gemini HTTP 503: overloaded'), /sobrecarregad/i);
  assert.match(friendlyError('O Gemini demorou demais para responder.'), /demorou demais/i);
  assert.match(friendlyError('Failed to fetch'), /conexão/i);
});

test('mensagem já amigável passa intacta, sem URLs', () => {
  assert.equal(friendlyError('A nota não existe mais.'), 'A nota não existe mais.');
  assert.doesNotMatch(friendlyError('Falhou, veja https://exemplo.com/erro agora'), /https?:/);
});

test('texto vazio ou inválido usa o padrão informado', () => {
  assert.equal(friendlyError('', 'Algo deu errado.'), 'Algo deu errado.');
  assert.equal(friendlyError(undefined, 'Algo deu errado.'), 'Algo deu errado.');
  assert.equal(friendlyError(new Error('Gemini HTTP 429: x')), friendlyError('Gemini HTTP 429: x'));
});

test('mensagens longas são cortadas', () => {
  assert.ok(friendlyError('x'.repeat(1000)).length <= 220);
});
