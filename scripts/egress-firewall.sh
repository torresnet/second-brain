#!/bin/sh
# Segundo Cérebro: impede que o media-fetcher e o n8n abram conexões para a rede interna do servidor (SSRF).
# Roda no SERVIDOR do Coolify (não no seu computador), como root. Bloqueia só conexões NOVAS saindo desses
# containers; respostas a quem os chamou (ex.: media-fetcher respondendo ao n8n) continuam passando.
#
#   sh egress-firewall.sh mostrar <filtro-media-fetcher> [filtro-n8n]   # só imprime as regras (não muda nada)
#   sh egress-firewall.sh aplicar <filtro-media-fetcher> [filtro-n8n]   # remove as regras antigas e aplica as novas
#   sh egress-firewall.sh remover                                       # desfaz tudo
#
# <filtro-*> é parte do nome do container (veja com: docker ps --format '{{.Names}}').
# media-fetcher: bloqueia TODAS as faixas privadas (ele só precisa da internet).
# n8n: bloqueia as faixas privadas só nas portas 80/443 (a do DNS rebinding) e o serviço de metadados inteiro;
#      o acesso do n8n ao media-fetcher (porta 8080) e ao próprio banco continua liberado.
# Os IPs dos containers mudam a cada redeploy: rode "aplicar" de novo depois de publicar (ou agende no cron).
set -eu

TAG="segundo-cerebro-egress"
PRIVADAS="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16"
PRIVADAS_WEB="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10"
METADADOS="169.254.0.0/16"

uso() {
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

ips_de() {
  ids=$(docker ps -q --filter "name=$1")
  if [ -z "$ids" ]; then
    echo "Nenhum container em execução com '$1' no nome." >&2
    exit 1
  fi
  for id in $ids; do
    docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$id"
  done | tr ' ' '\n' | grep -v '^$' | sort -u
}

regra() {
  echo "iptables -I DOCKER-USER -s $1 -d $2 $3 -m conntrack --ctstate NEW -m comment --comment $TAG -j DROP"
}

gerar_regras() {
  ips_fetcher=$(ips_de "$1") || exit 1
  ips_n8n=""
  if [ -n "${2:-}" ]; then
    ips_n8n=$(ips_de "$2") || exit 1
  fi
  for ip in $ips_fetcher; do
    for faixa in $PRIVADAS; do regra "$ip" "$faixa" ""; done
  done
  if [ -n "$ips_n8n" ]; then
    for ip in $ips_n8n; do
      for faixa in $PRIVADAS_WEB; do regra "$ip" "$faixa" "-p tcp -m multiport --dports 80,443"; done
      regra "$ip" "$METADADOS" ""
    done
  fi
}

remover() {
  iptables -S DOCKER-USER | grep -- "--comment $TAG" | sed 's/^-A /-D /' | while read -r linha; do
    # shellcheck disable=SC2086
    iptables $linha
  done
}

[ $# -ge 1 ] || uso
case "$1" in
  mostrar)
    [ $# -ge 2 ] || uso
    gerar_regras "$2" "${3:-}"
    ;;
  aplicar)
    [ $# -ge 2 ] || uso
    [ "$(id -u)" -eq 0 ] || { echo "Rode como root (sudo)." >&2; exit 1; }
    regras=$(gerar_regras "$2" "${3:-}")
    remover
    echo "$regras" | while read -r comando; do sh -c "$comando"; done
    echo "Regras aplicadas:"
    iptables -S DOCKER-USER | grep -- "--comment $TAG"
    ;;
  remover)
    [ "$(id -u)" -eq 0 ] || { echo "Rode como root (sudo)." >&2; exit 1; }
    remover
    echo "Regras do Segundo Cérebro removidas."
    ;;
  *)
    uso
    ;;
esac
