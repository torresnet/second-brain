import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractUrls, normalizeUrl, canonicalKey, extractCodeBlocks, chunkText, splitWindows,
  htmlToText, extractTitle, extractMetaDescription, slugify
} from '../../supabase/functions/_shared/text.ts';

test('extractUrls acha links com e sem https, remove pontuação final e rastreadores', () => {
  const text = 'Veja https://github.com/remotion-dev/remotion. Também (https://remotion.dev/docs?utm_source=x&a=1), ' +
    'e acesse claude.ai ou www.n8n.io/pricing! Contato: joao@gmail.com e arquivo node.js não contam.';
  const urls = extractUrls(text);
  assert.ok(urls.includes('https://github.com/remotion-dev/remotion'));
  assert.ok(urls.includes('https://remotion.dev/docs?a=1'));
  assert.ok(urls.includes('https://claude.ai'));
  assert.ok(urls.includes('https://www.n8n.io/pricing'));
  assert.ok(!urls.some(u => u.includes('gmail.com')));
  assert.ok(!urls.some(u => u.includes('node.js')));
});

test('extractUrls deduplica e ignora texto vazio', () => {
  assert.deepEqual(extractUrls('https://a.com/x e https://a.com/x', null, undefined), ['https://a.com/x']);
  assert.deepEqual(extractUrls(''), []);
});

test('normalizeUrl rejeita lixo e protocolos perigosos', () => {
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('ftp://x.com'), null);
  assert.equal(normalizeUrl('localhost'), null);
  assert.equal(normalizeUrl(''), null);
  assert.equal(normalizeUrl('Exemplo.COM/Pasta/'), 'https://exemplo.com/Pasta');
});

test('canonicalKey: mesma URL gera mesma chave; sem URL usa tipo+nome', () => {
  assert.equal(
    canonicalKey('ferramenta', 'Remotion', 'https://www.remotion.dev/'),
    canonicalKey('link', 'outro nome', 'https://remotion.dev')
  );
  assert.equal(canonicalKey('Conceito', 'Funil de Vendas', null), 'conceito:funil-de-vendas');
});

test('extractCodeBlocks lê blocos cercados com linguagem', () => {
  const text = 'antes\n```python\nimport cv2\nprint(1)\n```\ndepois\n```\nls -la\n```\n```js\n\n```';
  const blocks = extractCodeBlocks(text);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], { language: 'python', code: 'import cv2\nprint(1)' });
  assert.equal(blocks[1].language, null);
});

test('chunkText respeita o tamanho, avança sempre e preserva todo o conteúdo', () => {
  const sentence = 'Esta é uma frase de teste sobre automação. ';
  const text = sentence.repeat(200);
  const chunks = chunkText(text, 500, 80);
  assert.ok(chunks.length > 10);
  assert.ok(chunks.every(c => c.length <= 500));
  assert.ok(chunks[0].startsWith('Esta é uma frase'));
  assert.ok(chunks.at(-1).includes('automação.'));
});

test('chunkText: vazio, curto, sem espaços e limite máximo', () => {
  assert.deepEqual(chunkText('', 100, 10), []);
  assert.deepEqual(chunkText('curto', 100, 10), ['curto']);
  const noSpaces = 'a'.repeat(1000);
  const chunks = chunkText(noSpaces, 300, 50);
  assert.ok(chunks.length >= 4);
  assert.equal(chunkText('x '.repeat(5000), 100, 10, 7).length, 7);
});

test('splitWindows divide textos longos e mantém curtos inteiros', () => {
  assert.deepEqual(splitWindows('abc'), ['abc']);
  assert.deepEqual(splitWindows('   '), []);
  const long = 'palavra '.repeat(10000);
  const windows = splitWindows(long, 30000, 6);
  assert.ok(windows.length >= 2 && windows.length <= 6);
});

test('htmlToText remove scripts/estilos, decodifica entidades e extrai título/descrição', () => {
  const html = `<html><head><title>Minha &amp; Ferramenta</title>
    <meta name="description" content="Faz coisas &quot;incríveis&quot;"><style>.a{}</style></head>
    <body><nav>menu</nav><script>alert(1)</script><h1>Olá</h1><p>Texto&nbsp;aqui &#233; &ccedil;</p></body></html>`;
  assert.equal(extractTitle(html), 'Minha & Ferramenta');
  assert.equal(extractMetaDescription(html), 'Faz coisas "incríveis"');
  const text = htmlToText(html);
  assert.ok(text.includes('Olá'));
  assert.ok(text.includes('Texto aqui é ç'));
  assert.ok(!text.includes('alert'));
  assert.ok(!text.includes('Minha'));
});

test('slugify remove acentos', () => {
  assert.equal(slugify('Automação & Vendas!'), 'automacao-vendas');
});
