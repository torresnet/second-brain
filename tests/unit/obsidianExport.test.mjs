import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildObsidianMarkdown, neutralizeExecutable, safeHttpUrl, yamlString } from '../../src/shared/utils/obsidianExport.js';

const META = { stageIcon: '🌿', stageLabel: 'Brotando', dateLabel: '17 de out. de 2026' };
const frontmatter = (md) => md.split('\n---\n')[0];

test('yamlString não deixa quebra de linha nem aspas escaparem do valor', () => {
  const value = 'Título"\nurl: "https://evil.example"\ntags:\n  - injetada';
  const yaml = yamlString(value);
  assert.ok(!yaml.includes('\n'));
  assert.equal(JSON.parse(yaml), 'Título" url: "https://evil.example" tags: - injetada');
});

test('título malicioso não cria chaves extras no frontmatter', () => {
  const md = buildObsidianMarkdown({ title: 'ok"\ncssclasses: pwn', created_at: '2026-10-17', source_type: 'article', tags: ['a'] }, META);
  const keys = frontmatter(md).split('\n').filter(l => /^[a-z]+:/.test(l)).map(l => l.split(':')[0]);
  assert.deepEqual(keys, ['title', 'date', 'type', 'stage', 'url', 'tags']);
  assert.ok(!frontmatter(md).includes('cssclasses: pwn\n'));
});

test('url do frontmatter e do link só aceita http(s) e é escapada', () => {
  assert.equal(safeHttpUrl('javascript:alert(1)'), '');
  assert.equal(safeHttpUrl('data:text/html,x'), '');
  assert.equal(safeHttpUrl('https://exemplo.com/a b'), 'https://exemplo.com/a%20b');
  const bad = buildObsidianMarkdown({ title: 't', source_url: 'javascript:alert(1)', source_type: 'article' }, META);
  assert.ok(bad.includes('url: ""'));
  assert.ok(bad.includes('**Origem:** Sem link de origem'));
  const quoted = buildObsidianMarkdown({ title: 't', source_url: 'https://exemplo.com/a")\ninjetado: 1', source_type: 'article' }, META);
  assert.ok(!/^injetado:/m.test(quoted));
});

test('blocos executáveis por plugins do Obsidian são neutralizados no conteúdo', () => {
  const raw = ['```dataviewjs', 'dv.paragraph(app.vault.adapter)', '```', '```js', 'x()', '```', '```python', 'print(1)', '```', '<% tp.system.prompt() %>', 'inline `$= dv.pages()` e `= this.file`'].join('\n');
  const out = neutralizeExecutable(raw);
  assert.ok(out.includes('```text dataviewjs'));
  assert.ok(out.includes('```text js'));
  assert.ok(out.includes('```python'), 'linguagens comuns ficam como estavam');
  assert.ok(!out.includes('<%'));
  assert.ok(!out.includes('`$='));
  assert.ok(!out.includes('`='));
  const md = buildObsidianMarkdown({ title: 't', raw_content: raw, summary: '```dataviewjs\nx\n```', source_type: 'note' }, META);
  assert.ok(!/^```dataviewjs/m.test(md.replace(/^>.*$/gm, '')));
  assert.ok(!md.includes('> ```dataviewjs'));
});

test('neutralização cobre fences aninhadas em citação/lista e todos os campos, sem corromper texto comum', () => {
  const nested = neutralizeExecutable('> ```dataviewjs\n- ```js\n1. ~~~templater\n  ```button');
  assert.equal(nested, '> ```text dataviewjs\n- ```text js\n1. ~~~text templater\n  ```text button');
  assert.equal(neutralizeExecutable('```\nRun the tests\n```\nQuery planning\nChart of accounts'), '```\nRun the tests\n```\nQuery planning\nChart of accounts');
  const md = buildObsidianMarkdown({
    title: 'x <% tp.system.prompt() %>', source_type: 'note', key_takeaways: ['`$= dv.pages()`'], action_items: ['<% x %>'],
    entities: ['<% e %>'], practical_examples: [{ title: '<% t %>', how: '> ```dataviewjs\nx' }], summary: '- ```dataviewjs\nx'
  }, META);
  assert.ok(!md.includes('<%'));
  assert.ok(!md.includes('`$='));
  assert.ok(!/^[>\-\s]*```dataviewjs/m.test(md));
});

test('entidades não quebram os wikilinks e itens de lista ficam em uma linha', () => {
  const md = buildObsidianMarkdown({ title: 't', source_type: 'note', entities: ['A]] [[B', 'ok'], key_takeaways: ['linha 1\n- [ ] injetada'], tags: ['x\ny'] }, META);
  assert.ok(md.includes('[[A B]]'));
  assert.ok(md.includes('- [ ] linha 1 - [ ] injetada'));
  assert.ok(md.includes('  - "x y"'));
});

test('exportação normal continua com o formato esperado', () => {
  const md = buildObsidianMarkdown({
    title: 'Nota boa', created_at: '2026-10-17T10:00:00Z', source_type: 'article', stage: 'budding', source_url: 'https://exemplo.com/post',
    tags: ['ia', 'ferramentas'], summary: 'Resumo em\ndois parágrafos', key_takeaways: ['ponto 1'], raw_content: 'Texto integral'
  }, META);
  assert.ok(md.startsWith('---\ntitle: "Nota boa"\n'));
  assert.ok(md.includes('url: "https://exemplo.com/post"'));
  assert.ok(md.includes('  - "ia"\n  - "ferramentas"'));
  assert.ok(md.includes('[Link da Fonte](https://exemplo.com/post)'));
  assert.ok(md.includes('> Resumo em\n> dois parágrafos'));
  assert.ok(md.includes('- [ ] ponto 1'));
  assert.ok(md.endsWith('Texto integral\n'));
});
