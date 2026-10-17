"""Gera docs/security-audit/relatorio-auditoria-seguranca.pdf a partir de achados.py.

Uso (com um venv que tenha reportlab e matplotlib):
    python docs/security-audit/gerar_relatorio.py
"""
import os
import re
import tempfile
import textwrap
from collections import Counter
from xml.sax.saxutils import escape

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (Image, KeepTogether, PageBreak, Paragraph, Preformatted,
                                SimpleDocTemplate, Spacer, Table, TableStyle)

from achados import (ACHADOS, CATEGORIAS, DATA, ESCOPO, ISSUES, NOTA_METODOLOGICA, PONTOS_FORTES,
                     PROJETO, REMEDIACAO, SEV_COLOR, SEV_ORDER, STATUS_COR)

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.join(AQUI, "relatorio-auditoria-seguranca.pdf")
TITULO = f"Relatório de Auditoria de Segurança — {PROJETO}"
MONO_COLS = 100
INK, MUTED, LINE = colors.HexColor("#111827"), colors.HexColor("#6B7280"), colors.HexColor("#E5E7EB")

FONT_DIR = os.path.join(os.path.dirname(matplotlib.__file__), "mpl-data", "fonts", "ttf")
for nome, arquivo in [("Sans", "DejaVuSans.ttf"), ("Sans-Bold", "DejaVuSans-Bold.ttf"),
                      ("Sans-Italic", "DejaVuSans-Oblique.ttf"), ("Mono", "DejaVuSansMono.ttf")]:
    pdfmetrics.registerFont(TTFont(nome, os.path.join(FONT_DIR, arquivo)))
pdfmetrics.registerFontFamily("Sans", normal="Sans", bold="Sans-Bold", italic="Sans-Italic", boldItalic="Sans-Bold")

S = {
    "body": ParagraphStyle("body", fontName="Sans", fontSize=9, leading=13, textColor=INK),
    "small": ParagraphStyle("small", fontName="Sans", fontSize=7.8, leading=10.5, textColor=INK),
    "muted": ParagraphStyle("muted", fontName="Sans", fontSize=8.5, leading=12, textColor=MUTED),
    "h1": ParagraphStyle("h1", fontName="Sans-Bold", fontSize=15, leading=19, spaceBefore=4, spaceAfter=8, textColor=INK),
    "h2": ParagraphStyle("h2", fontName="Sans-Bold", fontSize=11, leading=15, spaceBefore=10, spaceAfter=5, textColor=INK, keepWithNext=1),
    "title": ParagraphStyle("title", fontName="Sans-Bold", fontSize=24, leading=30, textColor=INK),
    "chip": ParagraphStyle("chip", fontName="Sans-Bold", fontSize=6.8, leading=8.5, textColor=colors.white, alignment=TA_CENTER),
    "mono": ParagraphStyle("mono", fontName="Mono", fontSize=7.2, leading=9.2, textColor=INK,
                           backColor=colors.HexColor("#F3F4F6"), borderPadding=(4, 5, 4, 5)),
}


def p(text, style="body"):
    return Paragraph(text, S[style])


def sev_chip(sev):
    return Paragraph(escape(sev.upper()), S["chip"])


def contar_sev():
    c = Counter(a["sev"] for a in ACHADOS)
    return {s: c.get(s, 0) for s in SEV_ORDER}


