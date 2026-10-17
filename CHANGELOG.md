# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [0.3.1] - 2026-10-17

### Adicionado
- **Duplicatas, com decisão do usuário.**
  - Na captura: se o link já foi salvo (comparação normalizada: sem `www`, `utm_`, `#`, barra final; `youtu.be` = `youtube.com/watch?v=`), ele não é gravado e vira um alerta na **central de alertas** (sino no cabeçalho), com as decisões **Ver nota existente / Reprocessar e manter / Ignorar**. Os alertas sobrevivem a recarregar a página.
  - Na ficha da nota: aviso de "Possível duplicata" (mesmo link ou conteúdo muito parecido, similaridade ≥ 90%) com os botões **Ver a outra nota / Manter as duas / Mesclar / Apagar esta**.
  - "Manter as duas" é lembrado e o aviso não volta. "Mesclar" junta conteúdo, tags e entidades na nota mais antiga, registra a origem em `metadata.merged_sources`, apaga a outra e reindexa. Nada é apagado ou fundido sem confirmação.
- **Captura em segundo plano.** Ao clicar em salvar (link, texto, voz ou arquivo) o modal fecha na hora e o processamento segue em segundo plano, com avisos temporários ("processando…", resultado ou erro) no canto da tela. O navegador avisa se a aba for fechada com capturas em andamento.
- Migração `20261017130000_duplicates.sql` (função `brain_url_key`, coluna `source_key`, tabela `brain_duplicate_decisions`, RPCs de busca, decisão e mesclagem).
- **Como aplicar na prática.** A IA escreve até 5 exemplos práticos (menos, ou nenhum, se a nota não sustentar) que combinam as ferramentas, conceitos e códigos da própria nota, sem inventar nada fora dela. Aparecem na ficha, entram na busca e na exportação Markdown. Substitui as "Próximas Ações", que deixam de ser geradas (notas antigas mantêm as suas).
- Migração `20261017140000_practical_examples.sql` (coluna `practical_examples` e RPC `brain_set_practical_examples`). Reindexe a nota ("Reprocessar") para gerar os exemplos de notas antigas.

## [0.3.0] - 2026-10-17

### Adicionado
- **Memória externa fiel:** cada captura passa a ser decomposta em "átomos" de conhecimento (ferramentas, repositórios, links, códigos, comandos, prompts, passos, ideias, pessoas...; tipo aberto) com conteúdo literal, explicação em PT-BR, onde é usado e as perguntas que cada um responde (`brain_atoms`).
- Varredura dos links citados (1 nível, até 5 por item, GitHub via API): o app guarda "o que tem dentro" de cada link, com motivo claro quando não é possível ler. Proteção contra SSRF.
- Cobertura garantida por regra: todo link e bloco de código do texto vira átomo mesmo que a IA esqueça; URLs que a IA inventa são marcadas como "inferidas".
- Busca híbrida (`search_brain`): significado + texto sem acento/plural + nome exato; vários trechos por item.
- Função `brain-ask`: o chat agora entende a pergunta (inclusive continuações), responde de forma concisa em PT-BR só com o que está salvo, cita as notas e remove links que não estão no acervo. Funciona em modo reduzido se a IA estiver fora.
- Função `brain-process` e botões "Indexar agora" / "Reprocessar" para indexar o acervo existente.
- Aba **Conhecimento** (catálogo de ferramentas, links, códigos e ideias, com filtro e botão de copiar) e seção "Conhecimento extraído" na ficha da nota.
- Testes automatizados (`npm test`): migração e busca em Postgres real (PGlite), extração, SSRF, processamento, consulta e Markdown seguro; script `scripts/eval-recall.mjs` para medir a recuperação com os dados reais.

- **Ligações entre notas (estilo Obsidian):** função `brain_item_links` liga notas que citam a mesma ferramenta/link/entidade (linha cheia) e notas de assunto parecido por vetor (linha tracejada). Aparecem no grafo e na seção "Notas relacionadas" da ficha (clicável, com o motivo da ligação).

### Corrigido
- **Grafo de Conexões vazio:** o canvas era medido com a aba oculta (tamanho 0). Agora é remedido ao exibir/redimensionar, pausa quando oculto, usa as cores reais das notas (variáveis CSS não funcionam no canvas), destaca vizinhos ao passar o mouse, funciona com toque e escapa o texto do tooltip.

