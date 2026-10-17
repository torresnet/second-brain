// Parâmetros de compartilhamento (Web Share Target). Só os `shared_*` gerados pelo service worker valem:
// aceitar ?url=, ?text= ou ?title= deixaria qualquer link externo pré-preencher a captura.
export function parseSharedParams(search) {
  const params = new URLSearchParams(search);
  const url = params.get('shared_url');
  const title = params.get('shared_title');
  const text = params.get('shared_text');
  const hasFile = params.get('shared_file') === '1';
  return { url, title, text, hasFile, hasAny: Boolean(url || text || hasFile) };
}
