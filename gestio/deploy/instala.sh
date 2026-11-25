#!/usr/bin/env bash
# =============================================================================
#  Instal·lació (o actualització) de la Plataforma de gestió en un servidor
#  Debian / Ubuntu (p. ex. Google Cloud e2-micro), amb HTTPS i DuckDNS.
#
#  Ús:   sudo bash instala.sh
#  Es pot tornar a executar tantes vegades com calgui: actualitza el codi
#  i manté les dades.
# =============================================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/oriol-cmd/projectes-Oriol.git}"
APP_DIR=/opt/gestio
DATA_DIR=/var/lib/gestio
BACKUP_DIR=/var/backups/gestio
CONF_DIR=/etc/gestio
PORT=3000

blau()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
verd()  { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
error() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || error "Executa-ho amb sudo:  sudo bash $0"
command -v apt-get >/dev/null || error "Aquest script és per a Debian o Ubuntu."
command -v curl >/dev/null || { apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null; }

mkdir -p "$CONF_DIR"; chmod 700 "$CONF_DIR"
# configuració desada d'una instal·lació anterior
# shellcheck disable=SC1091
[[ -f $CONF_DIR/instal.env ]] && source "$CONF_DIR/instal.env"
# shellcheck disable=SC1091
[[ -f $CONF_DIR/duckdns.env ]] && source "$CONF_DIR/duckdns.env"
BRANCA="${BRANCA_NOVA:-${BRANCA:-claude/elegant-curie-fx9lna}}"

# ---------------------------------------------------------------- 1. DuckDNS
blau "1/7 · Adreça web (DuckDNS)"
if [[ -z "${DUCKDNS_SUBDOMINI:-}" || -z "${DUCKDNS_TOKEN:-}" ]]; then
  read -rp "Subdomini de DuckDNS [topgreentowers]: " x </dev/tty
  DUCKDNS_SUBDOMINI="${x:-topgreentowers}"
  DUCKDNS_SUBDOMINI="${DUCKDNS_SUBDOMINI%.duckdns.org}"
  read -rsp "Token de DuckDNS (enganxa'l; no es veurà mentre l'escrius): " DUCKDNS_TOKEN </dev/tty; echo
  DUCKDNS_TOKEN="$(echo "$DUCKDNS_TOKEN" | tr -d '[:space:]')"
  [[ -n "$DUCKDNS_TOKEN" ]] || error "Cal el token de DuckDNS."
fi
resposta="$(curl -fsS "https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMINI}&token=${DUCKDNS_TOKEN}&ip=" || true)"
[[ "$resposta" == "OK" ]] || error "DuckDNS no ha acceptat el subdomini o el token (resposta: '${resposta}'). Revisa'ls a duckdns.org i torna-ho a provar."
umask 077
printf 'DUCKDNS_SUBDOMINI=%q\nDUCKDNS_TOKEN=%q\n' "$DUCKDNS_SUBDOMINI" "$DUCKDNS_TOKEN" > "$CONF_DIR/duckdns.env"
printf 'BRANCA=%q\n' "$BRANCA" > "$CONF_DIR/instal.env"
umask 022
DOMINI="${DUCKDNS_SUBDOMINI}.duckdns.org"
verd "L'adreça $DOMINI apunta a aquest servidor"

# --------------------------------------------------------------- 2. Paquets
blau "2/7 · Instal·lant els programes necessaris (pot trigar uns minuts)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git tar debian-keyring debian-archive-keyring apt-transport-https >/dev/null

# memòria d'intercanvi: la e2-micro només té 1 GB de RAM
if ! swapon --show | grep -q .; then
  if fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile 2>/dev/null; then
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    verd "Memòria d'intercanvi d'1 GB activada"
  else
    rm -f /swapfile
    echo "  (no s'ha pogut activar la memòria d'intercanvi; continuo igualment)"
  fi
fi

