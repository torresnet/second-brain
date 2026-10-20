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

1. **Banco.** Antes, confira se `brain_chunks` não tem outra restrição que impeça vários trechos por item (a migração já remove UNIQUE só em `item_id`): `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.brain_chunks'::regclass;`. Pré-requisito: execute `supabase/auth_rls.sql` no SQL Editor trocando o UUID de zeros pelo User UID do dono (o script aborta se não trocar; o dono fica na tabela `brain_owner`, não dentro da função). Depois desative "Allow new users to sign up" em Authentication. Em seguida aplique as migrações, por uma das opções:
   - `supabase db push --linked --include-all` (revise os arquivos antes; `--include-all` é necessário porque `20261017110000_base_schema_rls.sql` é anterior às já aplicadas), ou
   - cole no SQL Editor do Supabase, **nesta ordem**, `migrations/20261017110000_base_schema_rls.sql` (idempotente: cria o esquema base se faltar e reaplica o RLS e os grants, inclusive de `match_brain_chunks`), `migrations/20261017120000_knowledge_atoms.sql` , `migrations/20261017130000_duplicates.sql`, `migrations/20261017140000_practical_examples.sql` `migrations/20261017150000_security_hardening.sql` (remove a busca legada `match_brain_chunks`) e `migrations/20261018100000_capture_errors.sql` (log de falhas da captura, exibido na tela **Falhas**).
2. **Chave do Gemini** (a mesma usada no n8n; não vai para o repositório):
   ```bash
   supabase secrets set GEMINI_API_KEY=SUA_CHAVE --project-ref eicmqisneklcvhakvgce
   ```
   Chave reserva (opcional): `GEMINI_API_KEY_2`, de **outro projeto** do AI Studio (a cota é por projeto). Só é usada quando a principal responde 429 (cota estourada); depois disso a execução segue nela. Use a mesma chave da credencial reserva do n8n.
   ```bash
   supabase secrets set GEMINI_API_KEY_2=SUA_CHAVE_RESERVA --project-ref eicmqisneklcvhakvgce
   ```
   Depois de definir o secret, publique as funções de novo (`brain-process` e `brain-ask`).

   Opcionais: `GEMINI_MODEL` (padrão `gemini-3.8-flash`), `GEMINI_EMBEDDING_MODEL` (padrão `gemini-embedding-001`), `ALLOWED_ORIGINS` (lista separada por vírgula; padrão: só o domínio de produção. Para desenvolvimento local, defina `ALLOWED_ORIGINS=http://localhost:5173`).
3. **Funções:**
   ```bash
   supabase functions deploy brain-ask --use-api --project-ref eicmqisneklcvhakvgce
   supabase functions deploy brain-process --use-api --project-ref eicmqisneklcvhakvgce
   ```
4. **n8n:** reimporte `n8n/second_brain_workflow.json` (só o nó novo "Enriquecer Conhecimento" mudou; as credenciais continuam as mesmas).
5. **App:** publique o frontend (push na `main`). Ao entrar, clique em **Indexar agora** para processar os itens antigos.

## Indexação em segundo plano (sem o app aberto)

Notas importadas do Obsidian (ou que o n8n não conseguiu indexar) ficam `pending`. O pg_cron chama a função `brain-index-worker` a cada 2 minutos; ela indexa até 5 notas por rodada, para na cota do Gemini e retoma sozinha na rodada seguinte. Ativação, uma única vez: publique a função `brain-index-worker` (sem verificação de JWT: `supabase functions deploy brain-index-worker --use-api --no-verify-jwt --project-ref eicmqisneklcvhakvgce`) e aplique a migração `20261020100000_background_indexing.sql`. A migração gera o segredo do agendador dentro do Vault (ele nunca aparece no código nem em variáveis de ambiente) e agenda o job. Para pausar: `select cron.unschedule('brain-background-indexing');`.

Acompanhar: `select * from cron.job_run_details order by start_time desc limit 10;` e o contador de pendentes no app. O botão "Indexar agora" continua funcionando; ambos usam a mesma reserva (`brain_claim_item`), então nunca processam a mesma nota ao mesmo tempo.

## Perguntas frequentes

**Preciso clicar em "Indexar agora" sempre?** Não. Notas novas são indexadas automaticamente pelo n8n. O botão serve para as notas antigas (anteriores à v0.3) e reaparece só se alguma indexação falhar e a nota ficar pendente. Notas com "Falha na indexação" são refeitas pelo botão "Tentar de novo" dentro da nota.

**Apagar uma nota apaga o resto?** Sim: átomos, conteúdo lido dos links, trechos de busca e vetores da nota são apagados em cascata. Outras notas não são afetadas (cada nota tem a sua cópia dos itens). Confira com a consulta do passo 1 que `brain_chunks.item_id` mostra `ON DELETE CASCADE`; sem isso podem sobrar trechos soltos (invisíveis nas buscas, mas ocupando espaço).

**Uma indexação incompleta apaga o que já estava bom?** Não. Se a nota já estava indexada e o reprocessamento terminar incompleto, o conhecimento anterior é mantido.

**E se eu mandar um link repetido ou uma nota parecida?** Link repetido: o app avisa na hora e você escolhe (abrir a existente, salvar mesmo assim ou cancelar). Conteúdo muito parecido (mesmo link salvo antes, ou 90% ou mais de similaridade): a ficha da nota mostra "Possível duplicata" com os botões Ver a outra nota, Manter as duas, Unificar e Apagar esta. **Unificar** guarda o texto original das duas notas (`metadata.merged_sources`) e deixa um pedido na nota mais antiga (`metadata.pending_unify`); a indexação em segundo plano pede à IA para ler as duas, tirar o que se repete, manter todos os links e criar um título novo. Sem cota da IA, o pedido espera na fila e termina sozinho. A nota ganha o selo **Unificada** e a lista de fontes. Aulas e notas apenas do mesmo assunto não geram aviso; elas aparecem ligadas no grafo e em "Notas relacionadas". O limite de 90% é uma estimativa; para ajustar, mude `minSimilarity` em `getPossibleDuplicates` (`src/shared/services/supabaseClient.js`).

## Testes locais

```bash
npm test
```

Cobre o RLS com o SQL real (dono, outro usuário e anon em todas as tabelas e funções), a migração e a busca em um Postgres real (PGlite com pgvector), a extração de links/código, a proteção SSRF, o orquestrador de processamento, a consulta e o renderizador seguro de Markdown. Não chama o Gemini nem o Supabase de produção.

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
- Risco aceito (Edge Function `brain-process`): um domínio malicioso poderia mudar de endereço entre a checagem de segurança e o acesso (DNS rebinding); o `fetch` do Deno não permite fixar o IP já validado. A função roda na infraestrutura do Supabase, sem acesso à rede do seu servidor. No n8n, o mesmo risco é fechado na infra com `scripts/egress-firewall.sh`. Mitigações: só portas 80/443, só IPs públicos (inclusive IPv6 mapeado), 1 nível de profundidade, e o conteúdo lido só é exibido para o dono. Falha na consulta DNS (A ou AAAA) bloqueia a URL; nunca libera só pelo IPv4.
