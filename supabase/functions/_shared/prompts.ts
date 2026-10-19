// Prompts (em PT-BR) usados pelas funções. Ficam isolados para serem revisados e testados.

import type { Atom } from './atoms.ts';
import { truncate } from './text.ts';

export interface PromptItem {
  title: string | null;
  source_type: string | null;
  source_url: string | null;
  summary: string | null;
  tags: string[] | null;
}

export function buildAtomizePrompt(item: PromptItem, windowText: string, index: number, total: number): string {
  return `Você é o indexador de um Segundo Cérebro pessoal: a memória externa fiel de uma pessoa. Seu trabalho é extrair, do material abaixo, TUDO o que ela poderia querer consultar no futuro, como "átomos" (itens discretos e independentes). Nada útil pode se perder.

MATERIAL${total > 1 ? ` (parte ${index + 1} de ${total})` : ''}
Título: ${item.title ?? '(sem título)'}
Tipo: ${item.source_type ?? 'nota'}
Origem: ${item.source_url ?? '(sem link)'}
Resumo já existente: ${truncate(item.summary ?? '', 1500) || '(nenhum)'}
Tags existentes: ${(item.tags ?? []).join(', ') || '(nenhuma)'}

CONTEÚDO COMPLETO:
"""
${windowText}
"""

O QUE EXTRAIR (um átomo para cada coisa distinta; o tipo "kind" é livre, em minúsculas, sem acento, ex.: ferramenta, repositorio, biblioteca, skill, plugin, mcp, api, servico, link, codigo, comando, prompt, passo-a-passo, configuracao, formula, dado, pessoa, empresa, conceito, recomendacao, ideia, referencia, curso, livro, receita — use o tipo que melhor descrever):
- Toda ferramenta, app, biblioteca, repositório, skill, plugin, MCP, API, serviço ou site mencionado (mesmo citado de passagem).
- Todo link, URL ou domínio que aparece escrito, mostrado na tela ou falado.
- Todo trecho de código, comando de terminal, prompt, configuração, fórmula, lista de passos ou valor/número importante.
- Pessoas, empresas, conceitos, métodos, ideias, recomendações e referências relevantes.

REGRAS OBRIGATÓRIAS
1. NUNCA invente. Só registre o que está no material. Se algo não está claro, omita.
2. "url": preencha SOMENTE se o endereço aparece no material (escrito, mostrado ou falado de forma inequívoca). Se a ferramenta é citada sem endereço, use null. Jamais adivinhe uma URL.
3. "content": para código, comando, prompt, configuração, passos e valores, copie o texto LITERALMENTE, sem resumir nem corrigir. Para os demais tipos, use null.
4. "explanation": em português do Brasil, explique o que é / o que faz. Para código e comandos, explique o que cada parte importante faz.
5. "use_for": em português do Brasil, para que serve, quando usar e ONDE é usado (em que contexto, projeto, ferramenta ou etapa). Para código, diga em que situação ele é executado.
6. "questions": 3 a 6 perguntas, em português do Brasil, que este átomo responde, escritas do jeito que a pessoa perguntaria de formas variadas (pelo objetivo, pela capacidade, pelo nome, pelo problema).
7. Todo texto (explanation, use_for, questions, tags) em português do Brasil, mesmo que a fonte esteja em outro idioma. Nomes próprios, comandos e código ficam no original.
8. "name": curto e específico (nome da ferramenta, título do passo a passo, o que o código faz).
9. "where": momento (ex.: "02:15") ou página, se souber; senão null.
10. "category": uma palavra (ex.: ia, marketing, automacao, desenvolvimento, design, video, vendas, negocios, produtividade, financas, saude, educacao, outro). "use_cases": 3 a 8 objetivos práticos para os quais este material serve (ex.: "atendimento de clientes no WhatsApp", "criar um CRM").

Responda ESTRITAMENTE em JSON neste formato:
{
  "category": "ia",
  "use_cases": ["..."],
  "atoms": [
    {
      "kind": "ferramenta",
      "name": "...",
      "content": null,
      "explanation": "...",
      "use_for": "...",
      "url": null,
      "language": null,
      "questions": ["..."],
      "tags": ["..."],
      "where": null
    }
  ]
}`;
}

