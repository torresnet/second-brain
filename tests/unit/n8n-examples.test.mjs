import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WORKFLOW = fileURLToPath(new URL('../../n8n/second_brain_workflow.json', import.meta.url));
const workflow = JSON.parse(readFileSync(WORKFLOW, 'utf8'));
const nodeByName = (name) => workflow.nodes.find(n => n.name === name);

/** Executa o nó "Parse Resposta Gemini" real com a resposta do Gemini simulada. */
function runParse(geminiJson) {
  const code = nodeByName('Parse Resposta Gemini').parameters.jsCode;
  const ctx = { warnings: [], meta: {}, hint: null, url: 'https://exemplo.com/a', sourceType: 'article', fileName: null };
  const $ = () => ({ first: () => ({ json: ctx }) });
  const response = { candidates: [{ content: { parts: [{ text: JSON.stringify(geminiJson) }] } }] };
  const [{ json }] = new Function('$', '$input', code)($, { first: () => ({ json: response }) });
  return json;
}

const example = (n, extra = {}) => ({ title: `Exemplo ${n}`, scenario: 'situação', how: 'faça assim', ...extra });

test('n8n: a captura gera no máximo 5 exemplos práticos, válidos e sem repetição', () => {
  const out = runParse({
    title: 'T', summary: 'S',
    practical_examples: [
      example(1), example(1), { title: 'sem como fazer' }, null, 'texto solto',
      example(2), example(3), example(4), example(5), example(6)
    ]
  });
  assert.deepEqual(out.practical_examples.map(e => e.title), ['Exemplo 1', 'Exemplo 2', 'Exemplo 3', 'Exemplo 4', 'Exemplo 5']);
  assert.deepEqual(out.practical_examples[0], { title: 'Exemplo 1', scenario: 'situação', how: 'faça assim', uses: [] });
  assert.equal('action_items' in out, false);
});

test('n8n: menos de 5 exemplos (ou nenhum) é válido', () => {
  assert.equal(runParse({ title: 'T', summary: 'S', practical_examples: [example(1)] }).practical_examples.length, 1);
  assert.deepEqual(runParse({ title: 'T', summary: 'S' }).practical_examples, []);
});

test('n8n: o prompt pede exemplos práticos e a gravação envia practical_examples, não "próximas ações"', () => {
  const prompt = nodeByName('Montar Requisição Gemini').parameters.jsCode;
  assert.match(prompt, /"practical_examples"/);
  assert.match(prompt, /ATÉ 5 exemplos práticos/);
  assert.doesNotMatch(prompt, /action_items/);

  const body = nodeByName('Salvar no Supabase (brain_items)').parameters.jsonBody;
  assert.match(body, /"practical_examples"/);
  assert.doesNotMatch(body, /action_items/);
});