### Alterado
- n8n: novo nó "Enriquecer Conhecimento" ao final da ingestão (falha dele não perde a captura).

## [Não lançado]

### Adicionado
- Ingestão multimodal completa: sites/artigos (texto extraído da página), YouTube (análise nativa do vídeo pelo Gemini), PDFs e arquivos do Google Drive/Docs/Dropbox por link, e Reels/posts do Instagram, TikTok e similares via novo serviço `media-fetcher/` (yt-dlp + ffmpeg).
- Gravação de voz agora é transcrita pela IA (convertida para WAV no navegador); vídeo adicionado aos tipos de arquivo aceitos.
- "Compartilhar" do celular passa a aceitar arquivos (Web Share Target com POST) e extrai o link de textos compartilhados.
- O campo de título/contexto é enviado ao pipeline; avisos claros quando a IA não consegue acessar o conteúdo.

### Corrigido
- Erro HTTP 500 "invalid syntax" no nó do Gemini (corpo montado com `JSON.stringify`).
- O app mostrava sucesso mesmo quando a análise falhava; o microfone permanecia ligado após a gravação.

## [0.2.1] - 2026-10-14

### Adicionado
- Pipeline de **CI/CD com Auto-Deploy** via GitHub Actions (`.github/workflows/deploy.yml`) integrado à API REST do Coolify.
- Subdomínio personalizado em produção com SSL automático Let's Encrypt: `https://2cerebro.scaladigital.com.br`.
- Configuração de secret seguro `COOLIFY_API_TOKEN` no repositório GitHub para disparo automático a cada push na branch `main`.

## [0.2.0] - 2026-10-14

### Adicionado
- Configuração de deploy em produção para **VPS com Coolify** via `Dockerfile` multi-stage com Nginx Alpine ultra-leve (~15MB RAM).
- Configuração personalizada de `nginx.conf` com fallback para SPA, regras de cache para PWA e compressão gzip.
- Visualizador de **Grafo de Conexões (Graph View)** interativo em HTML5 Canvas nativo com simulação de forças, nós de notas, tags e entidades vinculadas (inspirado em `NoteDiscovery`, `SamurAIGPT` e `Neurite`).
- Suporte a **Estágios do Jardim Digital** (🌱 Semente / 🌿 Broto / 🌳 Evergreen) para maturação do conhecimento (inspirado em `MaggieAppleton/digital-gardeners`).
- Extração de **Próximas Ações Práticas (GTD / Action Items)** com checkboxes interativos no card e no modal (inspirado em `Mindwtr`).
- Extração e navegação de **Entidades e Conceitos Relacionados (`[[Wikilinks]]`)** no estilo Karpathy LLM Wiki (inspirado em `SamurAIGPT` e `eugeniughelbur`).
- Exportador Markdown enriquecido com **Callouts nativos do Obsidian** (`> [!ABSTRACT]`, `> [!CHECKLIST]`, `> [!INFO]`) e propriedades Dataview (inspirado em `Obsidian-Templates` e `zk`).
- Atualização das colunas no Supabase (`stage`, `entities`, `action_items`) com novos índices.
- Atualização do prompt do Gemini no workflow n8n para retorno estruturado de entidades e ações.
- Expansão da skill do Gemini (`skills/second-brain`) com suporte a consultas de ações pendentes.

## [0.1.0] - 2026-10-14

### Adicionado
- Especificação arquitetural do projeto Segundo Cérebro (Second Brain AI) em `./Documentação/DOCUMENTATION.md`.
- Definição e implementação da stack 100% gratuita: Supabase (`pgvector`), n8n (Coolify) e Google Gemini API.
- Execução do schema SQL no Supabase: tabelas `brain_items`, `brain_chunks`, índices HNSW vetoriais e função RPC `match_brain_chunks`.
- Workflow de automação exportado em `n8n/second_brain_workflow.json` para ingestão multimodal com Gemini 2.0 Flash e embeddings `text-embedding-004`.
- Web App PWA construído com Vanilla JS + CSS Glassmorphism + Vite, compatível com Web Share Target do celular (recebimento direto pelo botão Compartilhar).
- Visualizador detalhado de notas com resumo executivo, tópicos centrais, transcrição e exportador `.md` com frontmatter para Obsidian.
- Chat conversacional RAG integrado para busca semântica em tempo real no acervo.
- Skill global do Gemini/Antigravity (`skills/second-brain`) ativada para comandos como "segundo cérebro".


