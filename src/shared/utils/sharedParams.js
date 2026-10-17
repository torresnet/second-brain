// Parâmetros de compartilhamento (Web Share Target). Só os `shared_*` são lidos (o service worker os gera a
// partir do POST do celular). Qualquer pessoa ainda pode montar um link /?shared_url=..., por isso a captura
// pré-preenchida sempre mostra o aviso de origem externa e só salva com confirmação manual (CaptureModal.js).
export function parseSharedParams(search) {
  const params = new URLSearchParams(search);
  const url = params.get('shared_url');
  const title = params.get('shared_title');
  const text = params.get('shared_text');
  const hasFile = params.get('shared_file') === '1';
  return { url, title, text, hasFile, hasAny: Boolean(url || text || hasFile) };
}