node_ok() { command -v node >/dev/null && node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"; }
if ! node_ok; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node_ok || error "No s'ha pogut instal·lar Node.js 22.13 o posterior."
verd "Node.js $(node -v)"

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi
verd "Caddy $(caddy version | cut -d' ' -f1)"

# ------------------------------------------------------------------ 3. Codi
blau "3/7 · Descarregant la plataforma (branca $BRANCA)"
id gestio >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin gestio
mkdir -p "$DATA_DIR" "$BACKUP_DIR"
chown gestio:gestio "$DATA_DIR" "$BACKUP_DIR"; chmod 750 "$DATA_DIR" "$BACKUP_DIR"
if [[ -d $APP_DIR/.git ]]; then
  git -C "$APP_DIR" fetch -q --depth 1 origin "$BRANCA"
  git -C "$APP_DIR" checkout -q -B "$BRANCA" FETCH_HEAD
  git -C "$APP_DIR" reset -q --hard FETCH_HEAD
else
  git clone -q --depth 1 --branch "$BRANCA" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR/gestio"
NPM_CONFIG_UPDATE_NOTIFIER=false npm ci --omit=dev --no-audit --no-fund --loglevel=error
verd "Versió: $(git -C "$APP_DIR" log -1 --format='%h %s' | cut -c1-80)"

# ---------------------------------------------------------------- 4. Servei
blau "4/7 · Configurant el servei perquè s'engegui sol"
NODE_BIN="$(command -v node)"
cat > /etc/systemd/system/gestio.service <<EOF
[Unit]
Description=Plataforma de gestió
After=network-online.target
Wants=network-online.target

[Service]
User=gestio
Group=gestio
WorkingDirectory=$APP_DIR/gestio
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=$PORT
Environment=DATA_DIR=$DATA_DIR
Environment=TZ=Europe/Madrid
Environment=PUBLIC_URL=https://$DOMINI
ExecStart=$NODE_BIN --no-warnings src/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

# ------------------------------------------------------------------ 5. HTTPS
blau "5/7 · Configurant l'HTTPS per a https://$DOMINI"
cat > /etc/caddy/Caddyfile <<EOF
$DOMINI {
	encode gzip
	request_body {
		max_size 30MB
	}
	reverse_proxy 127.0.0.1:$PORT
}
EOF

# ------------------------------------------- 6. DuckDNS i còpies periòdiques
blau "6/7 · Tasques automàtiques (DuckDNS cada 5 min i còpia de seguretat cada nit)"
cat > /usr/local/bin/gestio-duckdns <<'EOF'
#!/usr/bin/env bash
source /etc/gestio/duckdns.env
curl -fsS "https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMINI}&token=${DUCKDNS_TOKEN}&ip=" >/dev/null
EOF
chmod 700 /usr/local/bin/gestio-duckdns

cat > /etc/systemd/system/gestio-duckdns.service <<EOF
[Unit]
Description=Actualitza la IP a DuckDNS
[Service]
Type=oneshot
ExecStart=/usr/local/bin/gestio-duckdns
EOF
cat > /etc/systemd/system/gestio-duckdns.timer <<EOF
[Unit]
Description=Actualitza la IP a DuckDNS cada 5 minuts
[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
EOF

cat > /etc/systemd/system/gestio-backup.service <<EOF
[Unit]
Description=Còpia de seguretat de la plataforma
[Service]
Type=oneshot
User=gestio
Environment=DATA_DIR=$DATA_DIR
Environment=TZ=Europe/Madrid
ExecStart=$NODE_BIN --no-warnings $APP_DIR/gestio/src/backup.js $BACKUP_DIR 14
EOF
cat > /etc/systemd/system/gestio-backup.timer <<EOF
[Unit]
Description=Còpia de seguretat cada nit
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
[Install]
WantedBy=timers.target
EOF

# ordre per actualitzar més endavant
cat > /usr/local/bin/gestio-actualitza <<EOF
#!/usr/bin/env bash
# Actualitza la plataforma a l'última versió. Ús: sudo gestio-actualitza [branca]
set -e
[[ \$EUID -eq 0 ]] || { echo "Executa-ho amb sudo: sudo gestio-actualitza"; exit 1; }
source $CONF_DIR/instal.env
BR="\${1:-\$BRANCA}"
tmp=\$(mktemp)
# fa servir la versió més nova de l'script d'instal·lació
git -C $APP_DIR fetch -q --depth 1 origin "\$BR"
git -C $APP_DIR show FETCH_HEAD:gestio/deploy/instala.sh > "\$tmp"
BRANCA_NOVA="\$BR" bash "\$tmp"
rm -f "\$tmp"
EOF
chmod 755 /usr/local/bin/gestio-actualitza

# ---------------------------------------------------------------- 7. Engega
blau "7/7 · Engegant"
systemctl daemon-reload
systemctl enable -q gestio gestio-duckdns.timer gestio-backup.timer caddy
systemctl restart gestio
systemctl start gestio-duckdns.timer gestio-backup.timer
systemctl reload caddy 2>/dev/null || systemctl restart caddy

for _ in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:$PORT/api/setup-status" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/api/setup-status" >/dev/null 2>&1 || error "La plataforma no s'ha engegat. Mira què passa amb:  sudo journalctl -u gestio -n 50"
verd "La plataforma funciona"

cat <<EOF

────────────────────────────────────────────────────────────
  ✅  Tot a punt!

  Obre:  https://$DOMINI
  (el primer cop pot trigar un minut mentre es crea el certificat HTTPS)

  · Actualitzar:        sudo gestio-actualitza
  · Veure què passa:    sudo journalctl -u gestio -f
  · Còpies de la nit:   $BACKUP_DIR
────────────────────────────────────────────────────────────
EOF