export function buildHeadlinePrompt(content: string, wantTitle: boolean): string {
  return `Você nomeia e resume anotações de um Segundo Cérebro pessoal. Leia a anotação abaixo e devolva os campos pedidos, em português do Brasil, usando SOMENTE o que está escrito nela (nunca invente).

ANOTAÇÃO:
"""
${truncate(content, 6000)}
"""

CAMPOS
${wantTitle ? '- "title": título curto (3 a 8 palavras) que diga sobre o que a anotação trata, sem aspas e sem ponto final.\n' : ''}- "summary": 1 a 2 frases objetivas dizendo o que a anotação contém.
- "key_takeaways": de 2 a 6 pontos-chave, cada um uma frase curta e completa com uma ideia, decisão, fato ou ação da anotação. Não copie o começo do texto: sintetize. Se a anotação for muito curta, devolva só 1 ou 2 pontos.

Responda ESTRITAMENTE em JSON: {${wantTitle ? '"title":"...",' : ''}"summary":"...","key_takeaways":["..."]}`;
}

export interface PageToSummarize {
  n: number;
  url: string;
  title: string;
  text: string;
}

export function buildLinkSummaryPrompt(pages: PageToSummarize[]): string {
  const blocks = pages
    .map(p => `### LINK ${p.n}\nEndereço: ${p.url}\nTítulo: ${p.title || '(sem título)'}\nConteúdo lido:\n"""\n${truncate(p.text, 6000)}\n"""`)
    .join('\n\n');
  return `Você descreve o conteúdo de links para um Segundo Cérebro pessoal. Para cada link abaixo, escreva em português do Brasil o que realmente existe dentro dele, usando SOMENTE o conteúdo lido (nunca complete com conhecimento próprio).

${blocks}

Para cada link devolva:
- "summary": 2 a 4 frases objetivas: o que é, o que oferece/ensina e para que serve.
- "name": nome oficial da ferramenta, projeto ou página (curto).
- "kind": tipo livre em minúsculas sem acento (ferramenta, repositorio, biblioteca, documentacao, artigo, servico, curso...).

Responda ESTRITAMENTE em JSON: {"pages":[{"n":1,"summary":"...","name":"...","kind":"..."}]}`;
}

export function buildExamplesPrompt(item: PromptItem, atoms: Atom[], useCases: string[]): string {
  const inventory = atoms
    .slice(0, 40)
    .map(a => `- [${a.kind}] ${a.name}: ${truncate(a.explanation || a.contents_summary || '', 220)}${a.use_for ? ` | serve para: ${truncate(a.use_for, 160)}` : ''}${a.url ? ` | ${a.url}` : ''}`)
    .join('\n');

  return `Você ajuda a pessoa a LEMBRAR e USAR o que guardou no Segundo Cérebro dela. Com base SOMENTE no material abaixo, escreva exemplos práticos de como aplicar esse conhecimento, combinando as ferramentas, conceitos, códigos e ideias da nota.

NOTA
Título: ${item.title ?? '(sem título)'}
Resumo: ${truncate(item.summary ?? '', 1500) || '(nenhum)'}
Serve para: ${useCases.join('; ') || '(não informado)'}

O QUE A NOTA CONTÉM
${inventory || '(nenhum item extraído)'}

REGRAS OBRIGATÓRIAS
1. Escreva ATÉ 5 exemplos práticos e reais, diferentes entre si: situações concretas de trabalho ou do dia a dia em que a pessoa usaria essa informação. Pode ser menos de 5 e pode ser uma lista vazia: só inclua um exemplo se o material realmente sustentar.
2. Cada exemplo deve combinar dois ou mais itens da nota quando fizer sentido (ex.: ferramenta A + conceito B), mostrando um uso concreto de ponta a ponta.
3. NUNCA invente ferramentas, comandos, links, recursos ou números que não estão no material. Se faltar informação, escreva um exemplo mais simples ou omita.
4. "title": curto e específico (o que a pessoa conseguiria fazer). "scenario": a situação real em que ela usaria. "how": como aplicar, em 2 a 4 frases com passos objetivos, citando os nomes dos itens da nota. "uses": nomes (exatos) dos itens da nota usados no exemplo.
5. Tudo em português do Brasil. Nomes próprios, comandos e código ficam no original.

Responda ESTRITAMENTE em JSON neste formato:
{"examples":[{"title":"...","scenario":"...","how":"...","uses":["..."]}]}`;
}
