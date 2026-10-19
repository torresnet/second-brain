import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatter, extractWikilinks, stripWikilinks, parseCaptureDate, mapSourceType, mapStage, noteToItem
} from '../../src/shared/utils/obsidianImport.js';

const NOTE = `---
titulo: "⭐ MiroFish — motor de previsão"
tipo: repositorio
url: https://github.com/666ghj/MiroFish
autor: 666ghj
capturado: "22/09/2026"
status: novo
topicos: [ia, multiagente, opinião pública]
stack: [python, vue]
resolve: [prever reação, testar crise]
---

# ⭐ MiroFish — motor de previsão

**MOC:** [[IA e LLMs — Modelos, APIs e Inferência]], [[Marketing e Mídia Paga|Marketing]]

## Resumo
Motor de previsão open source
com [[CAMEL OASIS]] por baixo.

## Pontos-chave
- **Precisa de 2 chaves**: LLM e [[Zep Cloud]]
- AGPL-3.0

## Como aplicar
1. rodar
`;

test('parseFrontmatter lê strings, listas inline e listas em bloco', () => {
  const { data, body } = parseFrontmatter(`---\na: "x: y"\nb: [um, dois três]\nc:\n  - p\n  - q\nd: sem aspas\n---\ncorpo`);
  assert.deepEqual(data, { a: 'x: y', b: ['um', 'dois três'], c: ['p', 'q'], d: 'sem aspas' });
  assert.equal(body, 'corpo');
});

test('parseFrontmatter devolve o texto inteiro quando não há frontmatter', () => {
  const { data, body } = parseFrontmatter('# Só corpo');
  assert.deepEqual(data, {});
  assert.equal(body, '# Só corpo');
});

test('extractWikilinks tira alias e âncora, deduplica sem diferenciar caixa e ignora blocos de código', () => {
  const text = 'Veja [[A]] e [[a|apelido]] e [[B#seção]] e [[C^bloco]].\n```\n[[Dentro do código]]\n```\n`[[inline]]`';
  assert.deepEqual(extractWikilinks(text), ['A', 'B', 'C']);
});

test('stripWikilinks deixa só o texto legível', () => {
  assert.equal(stripWikilinks('ver [[A|apelido]], [[B#x]] e [[C]]'), 'ver apelido, B e C');
});

test('parseCaptureDate converte dd/mm/aaaa e rejeita datas inválidas', () => {
  assert.equal(parseCaptureDate('22/09/2026'), '2026-09-22T12:00:00.000Z');
  assert.equal(parseCaptureDate('31/02/2026'), null);
  assert.equal(parseCaptureDate('ontem'), null);
  assert.equal(parseCaptureDate(undefined), null);
});

test('mapSourceType usa o domínio do link e cai para article/note', () => {
  assert.equal(mapSourceType('https://www.youtube.com/watch?v=1'), 'youtube');
  assert.equal(mapSourceType('https://youtu.be/abc'), 'youtube');
  assert.equal(mapSourceType('https://www.instagram.com/reel/xyz/'), 'reel');
  assert.equal(mapSourceType('https://www.tiktok.com/@a/video/1'), 'tiktok');
  assert.equal(mapSourceType('https://github.com/a/b'), 'article');
  assert.equal(mapSourceType(''), 'note');
});

test('mapStage traduz o status do vault para o estágio do jardim', () => {
  assert.equal(mapStage('novo'), 'seedling');
  assert.equal(mapStage('stub'), 'seedling');
  assert.equal(mapStage('superficial'), 'seedling');
  assert.equal(mapStage('aplicado'), 'evergreen');
  assert.equal(mapStage('ativo'), 'evergreen');
  assert.equal(mapStage('lido'), 'budding');
  assert.equal(mapStage(undefined), 'budding');
});

test('noteToItem converte uma nota completa', () => {
  const item = noteToItem({ relPath: 'Notas/Repositórios/MiroFish.md', text: NOTE, mtime: new Date('2026-01-01T00:00:00Z') });
  assert.equal(item.title, 'MiroFish — motor de previsão');
  assert.equal(item.is_favorite, true);
  assert.equal(item.source_type, 'article');
  assert.equal(item.source_url, 'https://github.com/666ghj/MiroFish');
  assert.equal(item.stage, 'seedling');
  assert.equal(item.created_at, '2026-09-22T12:00:00.000Z');
  assert.deepEqual(item.tags, ['repositorio', 'ia', 'multiagente', 'opinião pública', 'python', 'vue']);
  assert.deepEqual(item.entities, ['IA e LLMs — Modelos, APIs e Inferência', 'Marketing e Mídia Paga', 'CAMEL OASIS', 'Zep Cloud']);
  assert.equal(item.summary, 'Motor de previsão open source com CAMEL OASIS por baixo.');
  assert.deepEqual(item.key_takeaways, ['Precisa de 2 chaves: LLM e Zep Cloud', 'AGPL-3.0']);
  assert.ok(item.raw_content.startsWith('# ⭐ MiroFish'));
  assert.ok(item.raw_content.includes('## Como aplicar'));
  assert.ok(!item.raw_content.includes('titulo:'));
  assert.equal(item.metadata.obsidian.path, 'Notas/Repositórios/MiroFish.md');
  assert.equal(item.metadata.obsidian.tipo, 'repositorio');
  assert.deepEqual(item.metadata.obsidian.resolve, ['prever reação', 'testar crise']);
  assert.equal(item.metadata.imported_from, 'obsidian');
});

test('noteToItem sem frontmatter usa o nome do arquivo, a data do arquivo e o primeiro parágrafo', () => {
  const item = noteToItem({ relPath: 'Setup/VPS.md', text: '# VPS\n\nServidor principal do Coolify.\n\nMais coisa.', mtime: new Date('2026-03-04T10:00:00Z') });
  assert.equal(item.title, 'VPS');
  assert.equal(item.is_favorite, false);
  assert.equal(item.source_type, 'note');
  assert.equal(item.source_url, null);
  assert.equal(item.stage, 'budding');
  assert.equal(item.created_at, '2026-03-04T10:00:00.000Z');
  assert.equal(item.summary, 'Servidor principal do Coolify.');
  assert.deepEqual(item.tags, []);
});

test('noteToItem ignora link que não seja http(s) e nota vazia', () => {
  const item = noteToItem({ relPath: 'a.md', text: '---\ntitulo: x\nurl: "não informado"\n---\ncorpo', mtime: new Date() });
  assert.equal(item.source_url, null);
  assert.equal(noteToItem({ relPath: 'vazia.md', text: '---\ntitulo: x\n---\n  \n', mtime: new Date() }), null);
});
