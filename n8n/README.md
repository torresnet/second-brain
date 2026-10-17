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
6. **Resposta Imediata**:
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

**Limites:** o n8n aceita payloads de até 16 MB por padrão (`N8N_PAYLOAD_SIZE_MAX`), PDFs/imagens por link até 14 MB, e o proxy do Coolify precisa permitir respostas de até ~5 min (vídeos longos).
