import { icon } from '../shared/utils/icons.js';

/**
 * Sino no cabeçalho com o total de pendências; abre a página Alertas.
 */
export function createAlertCenter(mountPoint, { onOpen }) {
  mountPoint.classList.add('alert-center');
  mountPoint.innerHTML = `
    <button type="button" class="icon-btn alert-bell" aria-label="Alertas">
      ${icon('bell')}<span class="alert-badge" style="display: none;"></span>
    </button>`;

  const bell = mountPoint.querySelector('.alert-bell');
  const badge = mountPoint.querySelector('.alert-badge');
  bell.addEventListener('click', () => onOpen?.());

  return {
    setCount(count) {
      badge.style.display = count ? 'flex' : 'none';
      badge.textContent = String(count);
      bell.setAttribute('aria-label', count ? `Alertas (${count} pendente${count > 1 ? 's' : ''})` : 'Alertas');
    }
  };
}
