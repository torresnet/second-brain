# ⚡ Workflow de Ingestão do Segundo Cérebro (n8n)

Este workflow é o motor de ingestão inteligente que roda no seu servidor Coolify e automatiza todo o processamento multimodal gratuito.

---

## 🛠️ O que este Workflow faz:

1. **Webhook Receptor (`POST /webhook/second-brain-capture`)**:
   - Recebe links (Instagram Reels, YouTube, TikTok, artigos, PDFs), gravações de voz ou anotações rápidas.
2. **Classificador de Mídia**:
   - Identifica automaticamente o formato e a origem da entrada.
3. **Analisador Cognitivo (Google Gemini 2.0 Flash)**:
   - "Lê" e "escuta" o conteúdo.
   - Gera um JSON estruturado com: Título, Resumo Executivo, Pontos-Chave (*key takeaways*), Transcrição/conteúdo bruto e Tags sugeridas.
4. **Gerador de Embeddings (`text-embedding-004`)**:
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
4. **Configurar a Gemini API Key**:
   - No Coolify (nas variáveis de ambiente do n8n) ou nas credenciais do n8n, certifique-se de configurar a variável `GEMINI_API_KEY` com sua chave gratuita do [Google AI Studio](https://aistudio.google.com/).
5. Clique em **Save** e ative o switch para **Active**.
6. Copie a URL do Webhook de Produção gerada no primeiro nó.
