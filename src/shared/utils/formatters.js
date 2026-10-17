import { APP_CONFIG } from '../constants/config.js';
import { icon } from './icons.js';
import { buildObsidianMarkdown } from './obsidianExport.js';

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
  const known = APP_CONFIG.mediaTypes[sourceType];
  const config = known || APP_CONFIG.mediaTypes.note;
  return {
    label: config.label,
    icon: icon(config.icon),
    cssClass: `badge-${known ? sourceType : 'note'}`
  };
}

/**
 * Retorna texto (e o emoji usado só no Markdown exportado) do estágio de maturação do Jardim Digital (Maggie Appleton pattern)
 */
export function getStageBadge(stage) {
  switch (stage) {
    case 'evergreen':
      return { label: 'Evergreen (Maduro)', short: 'Madura', icon: '🌳', cssClass: 'stage-evergreen' };
    case 'seedling':
      return { label: 'Semente (Captura)', short: 'Semente', icon: '🌱', cssClass: 'stage-seedling' };
    case 'budding':
    default:
      return { label: 'Brotando (Em Síntese)', short: 'Brotando', icon: '🌿', cssClass: 'stage-budding' };
  }
}

/**
 * Gera o conteúdo em formato Markdown enriquecido com frontmatter e Callouts do Obsidian.
 * O escape do conteúdo (YAML, links, blocos executáveis) fica em obsidianExport.js.
 */
export function generateMarkdownForObsidian(item) {
  const stageInfo = getStageBadge(item.stage || 'budding');
  return buildObsidianMarkdown(item, {
    stageIcon: stageInfo.icon,
    stageLabel: stageInfo.label,
    dateLabel: formatDateBR(item.created_at)
  });
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
