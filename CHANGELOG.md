# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado
- **Página Alertas** (aberta pelo sino no cabeçalho, no lugar da tela "Falhas" e do painel do sino) reúne tudo que pede sua atenção em três abas com contador: **Links repetidos** (decisão pendente na captura), **Notas duplicadas** e **Falhas** (o log de captura de antes, com os mesmos filtros e ações). O sino mostra o total de pendências e abre a primeira aba que tem algo a decidir.
- **Notas duplicadas sem abrir as notas:** a aba lista todos os pares com o mesmo link ou conteúdo quase igual (90% ou mais), com as duas notas lado a lado (mais antiga e mais nova): título, tipo, data, link e resumo (com "Ler tudo"). Dá para **Manter as duas**, **Unificar** (a IA mantém a mais antiga, igual à ficha da nota) ou **Abrir nota**. Nova função `brain_duplicate_pairs` na migration `20261021110000_duplicate_pairs.sql` (aplique no SQL Editor; sem ela a aba avisa que a busca não está disponível).
- **Unificar notas com IA** (antes "Mesclar", que só concatenava os textos). A IA lê as duas notas, junta o que é novo, descarta o que se repete, mantém todos os links e cria um título, resumo e pontos-chave que descrevem a nota inteira. A nota mais antiga é mantida e ganha o selo **Unificada** (na ficha e na lista) com a seção "Unificada a partir de N notas", que lista os títulos e os links das fontes. O texto original das duas notas fica guardado em `metadata.merged_sources` e nada que a IA descartou volta como item extraído. Se a IA devolver um texto bem menor que a maior nota, o texto completo das duas é mantido; notas grandes demais (acima de 45 mil caracteres somadas) unificam só título, resumo e pontos-chave; links que a IA esquecer são anexados ao final. **Sem cota da IA** (429) ou com ela sobrecarregada (5xx), o pedido espera na fila (selo "Unificação na fila") e a indexação em segundo plano o conclui quando a cota voltar. Migration `20261020110000_unify_notes.sql` (requer redeploy das Edge Functions `brain-process` e `brain-index-worker`).

### Alterado
- **Aba Conexões reformulada:** a animação para quando o grafo assenta (antes rodava sem parar), a repulsão usa grade espacial (custo ~linear) e as posições são lembradas entre recargas. Zoom segue o cursor, pinça e botões +/− no celular, "Enquadrar tudo", rótulos só das notas mais ligadas (todos ao aproximar), nós maiores com mais ligações, linhas mais grossas para ligações mais fortes, legenda com as cores reais dos tipos, "Ocultar soltas", controle de semelhança mínima, busca no grafo, tags e entidades clicáveis (com "Filtrar o Acervo por esta tag"), painel de detalhes ao tocar (duplo clique abre a nota), grafo local de 1 ou 2 passos (também pelo botão "Ver conexões" da nota), opção "Só filtro do Acervo", painel de insights (mais conectadas, grupos de assunto, "Talvez ligar", soltas), aviso com "Tentar de novo" quando as ligações falham ao carregar, respeito a movimento reduzido e preferências lembradas entre visitas. No celular o grafo ocupa quase a tela inteira, os filtros abrem num cartão flutuante, a legenda rola numa linha e o painel vira uma gaveta inferior (insights ou detalhes da nota selecionada).
- **Perguntar em tela cheia no celular:** no celular a conversa passa a ocupar a tela inteira (70% a 85% de área de leitura, antes ~40%). Some o cabeçalho global e o botão "+", sobra uma barra de 44px (voltar, título, limpar), as mensagens e o campo de digitação, cada um na sua linha do grid. Isso acaba com a sobreposição do "+" sobre o botão de enviar e do campo sobre a barra de abas. Os atalhos viram uma faixa rolável e somem após a primeira pergunta. O campo cresce até 4 linhas e a barra de abas sai enquanto o teclado está aberto. O desktop não mudou.
- **Topo da nota:** a origem aparece logo abaixo do título (link original, ou "Arquivo enviado: nome", "Gravação de voz", "Anotação de texto" quando não há link) e, logo abaixo, a situação da indexação com o **motivo da falha** e o botão "Indexar agora" / "Indexar novamente" (antes ficavam escondidos na seção "Extraído do conteúdo", sem dizer o porquê).
- **"Próximas ações" virou "Como aplicar na prática":** até 5 exemplos práticos reais (menos é válido). A captura no n8n já gera os exemplos (`practical_examples`) na primeira passada, e a indexação os refina; notas antigas mostram as ações antigas no mesmo formato até serem reprocessadas. O .md exportado segue o mesmo formato.