def graficos(tmp):
    contagem = contar_sev()
    fig, ax = plt.subplots(figsize=(4.2, 3.4), dpi=200)
    vals = [(s, n) for s, n in contagem.items() if n]
    ax.pie([n for _, n in vals], colors=[SEV_COLOR[s] for s, _ in vals], startangle=90, counterclock=False,
           wedgeprops=dict(width=0.42, edgecolor="white", linewidth=2))
    ax.text(0, 0.06, str(len(ACHADOS)), ha="center", va="center", fontsize=26, fontweight="bold", color="#111827")
    ax.text(0, -0.22, "achados", ha="center", va="center", fontsize=9, color="#6B7280")
    ax.legend([plt.Rectangle((0, 0), 1, 1, color=SEV_COLOR[s]) for s in SEV_ORDER],
              [f"{s} ({contagem[s]})" for s in SEV_ORDER], loc="upper center", bbox_to_anchor=(0.5, 0.02),
              ncol=3, frameon=False, fontsize=7.5)
    donut = os.path.join(tmp, "donut.png")
    fig.savefig(donut, bbox_inches="tight", transparent=False, facecolor="white")
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(6.4, 3.4), dpi=200)
    rotulos = ["1 Banco /\nisolamento", "2 Permissão\nno navegador", "3 IDOR", "4 Chaves\nexpostas", "5 Inputs /\nXSS e SSRF"]
    xs = range(1, 6)
    forte = [sum(1 for f in PONTOS_FORTES if f["cat"] == c) for c in xs]
    ax.bar([x - 0.2 for x in xs], forte, 0.38, color=SEV_COLOR["Ponto forte"], label="Ponto forte")
    base = [0] * 5
    for sev in SEV_ORDER:
        alt = [sum(1 for a in ACHADOS if a["cat"] == c and a["sev"] == sev) for c in xs]
        if any(alt):
            ax.bar([x + 0.2 for x in xs], alt, 0.38, bottom=base, color=SEV_COLOR[sev], label=sev)
            base = [b + a for b, a in zip(base, alt)]
    ax.set_xticks(list(xs))
    ax.set_xticklabels(rotulos, fontsize=7.5)
    ax.tick_params(axis="y", labelsize=8)
    ax.set_ylabel("Quantidade", fontsize=8)
    ax.spines[["top", "right"]].set_visible(False)
    ax.yaxis.get_major_locator().set_params(integer=True)
    ax.legend(frameon=False, fontsize=7.5, ncol=3, loc="upper left")
    barras = os.path.join(tmp, "barras.png")
    fig.savefig(barras, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return donut, barras


def cabecalho_rodape(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setFont("Sans", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(2 * cm, h - 1.2 * cm, TITULO)
    canvas.drawRightString(w - 2 * cm, h - 1.2 * cm, DATA)
    canvas.setStrokeColor(LINE)
    canvas.line(2 * cm, h - 1.4 * cm, w - 2 * cm, h - 1.4 * cm)
    canvas.line(2 * cm, 1.35 * cm, w - 2 * cm, 1.35 * cm)
    canvas.drawString(2 * cm, 0.9 * cm, "Documento confidencial. Contém detalhes de vulnerabilidades.")
    canvas.drawRightString(w - 2 * cm, 0.9 * cm, f"Página {doc.page}")
    canvas.restoreState()


def tabela(linhas, larguras, header=True, extra=None):
    t = Table(linhas, colWidths=larguras, repeatRows=1 if header else 0)
    estilo = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        estilo += [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F3F4F6"))]
    t.setStyle(TableStyle(estilo + (extra or [])))
    return t


def capa():
    contagem = contar_sev()
    resumo = ", ".join(f"{n} {s.lower()}" for s, n in contagem.items() if n)
    el = [Spacer(1, 3.2 * cm), p("RELATÓRIO DE AUDITORIA DE SEGURANÇA", "muted"), Spacer(1, 6),
          p(escape(PROJETO), "title"), Spacer(1, 14),
          p(f"<b>Data:</b> {DATA} &nbsp;&nbsp; <b>Total:</b> {len(ACHADOS)} achados ({escape(resumo)})"), Spacer(1, 8),
          p(f"<b>Escopo auditado:</b> {escape(ESCOPO)}"), Spacer(1, 14), p("Nota metodológica", "h2"),
          p("Esta auditoria mapeia cinco categorias de falha para a stack real do projeto. Só são reportados achados "
            "verificados no código; o que não pôde ser comprovado aparece como informativo.", "muted"), Spacer(1, 6)]
    linhas = [[p(f"<b>{escape(k)}</b>", "small"), p(escape(v), "small")] for k, v in NOTA_METODOLOGICA]
    el.append(tabela(linhas, [3.6 * cm, 13.4 * cm], header=False))
    return el + [PageBreak()]


def resumo(donut, barras):
    contagem = contar_sev()
    linhas = [[p("<b>Severidade</b>", "small"), p("<b>Quantidade</b>", "small")]]
    extra = []
    for i, s in enumerate(SEV_ORDER, start=1):
        linhas.append([sev_chip(s), p(str(contagem[s]), "small")])
        extra.append(("BACKGROUND", (0, i), (0, i), colors.HexColor(SEV_COLOR[s])))
    linhas.append([sev_chip("Ponto forte"), p(str(len(PONTOS_FORTES)), "small")])
    extra.append(("BACKGROUND", (0, len(SEV_ORDER) + 1), (0, len(SEV_ORDER) + 1), colors.HexColor(SEV_COLOR["Ponto forte"])))
    el = [p("Resumo executivo", "h1"),
          p("Não foram encontradas falhas críticas. Os dados do dono estão bem protegidos no banco (RLS em todas as tabelas, "
            "funções com security invoker) e o frontend escapa corretamente todo conteúdo dinâmico, sem XSS identificado. "
            "O risco concentra-se na <b>infraestrutura ao redor do app</b>: o token do Coolify trafega sem criptografia, "
            "há uma chave privada em pasta sincronizada com a nuvem, e dois pontos do pipeline (n8n e media-fetcher) "
            "buscam URLs sem barrar endereços internos (SSRF)."),
          Spacer(1, 8)]
    topo = Table([[tabela(linhas, [3.4 * cm, 2.6 * cm], extra=extra), Image(donut, width=7.6 * cm, height=6.2 * cm)]],
                 colWidths=[7 * cm, 10 * cm])
    topo.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    el += [topo, Spacer(1, 10), p("Achados e pontos fortes por categoria", "h2"),
           Image(barras, width=15.5 * cm, height=8.2 * cm), PageBreak()]
    return el


def fortes_fracos():
    el = [p("Pontos fortes e pontos fracos", "h1"), p("Pontos fortes (com evidência)", "h2")]
    linhas = [[p("<b>Cat.</b>", "small"), p("<b>Ponto forte</b>", "small"), p("<b>Evidência</b>", "small")]]
    for f in PONTOS_FORTES:
        linhas.append([p(str(f["cat"]), "small"), p(f"<b>{escape(f['titulo'])}</b>", "small"), p(escape(f["evidencia"]), "small")])
    el.append(tabela(linhas, [1.1 * cm, 4.9 * cm, 11 * cm]))
    el.append(p("Pontos fracos (resumo)", "h2"))
    linhas = [[p("<b>ID</b>", "small"), p("<b>Sev.</b>", "small"), p("<b>Ponto fraco</b>", "small")]]
    extra = []
    for i, a in enumerate(sorted(ACHADOS, key=lambda x: SEV_ORDER.index(x["sev"])), start=1):
        linhas.append([p(a["id"], "small"), sev_chip(a["sev"]), p(escape(a["titulo"]), "small")])
        extra.append(("BACKGROUND", (1, i), (1, i), colors.HexColor(SEV_COLOR[a["sev"]])))
    el.append(tabela(linhas, [1.1 * cm, 2.6 * cm, 13.3 * cm], extra=extra))
    return el + [PageBreak()]


def remediacao():
    el = [p("Status da remediação", "h1"),
          p("Situação após a execução do plano: o que foi corrigido no repositório (com teste) e o que ainda depende de ação "
            "manual em servidor, painel ou conta.", "muted"), Spacer(1, 6)]
    linhas = [[p("<b>ID</b>", "small"), p("<b>Sev.</b>", "small"), p("<b>Status</b>", "small"), p("<b>O que foi feito / pendência manual</b>", "small")]]
    extra = []
    por_id = {a["id"]: a for a in ACHADOS}
    ordem = sorted(REMEDIACAO, key=lambda i: (SEV_ORDER.index(por_id[i]["sev"]), i))
    for n, i in enumerate(ordem, start=1):
        status, feito, pendente = REMEDIACAO[i]
        sev = por_id[i]["sev"]
        texto = escape(feito) + ("" if pendente == "-" else f"<br/><b>Pendente (você):</b> {escape(pendente)}")
        linhas.append([p(i, "small"), sev_chip(sev), Paragraph(escape(status.upper()), S["chip"]), p(texto, "small")])
        extra += [("BACKGROUND", (1, n), (1, n), colors.HexColor(SEV_COLOR[sev])),
                  ("BACKGROUND", (2, n), (2, n), colors.HexColor(STATUS_COR[status]))]
    el.append(tabela(linhas, [1.1 * cm, 2.6 * cm, 2.2 * cm, 11.1 * cm], extra=extra))
    return el + [PageBreak()]


def achados_por_categoria():
    el = [p("Tabela de achados por categoria", "h1")]
    for cat, nome in CATEGORIAS.items():
        el.append(p(f"{cat}. {escape(nome)}", "h2"))
        itens = sorted([a for a in ACHADOS if a["cat"] == cat], key=lambda x: SEV_ORDER.index(x["sev"]))
        if not itens:
            fortes = [f["titulo"] for f in PONTOS_FORTES if f["cat"] == cat]
            el.append(p("Sem achados. Verificado em todos os handlers aplicáveis: " + escape("; ".join(fortes)) + ".", "muted"))
            continue
        linhas = [[p("<b>Severidade</b>", "small"), p("<b>Arquivo:linha</b>", "small"), p("<b>Descrição</b>", "small")]]
        extra = []
        for i, a in enumerate(itens, start=1):
            desc = (f"<b>[{a['id']}] {escape(a['titulo'])}</b><br/>{escape(a['descricao'])}<br/>"
                    f"<b>Evidência:</b> <font name='Mono' size='6.8'>{escape(' | '.join(a['evidencia']))}</font><br/>"
                    f"<b>Condições de explorabilidade:</b> {escape(a['condicoes'])}<br/><b>Impacto:</b> {escape(a['impacto'])}")
            linhas.append([sev_chip(a["sev"]), p(escape(a["local"]).replace(";", "<br/>"), "small"), p(desc, "small")])
            extra.append(("BACKGROUND", (0, i), (0, i), colors.HexColor(SEV_COLOR[a["sev"]])))
        el.append(tabela(linhas, [2.6 * cm, 3.6 * cm, 10.8 * cm], extra=extra))
    return el + [PageBreak()]


PRIORIDADES = [
    ("P1", "Imediato (hoje)", [
        (1, "Migrar o deploy para HTTPS, rotacionar o token do Coolify, mover IP e UUID para secrets e limitar permissions."),
        (2, "Tirar coolify_private_key.txt do OneDrive; revogar e gerar novo par de chaves se houver qualquer dúvida de exposição.")]),
    ("P2", "Próximos dias", [
        (3, "Aplicar validação SSRF (IP privado, redirects, portas) no nó 'Preparar Conteúdo' do n8n."),
        (4, "Revalidar cada redirect no media-fetcher e restringir o egress do container."),
        (5, "Adicionar CSP e cabeçalhos de segurança no nginx.")]),
    ("P3", "Próximas semanas", [
        (11, "Versionar o RLS, testar dono x não-dono, ativar MFA e confirmar cadastros desativados."),
        (7, "Escapar a exportação .md e os filtros de busca."),
        (8, "Sinalizar origem externa nos pré-preenchimentos de captura."),
        (9, "Rate limit no webhook e remover localhost do CORS de produção."),
        (10, "Pinar yt-dlp, npm ci, completar .dockerignore e limpar artefatos rastreados.")]),
    ("P4", "Backlog", [(6, "Endurecer o guard SSRF das Edge Functions (AAAA e rebinding).")]),
]


def recomendacoes():
    por_n = {i["n"]: i for i in ISSUES}
    el = [p("Recomendações priorizadas", "h1")]
    for codigo, quando, itens in PRIORIDADES:
        el.append(p(f"{codigo} — {quando}", "h2"))
        linhas = [[p("<b>Issue</b>", "small"), p("<b>Sev.</b>", "small"), p("<b>Ação</b>", "small")]]
        extra = []
        for i, (n, acao) in enumerate(itens, start=1):
            sev = por_n[n]["sev"]
            linhas.append([p(f"#{n}", "small"), sev_chip(sev), p(escape(acao), "small")])
            extra.append(("BACKGROUND", (1, i), (1, i), colors.HexColor(SEV_COLOR[sev])))
        el.append(tabela(linhas, [1.4 * cm, 2.6 * cm, 13.0 * cm], extra=extra))
    return el + [PageBreak()]


def envolver(linha):
    if linha.startswith("```") or len(linha) <= MONO_COLS:
        return [linha]
    indent = len(linha) - len(linha.lstrip())
    extra = 2 if re.match(r"\s*(-|\d+\.)\s", linha) else 0
    return textwrap.wrap(linha, MONO_COLS, subsequent_indent=" " * (indent + extra), break_long_words=True)


def issue_texto(i):
    linhas = [f"--- ISSUE {i['n']} ---", f"Título: {i['titulo']}",
              f"Labels sugeridas: {', '.join(i['labels'])}", "", "## Problema", i["problema"], "",
              "## Evidência", *i["evidencia"], "", "## Impacto", i["impacto"], "", "## Sugestão de correção",
              *[f"- {c}" for c in i["correcao"]], "", "## Critérios de aceite", *[f"- [ ] {c}" for c in i["criterios"]],
              "", f"--- FIM ISSUE {i['n']} ---"]
    saida, dentro_de_codigo = [], False
    for linha in linhas:
        if linha.startswith("```"):
            dentro_de_codigo = not dentro_de_codigo
        saida += [linha] if dentro_de_codigo else envolver(linha)
    return "\n".join(saida)


def issues_github():
    el = [p("ISSUES PARA O GITHUB", "h1"),
          p(f"{len(ISSUES)} issues agrupam os {sum(1 for a in ACHADOS if a['issue'])} achados acionáveis (achados triviais "
            "relacionados foram unidos). Copie o texto entre os marcadores de cada issue.", "muted"), Spacer(1, 6)]
    for i in ISSUES:
        bloco = [p(f"Issue {i['n']} — {escape(i['titulo'])}", "h2"), Preformatted(issue_texto(i), S["mono"]), Spacer(1, 10)]
        el.append(KeepTogether(bloco[:2]) if len(issue_texto(i)) < 1500 else bloco[0])
        if len(issue_texto(i)) >= 1500:
            el.append(bloco[1])
        el.append(bloco[2])
    return el


def main():
    with tempfile.TemporaryDirectory() as tmp:
        donut, barras = graficos(tmp)
        doc = SimpleDocTemplate(SAIDA, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=2 * cm,
                                bottomMargin=2 * cm, title=TITULO, author="Auditoria de segurança", lang="pt-BR")
        historia = capa() + resumo(donut, barras) + fortes_fracos() + remediacao() + achados_por_categoria() + recomendacoes() + issues_github()
        doc.build(historia, onFirstPage=cabecalho_rodape, onLaterPages=cabecalho_rodape)
    print(f"PDF gerado: {SAIDA}")


if __name__ == "__main__":
    main()
