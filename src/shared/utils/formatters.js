import { APP_CONFIG } from '../constants/config.js';

/**
 * Formata timestamp ISO para exibição amigável em português
 */
export function formatDateBR(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Retorna o ícone e badge correspondente ao tipo de mídia
 */
export function getMediaBadge(sourceType) {
  const config = APP_CONFIG.mediaTypes[sourceType] || APP_CONFIG.mediaTypes.note;
  return {
    label: config.label,
    icon: config.icon,
    cssClass: `badge-${sourceType || 'note'}`
  };
}

/**
 * Retorna ícone e texto do estágio de maturação do Jardim Digital (Maggie Appleton pattern)
 */
export function getStageBadge(stage) {
  switch (stage) {
    case 'evergreen':
      return { label: 'Evergreen (Maduro)', icon: '🌳', color: '#10b981' };
    case 'seedling':
      return { label: 'Semente (Captura)', icon: '🌱', color: '#f59e0b' };
    case 'budding':
    default:
      return { label: 'Brotando (Em Síntese)', icon: '🌿', color: '#06b6d4' };
  }
}

/**
 * Gera o conteúdo em formato Markdown enriquecido com frontmatter e Callouts do Obsidian
 * Compatível com os padrões de 'Obsidian-Templates', 'zk' e 'eugeniughelbur/obsidian-second-brain'
 */
export function generateMarkdownForObsidian(item) {
  const tagsFormatted = Array.isArray(item.tags) ? item.tags.map(t => `  - ${t}`).join('\n') : '';
  const takeaways = Array.isArray(item.key_takeaways) 
    ? item.key_takeaways.map(t => `- [ ] ${t}`).join('\n') 
    : '- [ ] Nenhum ponto chave catalogado.';

  const examples = Array.isArray(item.practical_examples) ? item.practical_examples : [];
  const examplesSection = examples.length
    ? `## 💡 Como aplicar na prática\n${examples.map((e, i) => `### ${i + 1}. ${e.title}\n${e.scenario ? `**Cenário:** ${e.scenario}\n\n` : ''}${e.how}`).join('\n\n')}\n\n---\n\n`
    : '';

  // Notas antigas ainda podem ter ações; novas notas não geram mais esta seção
  const legacyActions = Array.isArray(item.action_items) ? item.action_items : [];
  const actionsSection = legacyActions.length
    ? `## ⚡ Próximas Ações Práticas (GTD)\n${legacyActions.map(a => `- [ ] ${a}`).join('\n')}\n\n---\n\n`
    : '';

  const entitiesFormatted = Array.isArray(item.entities) && item.entities.length > 0
    ? item.entities.map(e => `[[${e}]]`).join(', ')
    : 'Nenhuma entidade direta.';

  const stage = item.stage || 'budding';
  const stageInfo = getStageBadge(stage);

  return `---
title: "${item.title.replace(/"/g, '\\"')}"
date: ${item.created_at || new Date().toISOString()}
type: ${item.source_type}
stage: ${stage}
url: "${item.source_url || ''}"
tags:
${tagsFormatted || '  - segundo-cerebro'}
---

# ${item.title}

> [!INFO] Metadados da Nota
> - **Tipo:** ${item.source_type.toUpperCase()}
> - **Estágio:** ${stageInfo.icon} ${stageInfo.label}
> - **Origem:** [Link da Fonte](${item.source_url || '#'})
> - **Entidades / Conceitos Relacionados:** ${entitiesFormatted}
> - **Catalogado em:** ${formatDateBR(item.created_at)}

---

> [!ABSTRACT] Resumo Executivo
> ${item.summary || 'Sem resumo disponível.'}

---

## 🎯 Pontos-Chave (Takeaways)
${takeaways}

---

${examplesSection}${actionsSection}## 📝 Transcrição & Conteúdo Integral
${item.raw_content || 'Sem transcrição disponível.'}
`;
}

/**
 * Dispara o download de um arquivo .md no navegador
 */
export function downloadMarkdownFile(item) {
  const markdownText = generateMarkdownForObsidian(item);
  const blob = new Blob([markdownText], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  
  // Sanitiza o nome do arquivo
  const safeTitle = (item.title || 'nota')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);

  link.href = url;
  link.setAttribute('download', `${safeTitle}.md`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Copia texto para a área de transferência com feedback
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Falha ao copiar para clipboard:', err);
    return false;
  }
}
