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
