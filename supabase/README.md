# Supabase do Segundo Cérebro (v0.3)

Tudo o que o Supabase precisa para a memória externa fiel: banco, busca híbrida e as duas funções de IA.

## Como funciona

| Camada | Onde | O que faz |
|---|---|---|
| Fonte | `brain_items.raw_content` | Guarda o original completo (transcrição, texto, arquivo). Nunca é descartado. |
| Compreensão | `brain_items.summary`, `category`, `use_cases` | Resumo em PT-BR, assunto e para que serve. |
| Átomos | `brain_atoms` | Cada coisa dentro do conteúdo: ferramenta, repositório, link, código, comando, prompt, passo a passo, ideia, pessoa... (tipo aberto). Guarda o conteúdo literal, a explicação em PT-BR, onde é usado, as perguntas que responde e o que existe dentro do link varrido. |
| Trechos de busca | `brain_chunks` | Vários trechos por item (resumo, conteúdo, cada átomo), com vetor (768) e índice de texto. |
| Busca | RPC `search_brain` | Fusão de significado (vetor) + texto sem acento/plural + nome exato (RRF). |
| Ligações entre notas | RPC `brain_item_links` | Notas que citam a mesma coisa (ferramenta, link, entidade) e notas de assunto parecido (vetor). Alimenta o grafo e "Notas relacionadas". |
| Gravação | RPC `brain_replace_item_knowledge` | Troca átomos e trechos de um item numa única transação (tudo ou nada). |
| Como aplicar | `brain_items.practical_examples`, RPC `brain_set_practical_examples` | Até 5 exemplos práticos (menos é válido) que combinam o conhecimento da nota. Gravados à parte: se falharem, o conhecimento já salvo não é afetado. |

Funções (Edge Functions, Deno):

- `brain-process`: lê um item, extrai os átomos com o Gemini, completa por regra todo link/código do texto, varre os links (1 nível, até 5 por item, protegido contra SSRF), gera os vetores e grava. Chamada pelo n8n a cada captura e pelo app (botão "Indexar agora" / "Reprocessar").
- `brain-ask`: entende a pergunta (inclusive continuações), busca, responde só com o que está salvo, em PT-BR, e remove qualquer link que não esteja no acervo. Sem IA disponível, devolve uma lista determinística.

Ambas exigem o token do dono (`owner_check`), a mesma regra do RLS.

## Publicar (nesta ordem)

1. **Banco.** Antes, confira se `brain_chunks` não tem outra restrição que impeça vários trechos por item (a migração já remove UNIQUE só em `item_id`): `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.brain_chunks'::regclass;`. Pré-requisito: `supabase/auth_rls.sql` já executado. Depois aplique a migração, por uma das opções:
   - `supabase db push --linked` (revise os arquivos antes), ou
   - cole no SQL Editor do Supabase, **nesta ordem**, `migrations/20261017120000_knowledge_atoms.sql` , `migrations/20261017130000_duplicates.sql` e `migrations/20261017140000_practical_examples.sql`.
2. **Chave do Gemini** (a mesma usada no n8n; não vai para o repositório):
   ```bash
   supabase secrets set GEMINI_API_KEY=SUA_CHAVE --project-ref eicmqisneklcvhakvgce
   ```
   Opcionais: `GEMINI_MODEL` (padrão `gemini-3.8-flash`), `GEMINI_EMBEDDING_MODEL` (padrão `gemini-embedding-001`), `ALLOWED_ORIGINS` (lista separada por vírgula; padrão: só o domínio de produção. Para desenvolvimento local, defina `ALLOWED_ORIGINS=http://localhost:5173`).
3. **Funções:**
   ```bash
   supabase functions deploy brain-ask --use-api --project-ref eicmqisneklcvhakvgce
   supabase functions deploy brain-process --use-api --project-ref eicmqisneklcvhakvgce
   ```
4. **n8n:** reimporte `n8n/second_brain_workflow.json` (só o nó novo "Enriquecer Conhecimento" mudou; as credenciais continuam as mesmas).
5. **App:** publique o frontend (push na `main`). Ao entrar, clique em **Indexar agora** para processar os itens antigos.

## Perguntas frequentes

**Preciso clicar em "Indexar agora" sempre?** Não. Notas novas são indexadas automaticamente pelo n8n. O botão serve para as notas antigas (anteriores à v0.3) e reaparece só se alguma indexação falhar e a nota ficar pendente. Notas com "Falha na indexação" são refeitas pelo botão "Tentar de novo" dentro da nota.

**Apagar uma nota apaga o resto?** Sim: átomos, conteúdo lido dos links, trechos de busca e vetores da nota são apagados em cascata. Outras notas não são afetadas (cada nota tem a sua cópia dos itens). Confira com a consulta do passo 1 que `brain_chunks.item_id` mostra `ON DELETE CASCADE`; sem isso podem sobrar trechos soltos (invisíveis nas buscas, mas ocupando espaço).

**Uma indexação incompleta apaga o que já estava bom?** Não. Se a nota já estava indexada e o reprocessamento terminar incompleto, o conhecimento anterior é mantido.

**E se eu mandar um link repetido ou uma nota parecida?** Link repetido: o app avisa na hora e você escolhe (abrir a existente, salvar mesmo assim ou cancelar). Conteúdo muito parecido (mesmo link salvo antes, ou 90% ou mais de similaridade): a ficha da nota mostra "Possível duplicata" com os botões Ver a outra nota, Manter as duas, Mesclar e Apagar esta. Aulas e notas apenas do mesmo assunto não geram aviso; elas aparecem ligadas no grafo e em "Notas relacionadas". O limite de 90% é uma estimativa; para ajustar, mude `minSimilarity` em `getPossibleDuplicates` (`src/shared/services/supabaseClient.js`).

## Testes locais

```bash
npm test
```

Cobre a migração e a busca em um Postgres real (PGlite com pgvector), a extração de links/código, a proteção SSRF, o orquestrador de processamento, a consulta e o renderizador seguro de Markdown. Não chama o Gemini nem o Supabase de produção.

Avaliação de recuperação com os seus dados reais (precisa de login e da chave já publicada):

```bash
SB_EMAIL=voce@exemplo.com SB_PASSWORD=... node scripts/eval-recall.mjs --sample 30
```

Para cada átomo sorteado, faz uma das perguntas que a IA previu para ele e confere se a nota certa aparece nas fontes. Também roda as perguntas do arquivo `tests/eval/questions.json` (edite com perguntas do seu jeito).

## Limites conhecidos

- "Link na bio" e "link nos comentários" de Reels não vêm no post: o átomo fica marcado como citado sem link.
- Redes sociais e vídeos linkados dentro de uma nota não são varridos (são marcados "link não lido"); capture o link separadamente para o sistema ler.
- Cada item leva de 10 a 60 segundos para indexar (limite de tempo das Edge Functions: 150 s).
- O reprocessamento de uma nota já indexada que terminar incompleto (erro da IA, tempo esgotado) NÃO apaga o conhecimento anterior: a nota fica marcada como falha e dá para tentar de novo.
- Uma nota cujo processamento morre por tempo esgotado 3 vezes seguidas vira "falha" em vez de repetir para sempre.
- Risco aceito: um domínio malicioso poderia mudar de endereço entre a checagem de segurança e o acesso (DNS rebinding). Mitigações: só portas 80/443, só IPs públicos (inclusive IPv6 mapeado), 1 nível de profundidade, e o conteúdo lido só é exibido para o dono. Falha na consulta DNS (A ou AAAA) bloqueia a URL; nunca libera só pelo IPv4.
