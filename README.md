# 🧠 Segundo Cérebro AI (Second Brain)

Um ecossistema pessoal inteligente de captura, organização cognitiva e recuperação multimodal de conhecimento (Reels do Instagram, vídeos do YouTube, podcasts de áudio, PDFs e anotações).

---

## 🏛️ Arquitetura (100% Free Tier)

- **Banco de Dados & RAG:** Supabase com extensão `pgvector` e índice acelerador HNSW.
- **Ingestão Multimodal:** n8n (no Coolify) orquestrando chamadas ao **Google Gemini 2.0 Flash** e embeddings com `text-embedding-004`.
- **Frontend / PWA:** Vanilla JS + CSS Glassmorphism + Vite com suporte a **Web Share Target API** (compartilhar direto do celular), **Grafo de Conexões interativo**, estágios do **Jardim Digital** (🌱, 🌿, 🌳), **Ações Práticas (GTD)** e exportador para **Obsidian (.md)**.
- **Skill IA:** Habilidade nativa para Gemini CLI / Antigravity em `.agents/skills/second-brain/SKILL.md`.

---

## 🚀 Como Executar Localmente

```bash
# 1. Instalar dependências
npm install

# 2. Rodar em modo de desenvolvimento
npm run dev

# 3. Compilar bundle de produção
npm run build
```

---

## 🐳 Deploy na VPS com Coolify

Este repositório já contém `Dockerfile` e `nginx.conf` prontos:
1. No painel do Coolify, clique em **+ New Resource** -> **Application**.
2. Selecione este repositório (`torresnet/second-brain`).
3. Build Pack: **Dockerfile**.
4. Defina o seu domínio com HTTPS (ex: `brain.seudominio.com`) e clique em **Deploy**.

---

## 📄 Documentação & Versões

- [DOCUMENTATION.md](./Documentação/DOCUMENTATION.md): Especificação arquitetural completa.
- [CHANGELOG.md](./CHANGELOG.md): Histórico de versões SemVer.
