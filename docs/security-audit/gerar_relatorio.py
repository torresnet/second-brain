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
                     PRIORIDADES, PROJETO, RESUMO_EXECUTIVO, ROTULOS_GRAFICO, SEV_COLOR, SEV_ORDER)

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.join(AQUI, "relatorio-auditoria-seguranca.pdf")
TITULO = f"Relatório de Auditoria de Segurança — {PROJETO}"
MONO_COLS = 100
LIMITE_KEEP_TOGETHER = 1500
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


def grafico_rosca(tmp):
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
    caminho = os.path.join(tmp, "donut.png")
    fig.savefig(caminho, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return caminho


def grafico_barras(tmp):
    xs = list(CATEGORIAS)
    fig, ax = plt.subplots(figsize=(7.2, 3.4), dpi=200)
    forte = [sum(1 for f in PONTOS_FORTES if f["cat"] == c) for c in xs]
    ax.bar([x - 0.2 for x in xs], forte, 0.38, color=SEV_COLOR["Ponto forte"], label="Ponto forte")
    base = [0] * len(xs)
    for sev in SEV_ORDER:
        alt = [sum(1 for a in ACHADOS if a["cat"] == c and a["sev"] == sev) for c in xs]
        if any(alt):
            ax.bar([x + 0.2 for x in xs], alt, 0.38, bottom=base, color=SEV_COLOR[sev], label=sev)
            base = [b + a for b, a in zip(base, alt)]
    ax.set_xticks(xs)
    ax.set_xticklabels(ROTULOS_GRAFICO, fontsize=7.5)
    ax.tick_params(axis="y", labelsize=8)
    ax.set_ylabel("Quantidade", fontsize=8)
    ax.spines[["top", "right"]].set_visible(False)
    ax.yaxis.get_major_locator().set_params(integer=True)
    ax.legend(frameon=False, fontsize=7.5, ncol=6, loc="lower center", bbox_to_anchor=(0.5, 1.0))
    caminho = os.path.join(tmp, "barras.png")
    fig.savefig(caminho, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return caminho


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
    resumo_sev = ", ".join(f"{n} {s.lower()}" for s, n in contagem.items() if n)
    el = [Spacer(1, 3.2 * cm), p("RELATÓRIO DE AUDITORIA DE SEGURANÇA", "muted"), Spacer(1, 6),
          p(escape(PROJETO), "title"), Spacer(1, 14),
          p(f"<b>Data:</b> {DATA} &nbsp;&nbsp; <b>Total:</b> {len(ACHADOS)} achados ({escape(resumo_sev)})"), Spacer(1, 8),
          p(f"<b>Escopo auditado:</b> {escape(ESCOPO)}"), Spacer(1, 14), p("Nota metodológica", "h2"),
          p("Esta auditoria mapeia cinco categorias de falha para a stack real do projeto, mais uma sexta para achados "
            "verificados fora delas. Só são reportados achados confirmados no código; o que é esperado por design "
            "aparece como informativo.", "muted"), Spacer(1, 6)]
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
    topo = Table([[tabela(linhas, [3.4 * cm, 2.6 * cm], extra=extra), Image(donut, width=7.6 * cm, height=6.2 * cm)]],
                 colWidths=[7 * cm, 10 * cm])
    topo.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    return [p("Resumo executivo", "h1"), p(RESUMO_EXECUTIVO), Spacer(1, 8), topo, Spacer(1, 10),
            p("Achados e pontos fortes por categoria", "h2"), Image(barras, width=16 * cm, height=7.6 * cm), PageBreak()]


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


def descricao_achado(a):
    issue = f"Issue {a['issue']}" if a["issue"] else "não acionável (esperado por design)"
    return (f"<b>[{a['id']}] {escape(a['titulo'])}</b><br/>{escape(a['descricao'])}<br/>"
            f"<b>Evidência:</b> <font name='Mono' size='6.8'>{'<br/>'.join(escape(e) for e in a['evidencia'])}</font><br/>"
            f"<b>Condições de explorabilidade:</b> {escape(a['condicoes'])}<br/><b>Impacto:</b> {escape(a['impacto'])}"
            f"<br/><b>Issue:</b> {issue}")


def achados_por_categoria():
    el = [p("Tabela de achados por categoria", "h1")]
    for cat, nome in CATEGORIAS.items():
        el.append(p(f"{cat}. {escape(nome)}", "h2"))
        itens = sorted([a for a in ACHADOS if a["cat"] == cat], key=lambda x: SEV_ORDER.index(x["sev"]))
        if not itens:
            fortes = [f["titulo"] for f in PONTOS_FORTES if f["cat"] == cat]
            el.append(p("Sem achados. Verificado em todos os pontos aplicáveis: " + escape("; ".join(fortes)) + ".", "muted"))
            continue
        linhas = [[p("<b>Severidade</b>", "small"), p("<b>Arquivo:linha</b>", "small"), p("<b>Descrição</b>", "small")]]
        extra = []
        for i, a in enumerate(itens, start=1):
            linhas.append([sev_chip(a["sev"]), p(escape(a["local"]).replace(";", "<br/>"), "small"),
                           p(descricao_achado(a), "small")])
            extra.append(("BACKGROUND", (0, i), (0, i), colors.HexColor(SEV_COLOR[a["sev"]])))
        el.append(tabela(linhas, [2.6 * cm, 3.8 * cm, 10.6 * cm], extra=extra))
    return el + [PageBreak()]


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
    if len(linha) <= MONO_COLS:
        return [linha]
    indent = len(linha) - len(linha.lstrip())
    extra = 2 if re.match(r"\s*(-|\d+\.)\s", linha) else 0
    return textwrap.wrap(linha, MONO_COLS, subsequent_indent=" " * (indent + extra), break_long_words=True)


def issue_texto(i):
    correcao = []
    for c in i["correcao"]:
        correcao.append(c if c.startswith(("```", "create", "language", "  ", "$$")) else f"- {c}")
    linhas = [f"--- ISSUE {i['n']} ---", f"Título: {i['titulo']}",
              f"Labels sugeridas: {', '.join(i['labels'])}", "", "## Problema", i["problema"], "",
              "## Evidência", *i["evidencia"], "", "## Impacto", i["impacto"], "", "## Sugestão de correção",
              *correcao, "", "## Critérios de aceite", *[f"- [ ] {c}" for c in i["criterios"]],
              "", f"--- FIM ISSUE {i['n']} ---"]
    saida = []
    for linha in linhas:
        saida += envolver(linha)
    return "\n".join(saida)


def issues_github():
    acionaveis = sum(1 for a in ACHADOS if a["issue"])
    el = [p("ISSUES PARA O GITHUB", "h1"),
          p(f"{len(ISSUES)} issues cobrem os {acionaveis} achados acionáveis (os três informativos de higiene foram unidos "
            "na issue 4). Copie o texto entre os marcadores de cada issue.", "muted"), Spacer(1, 6)]
    for i in ISSUES:
        texto = issue_texto(i)
        titulo = p(f"Issue {i['n']} — {escape(i['titulo'])}", "h2")
        bloco = Preformatted(texto, S["mono"])
        el += [KeepTogether([titulo, bloco])] if len(texto) < LIMITE_KEEP_TOGETHER else [titulo, bloco]
        el.append(Spacer(1, 10))
    return el


def main():
    with tempfile.TemporaryDirectory() as tmp:
        donut, barras = grafico_rosca(tmp), grafico_barras(tmp)
        doc = SimpleDocTemplate(SAIDA, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=2 * cm,
                                bottomMargin=2 * cm, title=TITULO, author="Auditoria de segurança", lang="pt-BR")
        historia = capa() + resumo(donut, barras) + fortes_fracos() + achados_por_categoria() + recomendacoes() + issues_github()
        doc.build(historia, onFirstPage=cabecalho_rodape, onLaterPages=cabecalho_rodape)
    print(f"PDF gerado: {SAIDA}")


if __name__ == "__main__":
    main()
