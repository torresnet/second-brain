# Media Fetcher

Serviço auxiliar do pipeline de ingestão. O n8n chama `POST /fetch` quando o link é de uma rede social
(Instagram, TikTok, Facebook, X, Vimeo...) ou um vídeo/áudio grande demais para ir direto ao Gemini.
O serviço baixa a mídia com **yt-dlp** (plataformas conhecidas) ou por download direto (demais links), comprime com **ffmpeg** para caber em ~12 MB e devolve em base64.

## Deploy no Coolify

1. Novo recurso → Dockerfile → este repositório, _Base Directory_ `/media-fetcher`.
2. Variável de ambiente obrigatória: `FETCHER_API_KEY` (um segredo longo e aleatório).
3. A URL precisa ser resolvível **a partir do container do n8n**. No Coolify o n8n (serviço) fica numa rede própria e não enxerga o nome `media-fetcher`, então hoje usamos o domínio do recurso (`http://<uuid>.<ip>.sslip.io`), protegido pela `X-Api-Key`. Para tirar do ar público: ative "Connect to Predefined Network" no serviço do n8n, dê ao fetcher o alias de rede `media-fetcher`, remova o domínio dele e volte `mediaFetcherUrl` para `http://media-fetcher:8080`.
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
- O `yt-dlp` só roda quando o link original **e** o destino final validado são de plataformas conhecidas (`TRUSTED_MEDIA_HOSTS` em `server.py`: Instagram, TikTok, YouTube, X, Vimeo, Google Drive...) e sempre com o extrator genérico desligado (`--use-extractors default,-generic`), para não seguir vídeos embutidos em páginas arbitrárias. Qualquer outro link é baixado direto, com conexão fixada no IP validado.
- Camada extra na infra (recomendada): `scripts/egress-firewall.sh` bloqueia conexões novas deste container para faixas privadas e para o serviço de metadados da nuvem.
- Testes: `python -m unittest media-fetcher/test_server.py`.

## Limites

- Vídeo até 15 min com análise visual; acima disso (até 60 min) só o áudio é analisado.
- Total devolvido ≤ 12 MB (limite de 20 MB da requisição inline do Gemini, contando o base64).
- Até 10 imagens por post (carrossel).
- No máximo 2 downloads simultâneos.

## Manutenção

A versão do `yt-dlp` é fixa (`YTDLP_VERSION` no Dockerfile). Se um site parar de funcionar, atualize essa versão e faça redeploy.

## API

`POST /fetch` · header `X-Api-Key` · corpo `{"url": "https://..."}`
→ `{"ok": true, "meta": {title, description, uploader, duration}, "files": [{"mime", "base64"}], "notes": []}`
ou `{"ok": false, "error": "..."}`. `GET /health` para health check.
