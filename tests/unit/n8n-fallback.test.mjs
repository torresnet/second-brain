import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WORKFLOW = fileURLToPath(new URL('../../n8n/second_brain_workflow.json', import.meta.url));
const workflow = JSON.parse(readFileSync(WORKFLOW, 'utf8'));
const node = name => workflow.nodes.find(n => n.name === name);

// Os nós de reserva recebem a saída do IF de cota (o erro 429), então $json não tem o corpo original
test('chave reserva do Gemini monta o corpo a partir do nó Montar, não de $json', () => {
  const body = node('Credencial Gemini 2 (reserva)').parameters.jsonBody;
  assert.match(body, /\$\('Montar Requisição Gemini'\)\.first\(\)\.json\.geminiBody/);
  assert.doesNotMatch(body, /\$json\.geminiBody/);
});

test('embedding reserva lê o texto do nó Parse, não de $json', () => {
  const body = node('Gerar Embedding 2 (reserva)').parameters.jsonBody;
  assert.match(body, /\$\('Parse Resposta Gemini'\)\.first\(\)\.json\.text_for_embedding/);
  assert.doesNotMatch(body, /\$json\.text_for_embedding/);
});

test('classificação de link não depende do construtor URL (ausente no sandbox do n8n)', () => {
  const withoutComments = name => node(name).parameters.jsCode.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(withoutComments('Classificar Entrada'), /new URL\(/);
  assert.doesNotMatch(withoutComments('Preparar Conteúdo'), /new URL\(/);
});

// O n8n roda em outra rede Docker: o nome curto "media-fetcher" nunca resolveu (ENOTFOUND em toda captura)
test('URL do media-fetcher usa um host resolvível, não o nome curto do container', () => {
  const cfg = node('Configuração').parameters.assignments.assignments;
  const url = cfg.find(a => a.name === 'mediaFetcherUrl').value;
  const host = url.replace(/^https?:\/\//, '').split(/[:/]/)[0];
  assert.match(url, /^https?:\/\//);
  assert.ok(host.includes('.'), `host sem domínio: ${host}`);
});

test('Media Fetcher tenta de novo em falha de rede', () => {
  const n = node('Media Fetcher');
  assert.equal(n.retryOnFail, true);
  assert.ok(n.maxTries >= 2);
});

test('Gemini principal insiste antes de desistir (503 costuma ser pico passageiro)', () => {
  const n = node('Credencial Gemini');
  assert.equal(n.retryOnFail, true);
  assert.ok(n.maxTries >= 3);
  assert.ok(n.waitBetweenTries >= 5000);
});

test('qualquer falha do Gemini principal (não só cota) desvia para a reserva', () => {
  assert.equal(node('Cota do Gemini estourou?'), undefined);
  const cond = node('Gemini falhou?').parameters.conditions.conditions[0].leftValue;
  assert.match(cond, /!\$json\.candidates/);
  assert.match(cond, /\$json\.error/);
  assert.doesNotMatch(cond, /429|quota/i);
  assert.deepEqual(workflow.connections['Credencial Gemini'].main[0].map(c => c.node), ['Gemini falhou?']);
  assert.deepEqual(workflow.connections['Gemini falhou?'].main[0].map(c => c.node), ['Credencial Gemini 2 (reserva)']);
  assert.deepEqual(workflow.connections['Gemini falhou?'].main[1].map(c => c.node), ['Parse Resposta Gemini']);
});

test('reserva troca para o modelo alternativo quando o erro não é de cota', () => {
  const cfg = node('Configuração').parameters.assignments.assignments;
  const fallback = cfg.find(a => a.name === 'geminiFallbackModel');
  assert.ok(fallback && fallback.value && fallback.value !== cfg.find(a => a.name === 'geminiModel').value);
  const url = node('Credencial Gemini 2 (reserva)').parameters.url;
  assert.match(url, /geminiFallbackModel/);
  assert.match(url, /429\|RESOURCE_EXHAUSTED\|quota/);
});

/** Executa o nó "Parse Resposta Gemini" real com uma resposta simulada. */
function runParse(res) {
  const code = node('Parse Resposta Gemini').parameters.jsCode;
  const ctx = { warnings: [], meta: { title: 'Post' }, url: 'https://instagram.com/p/x', sourceType: 'social', hint: '' };
  const $ = () => ({ first: () => ({ json: ctx }) });
  return new Function('$', '$input', code)($, { first: () => ({ json: res }) })[0].json;
}

test('erro 503 do Gemini vira mensagem legível, sem o JSON cru da API', () => {
  const out = runParse({ error: { message: '503 - "{\n  \\"error\\": {\n    \\"code\\": 503,\n    \\"message\\": \\"This model is currently experiencing high demand.\\",\n    \\"status\\": \\"UNAVAILABLE\\"\n  }\n}\n"' } });
  assert.match(out.summary, /sobrecarregada/);
  assert.match(out.summary, /Reprocessar/);
  assert.doesNotMatch(out.summary, /[{}\\]|UNAVAILABLE/);
});

test('erro de cota do Gemini vira mensagem de limite de uso', () => {
  const out = runParse({ error: { message: '429 - "{\\"error\\":{\\"status\\":\\"RESOURCE_EXHAUSTED\\"}}"' } });
  assert.match(out.summary, /limite de uso/);
});