### Corrigido
- **Reels/TikTok sem análise ("getaddrinfo ENOTFOUND media-fetcher")**: o n8n roda em outra rede Docker e o nome curto `media-fetcher` nunca resolveu, então nenhuma captura de rede social chegou ao fetcher. `mediaFetcherUrl` passa a usar o endereço do recurso no Coolify, e o nó tenta de novo uma vez em falha de rede.
- **Gemini 503 ("This model is currently experiencing high demand")**: o principal tenta 3 vezes com 5 s de intervalo; qualquer falha (não só cota) desvia para a reserva, que usa o modelo alternativo `geminiFallbackModel` (`gemini-flash-lite-latest`) quando o erro não é de cota. O nó "Cota do Gemini estourou?" virou "Gemini falhou?".
- A nota não mostra mais o JSON cru da API: o erro vira uma frase ("a IA está sobrecarregada...") com a dica de usar "Reprocessar".
- **Regressão de segurança restaurada**: a exportação do fluxo na v0.4.2 tinha apagado o nó "Exigir Token", a proteção SSRF do "Preparar Conteúdo" e a restrição de CORS (voltou a aceitar `localhost`). Os três voltam, com a validação de URL reescrita sem `new URL()` (ausente no sandbox do n8n) e recusando `\`, `@`, `%` e espaços no endereço. Os testes de SSRF rodam o nó com `URL` indefinido e localizam os nós pelo nome, não pelo ID.
- **Carrossel de imagens do Instagram** ("Não foi possível acessar ou extrair..."): o yt-dlp abortava com "No video formats found" em posts só de fotos. O media-fetcher agora baixa as imagens do carrossel (`--ignore-no-formats-error --write-thumbnail`) e descarta a capa dos vídeos. **Requer redeploy do media-fetcher.**
- O nome do arquivo enviado (`metadata.extracted_from_file`) nunca era gravado: o nó "Montar Requisição Gemini" não o repassava ao "Parse".

## [0.5.0] - 2026-10-18

### Adicionado
- **Log de falhas da captura.** Toda falha ou aviso na captura de links, YouTube, Reels, PDFs, áudio, imagem e vídeo passa a ser gravado na nova tabela `capture_errors` (migration `20261018100000_capture_errors.sql`, acesso só do dono via RLS), com etapa (envio, download da mídia, IA, índice de busca, leitura de links, salvamento), categoria (cota, tempo esgotado, rede, HTTP, sessão, conteúdo ilegível, formato não suportado), tipo de mídia, nota relacionada e detalhes técnicos.
- **Tela "Falhas"** (barra lateral e barra inferior) com contador de pendências, filtros por situação, gravidade e etapa, ação de marcar como resolvida/reabrir, abrir a nota, copiar diagnóstico, resolver tudo e apagar as resolvidas.
- **Media-fetcher com log estruturado** (sucesso, falha e erro inesperado, com tempo e só host/caminho do link, sem query string nem credenciais). Antes não deixava nenhum rastro.
- O erro real da conversão de áudio gravado deixa de ser engolido e vai para o log.

### Segurança
- Tokens, chaves de API e query strings são removidos de mensagens e detalhes antes de gravar no log (cliente e Edge Function).

## [0.4.2] - 2026-10-17

### Corrigido
- **Erros da IA não vazam mais para a tela.** Limite de uso (HTTP 429), sobrecarga, tempo esgotado e falha de rede viram uma frase curta em português, sem URLs nem texto do provedor (toasts, ficha da nota e Edge Functions).
- **Link sem conteúdo não vira "Indexada".** Notas capturadas sem o conteúdo do link (tags `conteudo-inacessivel`/`erro-extracao`) terminam como falha explicando o motivo, sem gastar cota da IA, e ficam fora das respostas do Perguntar.
- **Perguntar (modo reduzido)** não lista mais notas ilegíveis antes das relevantes.
- **Conexões** mostra o acervo inteiro mesmo com filtro ou busca ativos na lista (antes dizia "1 nota(s)").
- **Central de alertas** não é mais cortada pela barra lateral e posiciona-se a partir do sino.
- Os avisos de captura ficam acima da barra de pergunta do chat no desktop e a dica de erro da ficha quebra linha no celular.
- A versão exibida na barra lateral vem do `package.json` (estava fixa em v0.4.0).

## [0.4.1] - 2026-10-17

### Corrigido
- O service worker nunca era registrado em produção (caminho `/public/sw.js` não existe no build); com isso o "Compartilhar" do celular também não funcionava.

### Segurança
- O setup (`auth_rls.sql`) não recomenda mais um MFA que o app não usa: o acesso é por e-mail e senha.
- **media-fetcher:** o `yt-dlp` só é usado em plataformas conhecidas e sem o extrator genérico; os demais links são baixados direto, com o IP validado fixado (fecha SSRF para a rede interna).
- `scripts/egress-firewall.sh`: regras de firewall para o servidor que impedem o media-fetcher e o n8n de abrir conexões para a rede interna (DNS rebinding).
- `brain-process` não devolve mais mensagens de erro do banco ao cliente (ficam no log).
- Removida a busca legada `match_brain_chunks` (migração `20261017150000_security_hardening.sql`) e o código morto que a chamava; o service worker não pré-preenche mais a captura a partir de links externos para `/share-target`.

## [0.4.0] - 2026-10-17

### Alterado
- **Novo visual "Biblioteca silenciosa".** Interface neutra e tipográfica (Geist), uma única cor de destaque e cor apenas no tipo de mídia. Sai o gradiente ciano-violeta, o vidro fosco e os emojis, que viram ícones de traço.
- **Tema claro e escuro**, seguindo o sistema, com botão para fixar claro, escuro ou automático (o grafo acompanha o tema).
- **Barra lateral** com Acervo, Conhecimento, Conexões e Perguntar, filtros por tipo e por tema (tags mais usadas) com contagem. Os 4 cards de métricas saíram do topo; o total fica ao lado de "Acervo".
- **Lista + painel de leitura.** A nota abre ao lado da lista, sem cobrir nada; ↑/↓ (ou j/k) trocam de nota. Em telas estreitas e fora do Acervo a ficha continua abrindo como janela (no celular, folha que sobe da base).
- Ficha reorganizada: resumo, pontos-chave e o conhecimento extraído primeiro; transcrição recolhida.
- Celular: barra de navegação inferior e botão flutuante de captura.
- Esqueleto de carregamento no lugar do texto "Carregando…".

### Adicionado
- **Barra de comando (Ctrl K ou /).** Uma caixa para tudo: colar um link captura em segundo plano, uma pergunta vai para o chat, um termo busca no acervo e já lista as notas que combinam. Também abre a captura de anotação, voz e arquivo.
- **Vale rever hoje.** No topo do acervo, até 3 notas salvas há mais de 7 dias e não abertas nas últimas 3 semanas (favoritas primeiro). "Já revi" tira a nota da lista. O registro de aberturas fica neste aparelho.

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


