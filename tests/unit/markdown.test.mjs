import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, escapeHtml } from '../../src/shared/utils/markdown.js';

test('escapa HTML perigoso em qualquer posição', () => {
  const html = renderMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)> **<b>x</b>**');
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<b>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('só aceita links http(s); javascript: vira texto', () => {
  const html = renderMarkdown('[ok](https://exemplo.com/a?x=1&y=2) [mau](javascript:alert(1)) [data](data:text/html,<b>)');
  assert.ok(html.includes('<a href="https://exemplo.com/a?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">ok</a>'));
  assert.ok(!html.includes('href="javascript'));
  assert.ok(!html.includes('href="data'));
});

test('URL com aspas não consegue quebrar o atributo href', () => {
  const html = renderMarkdown('[x](https://a.com/"onmouseover="alert(1)) e https://b.com/"onfocus="x');
  assert.ok(!/ onmouseover=/.test(html));
  assert.ok(!/ onfocus=/.test(html));
});

test('links soltos viram âncoras sem engolir pontuação final', () => {
  const html = renderMarkdown('Veja https://remotion.dev/docs.');
  assert.ok(html.includes('href="https://remotion.dev/docs"'));
  assert.ok(html.endsWith('.</p>'));
});

test('blocos de código preservam o texto literal escapado e têm botão copiar', () => {
  const html = renderMarkdown('Rode:\n```bash\nnpm i <pkg> && echo "ok"\n```\nPronto');
  assert.ok(html.includes('<pre><code>npm i &lt;pkg&gt; &amp;&amp; echo &quot;ok&quot;</code></pre>'));
  assert.ok(html.includes('md-copy-btn'));
  assert.ok(html.includes('<span>bash</span>'));
  assert.ok(html.includes('<p>Pronto</p>'));
});

test('bloco de código sem fechamento (resposta cortada) não quebra', () => {
  const html = renderMarkdown('```js\nconst a = 1;');
  assert.ok(html.includes('const a = 1;'));
});

test('listas, negrito, código inline e títulos', () => {
  const html = renderMarkdown('# Título\n- **Remotion** — `npm i remotion`\n- Outro\n\n1. um\n2. dois');
  assert.ok(html.includes('<strong>Título</strong>'));
  assert.ok(html.includes('<ul><li><strong>Remotion</strong> — <code class="md-inline-code">npm i remotion</code></li><li>Outro</li></ul>'));
  assert.ok(html.includes('<ol><li>um</li><li>dois</li></ol>'));
});

test('código inline não é interpretado como markdown nem como HTML', () => {
  const html = renderMarkdown('`**x** <b>`');
  assert.ok(html.includes('**x** &lt;b&gt;'));
});

test('caracteres de controle usados internamente não podem ser forjados', () => {
  const html = renderMarkdown('\u00000\u0000 \u00010\u0001');
  assert.ok(!html.includes('md-code'));
  assert.ok(!html.includes('undefined'));
});

test('entradas vazias ou inválidas', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});
