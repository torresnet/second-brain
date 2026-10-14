# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

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


