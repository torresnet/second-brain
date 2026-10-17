# Media Fetcher

Serviço auxiliar do pipeline de ingestão. O n8n chama `POST /fetch` quando o link é de uma rede social
(Instagram, TikTok, Facebook, X, Vimeo...) ou um vídeo/áudio grande demais para ir direto ao Gemini.
O serviço baixa a mídia com **yt-dlp**, comprime com **ffmpeg** para caber em ~12 MB e devolve em base64.

## Deploy no Coolify

1. Novo recurso → Dockerfile → este repositório, _Base Directory_ `/media-fetcher`.
2. Variável de ambiente obrigatória: `FETCHER_API_KEY` (um segredo longo e aleatório).
3. **Não exponha publicamente.** Mantenha na mesma rede do n8n e use a URL interna (ex.: `http://media-fetcher:8080`).
4. Volume persistente em `/data` (opcional, para `cookies.txt`).
5. No n8n:
   - Nó **Configuração** → `mediaFetcherUrl` com a URL interna do serviço.
   - Credencial **Header Auth** `Media Fetcher Key`: Name = `X-Api-Key`, Value = o mesmo `FETCHER_API_KEY`.
   - Selecione-a no nó **Media Fetcher**.

## Instagram exige login

O Instagram bloqueia downloads anônimos com frequência ("login required"). Solução:

1. Crie/use uma conta **secundária** do Instagram (cookies de sessão dão acesso à conta; há risco de bloqueio).
2. Exporte os cookies do navegador logado no formato Netscape (extensão "Get cookies.txt LOCALLY").
3. Salve como `/data/cookies.txt` no volume do serviço e reinicie.

Sem cookies, posts públicos às vezes funcionam; quando não, o item é salvo com a legenda pública (se houver) e um aviso.

## Segurança (SSRF)

- O link é verificado antes do download (`preflight`): só http/https, portas 80/443, sem credenciais, todos os IPs públicos, e a cadeia de redirects (até 5) é revalidada com conexão fixada no IP. Se o destino não puder ser verificado, o download não roda.
- **Limite conhecido:** depois do preflight, o `yt-dlp` resolve DNS e segue redirects por conta própria (DNS rebinding, manifestos HLS/DASH apontando para IP interno). O código sozinho não fecha isso. **Obrigatório na infra:** rodar o container em rede sem rota para a rede interna do Coolify e bloquear `169.254.169.254` (e demais faixas privadas) na saída, ou forçar a saída por um proxy que filtre destinos privados.
- Testes: `python -m unittest media-fetcher/test_server.py`.

## Limites

- Vídeo até 15 min com análise visual; acima disso (até 60 min) só o áudio é analisado.
- Total devolvido ≤ 12 MB (limite de 20 MB da requisição inline do Gemini, contando o base64).
- Até 10 imagens por post (carrossel).
- No máximo 2 downloads simultâneos.

## Manutenção

O container atualiza o `yt-dlp` a cada start. Se um site parar de funcionar, reinicie/redeploy o serviço.

## API

`POST /fetch` · header `X-Api-Key` · corpo `{"url": "https://..."}`
→ `{"ok": true, "meta": {title, description, uploader, duration}, "files": [{"mime", "base64"}], "notes": []}`
ou `{"ok": false, "error": "..."}`. `GET /health` para health check.
