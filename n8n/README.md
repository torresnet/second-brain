# ⚡ Workflow de Ingestão do Segundo Cérebro (n8n)

Este workflow é o motor de ingestão inteligente que roda no seu servidor Coolify e automatiza todo o processamento multimodal gratuito.

---

## 🛠️ O que este Workflow faz:

1. **Webhook Receptor (`POST /webhook/second-brain-capture`)**:
   - Recebe links (Instagram Reels, YouTube, TikTok, artigos, PDFs), gravações de voz ou anotações rápidas.
2. **Classificador de Mídia**:
   - Identifica automaticamente o formato e a origem da entrada.
3. **Analisador Cognitivo (Google Gemini)**:
   - "Lê" e "escuta" o conteúdo.
   - Gera um JSON estruturado com: Título, Resumo Executivo, Pontos-Chave (*key takeaways*), Transcrição/conteúdo bruto e Tags sugeridas.
4. **Gerador de Embeddings (`gemini-embedding-001`)**:
   - Cria o vetor de 768 dimensões com base no significado semântico do item.
5. **Gravação no Supabase (`Second-Brain`)**:
   - Insere o item catalogado na tabela `public.brain_items`.
   - Insere o vetor semântico na tabela `public.brain_chunks`.
6. **Enriquecimento de Conhecimento (`Enriquecer Conhecimento`, v0.3)**:
   - Chama a função `brain-process` do Supabase para extrair ferramentas, links, códigos e ideias da nota, varrer os links citados e refazer o índice de busca.
   - Se falhar (Gemini fora do ar, tempo esgotado), a captura **não se perde**: a nota fica "pendente" e o app oferece "Indexar agora" / "Tentar de novo".
   - Usa a credencial `Supabase Anon Key` (a mesma dos outros nós) e o token do usuário vindo do webhook. A chave do Gemini dessa etapa fica nas secrets do Supabase (`GEMINI_API_KEY`), não no n8n.
7. **Resposta Imediata**:
   - Devolve confirmação em JSON para o PWA ou Telegram informando o sucesso da catalogação.

---

## 🚀 Como Importar no seu n8n:

1. Acesse o seu painel do **n8n** no navegador.
2. No canto superior direito, clique em **Add Workflow** (ou nos três pontinhos `...` -> **Import from File**).
3. Selecione o arquivo `second_brain_workflow.json` desta pasta (ou copie e cole o código JSON).
4. **Criar as 3 credenciais** (tipo **Header Auth**, em Credentials) e selecioná-las nos nós indicados:
   - `Gemini API Key`: Name = `x-goog-api-key`, Value = sua chave do [Google AI Studio](https://aistudio.google.com/). Nós: *Credencial Gemini* e *Gerar Embedding*.
   - `Supabase Anon Key`: Name = `apikey`, Value = a anon key do projeto Supabase. Nós: *Credencial Supabase*, *Salvar no Supabase (brain_items)* e *Salvar Embedding no Supabase*.
   - `Media Fetcher Key`: Name = `X-Api-Key`, Value = o `FETCHER_API_KEY` do serviço [`media-fetcher/`](../media-fetcher/README.md). Nó: *Media Fetcher*. No nó *Configuração*, ajuste `mediaFetcherUrl`.
   - O dono do cérebro é definido no banco (`supabase/auth_rls.sql`); o n8n não precisa do UUID.
5. Clique em **Save** e ative o switch para **Active**.
   - Atualizando da v0.2: basta reimportar o arquivo; só o nó "Enriquecer Conhecimento" é novo. Antes, publique as funções do Supabase (veja [`supabase/README.md`](../supabase/README.md)).
6. Copie a URL do Webhook de Produção gerada no primeiro nó.

---

## 🧭 Como cada entrada é tratada

| Entrada | Tratamento |
|---|---|
| YouTube | O Gemini assiste ao vídeo pela URL (áudio + imagem). Só vídeos públicos. |
| Site / artigo | O n8n baixa o HTML e extrai o texto; o Gemini analisa o texto. |
| PDF, imagem, áudio, vídeo por link (inclui Google Drive/Docs e Dropbox públicos) | O n8n baixa o arquivo e o envia ao Gemini. |
| Instagram, TikTok, Facebook, X, Vimeo... | O `media-fetcher` baixa e comprime a mídia (Instagram costuma exigir cookies). |
| Vídeo/áudio grande por link | Reencaminhado ao `media-fetcher` para compressão. |
| Arquivo do celular / voz | Enviado em base64 (até 10 MB). |

Se algo não puder ser acessado, o item é salvo na caixa de entrada com um aviso e o app informa o motivo.

## 🔒 Segurança do pipeline

- **Token primeiro:** o nó *Exigir Token* recusa na hora requisições sem `Authorization: Bearer`, antes de qualquer chamada ao Supabase. Depois, *Verificar Dono* confirma o dono via `owner_check`.
- **SSRF:** o nó *Preparar Conteúdo* só busca a internet pública: bloqueia IPs privados/loopback/link-local/metadata (v4 e v6), nomes internos (`media-fetcher`, `localhost`, `*.internal`), credenciais na URL e portas fora de 80/443, resolve o DNS por DoH e revalida cada redirecionamento (no máximo 3, sem follow automático). Os testes em `tests/unit/n8n-ssrf.test.mjs` executam o código real do nó.
- **Limite conhecido (DNS rebinding):** a checagem resolve o DNS por DoH e o `httpRequest` do n8n resolve de novo depois, então um domínio com TTL 0 pode apontar para IP interno entre as duas. O mesmo vale para as Edge Functions (risco aceito em `supabase/README.md`). A mitigação real é de rede: bloquear no firewall a saída do n8n para faixas privadas e para `169.254.169.254`.
- **CORS:** o webhook só aceita a origem de produção. Para testar localmente, adicione `http://localhost:5173` à mão no nó *Webhook Captura* e não reimporte esse ajuste para produção.
- **Rate limit (infra):** o n8n não limita taxa. Configure no proxy do Coolify/Traefik um limite por IP para `/webhook/second-brain-capture` (ex.: 30 req/min) e mantenha `N8N_PAYLOAD_SIZE_MAX` no mínimo necessário (16 MB cobre o arquivo de 10 MB do app em base64).
- **Rede:** o container do n8n não deve alcançar o painel do Coolify nem o endpoint de metadados da nuvem (`169.254.169.254`); bloqueie no firewall do host.

**Limites:** o n8n aceita payloads de até 16 MB por padrão (`N8N_PAYLOAD_SIZE_MAX`), PDFs/imagens por link até 14 MB, e o proxy do Coolify precisa permitir respostas de até ~5 min (vídeos longos).
