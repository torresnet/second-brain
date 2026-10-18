// Monta o .md exportado para o Obsidian. O conteúdo vem de páginas externas (via IA), então
// nada é gravado cru: frontmatter com escape YAML e blocos executáveis por plugins neutralizados.

import { noteExamples, noteOrigin } from './noteView.js';

const CONTROL_CHARS = new RegExp('[\u0000-\u001f\u007f\u2028\u2029]+', 'g');
const oneLine = (value) => neutralizeExecutable(String(value ?? '').replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim());

/** Texto como string YAML entre aspas (JSON é YAML válido): sem quebra de linha, aspas ou chaves injetadas. */
export function yamlString(value) {
  return JSON.stringify(oneLine(value));
}

/** Só http/https; devolve '' para qualquer outra coisa (javascript:, data:, file:...). */
export function safeHttpUrl(value) {
  const text = oneLine(value);
  if (!/^https?:\/\//i.test(text)) return '';
  try {
    return new URL(text).toString();
  } catch {
    return '';
  }
}

const markdownLinkTarget = (url) => url.replace(/[()\s<>]/g, (c) => encodeURIComponent(c));

const EXECUTABLE_FENCE = /^([ \t>\-*+\d.]*(?:`{3,}|~{3,})[ \t]*)(dataviewjs|dataview|js|javascript|jsx|ts|typescript|templater|button|query|tasks|meta-?bind|custom-?js|run|chart)\b/gim;

/** Impede que o texto capturado vire código executável em plugins (Dataview JS, Templater, CustomJS...). */
export function neutralizeExecutable(text) {
  return String(text ?? '')
    .replace(EXECUTABLE_FENCE, '$1text $2')
    .replace(/<%/g, '< %')
    .replace(/`(\$?=)/g, '`​$1');
}

const quoteBlock = (text) => String(text ?? '').split(/\r?\n/).map((line) => `> ${line}`).join('\n');

export function buildObsidianMarkdown(item, { stageIcon, stageLabel, dateLabel }) {
  const title = oneLine(item.title) || 'Sem título';
  const sourceType = oneLine(item.source_type) || 'note';
  const stage = oneLine(item.stage) || 'budding';
  const url = safeHttpUrl(item.source_url);

  const tags = Array.isArray(item.tags) && item.tags.length
    ? item.tags.map((t) => `  - ${yamlString(t)}`).join('\n')
    : `  - ${yamlString('segundo-cerebro')}`;

  const takeaways = Array.isArray(item.key_takeaways)
    ? item.key_takeaways.map((t) => `- [ ] ${oneLine(t)}`).join('\n')
    : '- [ ] Nenhum ponto chave catalogado.';

  const examples = noteExamples(item);
  const examplesSection = examples.length
    ? `## 💡 Como aplicar na prática\n${examples.map((e, i) => `### ${i + 1}. ${oneLine(e.title)}${e.scenario ? `\n**Cenário:** ${neutralizeExecutable(e.scenario)}\n` : ''}${e.how ? `\n${neutralizeExecutable(e.how)}` : ''}`).join('\n\n')}\n\n---\n\n`
    : '';

  const entities = Array.isArray(item.entities)
    ? item.entities.map((e) => neutralizeExecutable(String(e ?? '')).replace(/[\[\]|#^\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean)
    : [];
  const entitiesFormatted = entities.length ? entities.map((e) => `[[${e}]]`).join(', ') : 'Nenhuma entidade direta.';

  return `---
title: ${yamlString(title)}
date: ${yamlString(item.created_at || new Date().toISOString())}
type: ${yamlString(sourceType)}
stage: ${yamlString(stage)}
url: ${yamlString(url)}
tags:
${tags}
---

# ${title}

> [!INFO] Metadados da Nota
> - **Tipo:** ${sourceType.toUpperCase()}
> - **Estágio:** ${stageIcon} ${stageLabel}
> - **Origem:** ${url ? `[Link da Fonte](${markdownLinkTarget(url)})` : oneLine(noteOrigin(item).text)}
> - **Entidades / Conceitos Relacionados:** ${entitiesFormatted}
> - **Catalogado em:** ${dateLabel}

---

> [!ABSTRACT] Resumo Executivo
${quoteBlock(neutralizeExecutable(item.summary || 'Sem resumo disponível.'))}

---

## 🎯 Pontos-Chave (Takeaways)
${takeaways}

---

${examplesSection}## 📝 Transcrição & Conteúdo Integral
${neutralizeExecutable(item.raw_content || 'Sem transcrição disponível.')}
`;
}
