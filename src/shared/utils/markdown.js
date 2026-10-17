// Renderizador de Markdown mínimo e seguro: todo texto é escapado ANTES de virar HTML.

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CODE_FENCE = /```([\w+#.-]*)[ \t]*\n([\s\S]*?)(?:```|$)/g;
const MD_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL = /(^|[\s(>])(https?:\/\/[^\s<)]*[^\s<).,;:!?])/g;

function renderInline(escaped, tokens) {
  const keep = html => {
    tokens.push(html);
    return `\u0001${tokens.length - 1}\u0001`;
  };
  return escaped
    .replace(/`([^`\n]+)`/g, (_, code) => keep(`<code class="md-inline-code">${code}</code>`))
    .replace(MD_LINK, (_, label, url) => keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`))
    .replace(BARE_URL, (_, lead, url) => `${lead}${keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`)}`)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
}

export function renderMarkdown(source) {
  const blocks = [];
  const tokens = [];
  const text = String(source ?? '').replace(/\r\n/g, '\n').replace(/[\u0000\u0001]/g, '');

  const withPlaceholders = text.replace(CODE_FENCE, (_, lang, code) => {
    blocks.push({ lang, code: code.replace(/\n$/, '') });
    return `\n\u0000${blocks.length - 1}\u0000\n`;
  });

  const lines = escapeHtml(withPlaceholders).split('\n');
  const out = [];
  let list = null;
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.join('<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map(i => `<li>${i}</li>`).join('')}</${list.tag}>`);
    list = null;
  };

  for (const line of lines) {
    const placeholder = line.match(/^\u0000(\d+)\u0000$/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,4}\s+(.*)$/);

    if (placeholder) {
      flushParagraph(); flushList();
      out.push(`\u0000${placeholder[1]}\u0000`);
    } else if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      list = list ?? { tag, items: [] };
      list.items.push(renderInline((bullet ?? numbered)[1], tokens));
    } else if (heading) {
      flushParagraph(); flushList();
      out.push(`<p><strong>${renderInline(heading[1], tokens)}</strong></p>`);
    } else if (!line.trim()) {
      flushParagraph(); flushList();
    } else {
      flushList();
      paragraph.push(renderInline(line, tokens));
    }
  }
  flushParagraph(); flushList();

  return out
    .join('')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => {
      const { lang, code } = blocks[Number(i)];
      const label = escapeHtml(lang || 'código');
      return `<div class="md-code"><div class="md-code-head"><span>${label}</span><button type="button" class="md-copy-btn">Copiar</button></div><pre><code>${escapeHtml(code)}</code></pre></div>`;
    })
    .replace(/\u0001(\d+)\u0001/g, (_, i) => tokens[Number(i)]);
}
