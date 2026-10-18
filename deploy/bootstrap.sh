#!/usr/bin/env bash
# ECS (Event Communications System) - bootstrap for a blank (or shared) Debian/Ubuntu server.
#
#   sudo ./deploy/bootstrap.sh [options]
#   curl -fsSL https://raw.githubusercontent.com/DSAdriaanse/event_communications_system/main/deploy/bootstrap.sh | sudo bash -s -- [options]
#
# Safe to run next to other PocketBase instances: everything is namespaced by --instance
# (own user, own systemd unit, own /opt/<instance> + /etc/<instance> directories, own free TCP port).
# It never touches another service, another user or a foreign proxy site. Re-running upgrades the code
# and keeps the data, PINs and credentials.
#
# Options (all optional):
#   --instance NAME          instance name; user/unit/dirs derive from it        [ecs]
#   --port N                 TCP port; default: first free port from 8090 up, skipping ports other units use
#   --listen ADDR            bind address; default 127.0.0.1 with a proxy/domain, else 0.0.0.0
#   --domain HOST            public host name; adds a reverse-proxy site for it (see --proxy)
#   --proxy nginx|caddy|none reverse proxy to configure for --domain            [auto-detect]
#   --certbot                after nginx is configured, request a Let's Encrypt certificate for --domain
#   --admin-pin PIN          initial ECS admin PIN (blank database only)         [random 6 digits]
#   --superuser-email MAIL   PocketBase superuser                                 [admin@<instance>.local]
#   --superuser-password PW  PocketBase superuser password                        [random]
#   --import-dir DIR         folder of Base44 *_export.csv files to import       [migration/base44-export if present]
#   --no-import              do not import anything
#   --import-admin-pin       also import the Base44 admin PIN (default: keep the new one)
#   --smtp-host H --smtp-port P --smtp-user U --smtp-pass PW [--smtp-tls]   e-mail via your SMTP server
#   --mail-from-name N --mail-from-address A
#   --aprs-key KEY           aprs.fi API key for position polling
#   --repo URL --ref REF     where to fetch the code when not run from a checkout
#   --install-dir DIR        override /opt/<instance>
#   --pb-version V           PocketBase version                                   [0.40.5]
#   --no-systemd             no user/unit: run as the current user in the background (testing, containers)
#   --uninstall [--purge]    stop and remove the service/proxy site; --purge also deletes data, user and config
#   -y, --yes                never prompt
#
set -Eeuo pipefail

# ------------------------------------------------------------------ defaults
INSTANCE=ecs
PORT=""
LISTEN=""
DOMAIN=""
PROXY=""
CERTBOT=0
ADMIN_PIN=""
SU_EMAIL=""
SU_PASS=""
IMPORT_DIR=""
NO_IMPORT=0
IMPORT_ADMIN_PIN=0
SMTP_HOST="" SMTP_PORT=587 SMTP_USER="" SMTP_PASS="" SMTP_TLS=0
MAIL_NAME="" MAIL_ADDR=""
APRS_KEY=""
REPO_URL="https://github.com/DSAdriaanse/event_communications_system.git"
REF="main"
INSTALL_DIR=""
PB_VERSION="${PB_VERSION:-0.40.5}"
NODE_VERSION="${NODE_VERSION:-22.22.0}"
NO_SYSTEMD=0
UNINSTALL=0
PURGE=0
ASSUME_YES=0

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }
TMPS=()
cleanup() { for d in "${TMPS[@]:-}"; do if [ -n "$d" ]; then rm -rf "$d"; fi; done; return 0; }
trap cleanup EXIT
trap 'die "failed at line $LINENO (command: $BASH_COMMAND)"' ERR

usage() { sed -n '2,38p' "${BASH_SOURCE[0]:-$0}" | sed 's/^# \{0,1\}//'; exit 0; }

while [ $# -gt 0 ]; do
  case "$1" in
    --instance) INSTANCE="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    --listen) LISTEN="$2"; shift 2;;
    --domain) DOMAIN="$2"; shift 2;;
    --proxy) PROXY="$2"; shift 2;;
    --certbot) CERTBOT=1; shift;;
    --admin-pin) ADMIN_PIN="$2"; shift 2;;
    --superuser-email) SU_EMAIL="$2"; shift 2;;
    --superuser-password) SU_PASS="$2"; shift 2;;
    --import-dir) IMPORT_DIR="$2"; shift 2;;
    --no-import) NO_IMPORT=1; shift;;
    --import-admin-pin) IMPORT_ADMIN_PIN=1; shift;;
    --smtp-host) SMTP_HOST="$2"; shift 2;;
    --smtp-port) SMTP_PORT="$2"; shift 2;;
    --smtp-user) SMTP_USER="$2"; shift 2;;
    --smtp-pass) SMTP_PASS="$2"; shift 2;;
    --smtp-tls) SMTP_TLS=1; shift;;
    --mail-from-name) MAIL_NAME="$2"; shift 2;;
    --mail-from-address) MAIL_ADDR="$2"; shift 2;;
    --aprs-key) APRS_KEY="$2"; shift 2;;
    --repo) REPO_URL="$2"; shift 2;;
    --ref) REF="$2"; shift 2;;
    --install-dir) INSTALL_DIR="$2"; shift 2;;
    --pb-version) PB_VERSION="$2"; shift 2;;
    --no-systemd) NO_SYSTEMD=1; shift;;
    --uninstall) UNINSTALL=1; shift;;
    --purge) PURGE=1; shift;;
    -y|--yes) ASSUME_YES=1; shift;;
    -h|--help) usage;;
    *) die "unknown option: $1 (see --help)";;
  esac
done

[[ "$INSTANCE" =~ ^[a-z][a-z0-9-]{0,30}$ ]] || die "--instance must be lowercase letters, digits and dashes (max 31 chars)"
[ "$(id -u)" -eq 0 ] || [ "$NO_SYSTEMD" -eq 1 ] || die "run as root (sudo), or use --no-systemd for an unprivileged test install"

SVC_USER="$INSTANCE"
SERVICE="$INSTANCE"
[ -n "$INSTALL_DIR" ] || INSTALL_DIR="/opt/$INSTANCE"
if [ "$NO_SYSTEMD" -eq 1 ] && [ "$(id -u)" -ne 0 ]; then CONF_DIR="$INSTALL_DIR/etc"; else CONF_DIR="/etc/$INSTANCE"; fi
[ "$NO_SYSTEMD" -eq 1 ] && [ -n "${ECS_CONF_DIR:-}" ] && CONF_DIR="$ECS_CONF_DIR"
STATE_FILE="$CONF_DIR/instance.conf"
ENV_FILE="$CONF_DIR/$INSTANCE.env"
CRED_FILE="$CONF_DIR/credentials.txt"
UNIT_FILE="/etc/systemd/system/$SERVICE.service"
NGINX_SITE="/etc/nginx/sites-available/$INSTANCE.conf"
NGINX_LINK="/etc/nginx/sites-enabled/$INSTANCE.conf"
CADDY_SITE="/etc/caddy/conf.d/$INSTANCE.caddy"

SCRIPT_PATH="${BASH_SOURCE[0]:-}"
SCRIPT_DIR=""
[ -n "$SCRIPT_PATH" ] && [ -f "$SCRIPT_PATH" ] && SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"

have() { command -v "$1" >/dev/null 2>&1; }
rand_alnum() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1" || true; }
rand_digits() { LC_ALL=C tr -dc '0-9' </dev/urandom | head -c "$1" || true; }

# ------------------------------------------------------------------ uninstall
if [ "$UNINSTALL" -eq 1 ]; then
  [ -f "$STATE_FILE" ] || die "no ECS instance '$INSTANCE' found (missing $STATE_FILE) - refusing to remove anything"
  log "Uninstalling instance '$INSTANCE'"
  if [ "$NO_SYSTEMD" -eq 0 ]; then
    systemctl disable --now "$SERVICE.service" 2>/dev/null || true
    rm -f "$UNIT_FILE"; systemctl daemon-reload || true
  elif [ -f "$INSTALL_DIR/run/pb.pid" ]; then
    kill "$(cat "$INSTALL_DIR/run/pb.pid")" 2>/dev/null || true
  fi
  if [ -f "$NGINX_SITE" ] && grep -q "managed by deploy/bootstrap.sh" "$NGINX_SITE"; then
    rm -f "$NGINX_LINK" "$NGINX_SITE"; nginx -t 2>/dev/null && systemctl reload nginx || true
  fi
  if [ -f "$CADDY_SITE" ] && grep -q "managed by deploy/bootstrap.sh" "$CADDY_SITE"; then
    rm -f "$CADDY_SITE"; systemctl reload caddy 2>/dev/null || true
  fi
  if [ "$PURGE" -eq 1 ]; then
    rm -rf "$INSTALL_DIR" "$CONF_DIR"
    id "$SVC_USER" >/dev/null 2>&1 && userdel "$SVC_USER" 2>/dev/null || true
    log "Purged $INSTALL_DIR and $CONF_DIR"
  else
    log "Service removed. Data kept in $INSTALL_DIR/data (use --purge to delete it)."
  fi
  exit 0
fi

# ------------------------------------------------------------------ existing install?
RERUN=0
if [ -f "$STATE_FILE" ]; then
  RERUN=1
  _p="$PORT"; _l="$LISTEN"; _d="$DOMAIN"; _x="$PROXY"
  # shellcheck disable=SC1090
  . "$STATE_FILE"                      # PORT, LISTEN, DOMAIN, PROXY of the first run ...
  [ -z "$_p" ] || PORT="$_p"; [ -z "$_l" ] || LISTEN="$_l"; [ -z "$_d" ] || DOMAIN="$_d"; [ -z "$_x" ] || PROXY="$_x"   # ... unless given again
  log "Existing instance '$INSTANCE' found: upgrading in place (data is kept)"
elif [ -e "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
  die "$INSTALL_DIR already exists and is not an ECS instance created by this script. Use --instance or --install-dir."
elif [ "$NO_SYSTEMD" -eq 0 ] && { [ -e "$UNIT_FILE" ] || id "$SVC_USER" >/dev/null 2>&1; }; then
  die "A systemd unit or user named '$INSTANCE' already exists and isn't ours. Pick another --instance."
fi

# ------------------------------------------------------------------ prerequisites
OS_OK=0
if [ -r /etc/os-release ]; then . /etc/os-release; case "${ID:-}${ID_LIKE:-}" in *debian*|*ubuntu*) OS_OK=1;; esac; fi
[ "$OS_OK" -eq 1 ] || warn "This script targets Debian/Ubuntu; continuing anyway."

need_pkgs=()
for t in curl:curl unzip:unzip tar:tar git:git; do have "${t%%:*}" || need_pkgs+=("${t##*:}"); done
have ss || need_pkgs+=(iproute2)
[ -d /etc/ssl/certs ] || need_pkgs+=(ca-certificates)
if [ "${#need_pkgs[@]}" -gt 0 ]; then
  have apt-get || die "missing tools (${need_pkgs[*]}) and no apt-get available"
  log "Installing prerequisites: ${need_pkgs[*]}"
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${need_pkgs[@]}" ca-certificates
fi

case "$(uname -m)" in
  x86_64|amd64) PB_ARCH=amd64; NODE_ARCH=x64;;
  aarch64|arm64) PB_ARCH=arm64; NODE_ARCH=arm64;;
  *) die "unsupported CPU architecture: $(uname -m)";;
esac

# ------------------------------------------------------------------ port selection
reserved_ports() {
  # ports currently listening ...
  ss -Hltn 2>/dev/null | awk '{n=split($4,a,":"); print a[n]}'
  # ... and ports other (possibly stopped) services are configured for
  grep -rhoE -- '--http[= ]+[^ ]*:[0-9]+' /etc/systemd/system /lib/systemd/system /usr/lib/systemd/system 2>/dev/null \
    | grep -oE '[0-9]+$' || true
}
if [ -z "$PORT" ]; then
  RESERVED=" $(reserved_ports | sort -u | tr '\n' ' ') "
  for p in $(seq 8090 8190); do
    case "$RESERVED" in *" $p "*) continue;; esac
    PORT=$p; break
  done
  [ -n "$PORT" ] || die "no free port found between 8090 and 8190; pass --port"
  log "Selected free port $PORT"
else
  if [ "$RERUN" -eq 0 ] && ss -Hltn 2>/dev/null | awk '{n=split($4,a,":"); print a[n]}' | grep -qx "$PORT"; then
    die "port $PORT is already in use"
  fi
fi

# ------------------------------------------------------------------ proxy choice
if [ -n "$DOMAIN" ] && [ -z "$PROXY" ]; then
  if systemctl is-active --quiet caddy 2>/dev/null; then PROXY=caddy
  elif have nginx || systemctl is-active --quiet nginx 2>/dev/null; then PROXY=nginx
  else PROXY=nginx; INSTALL_NGINX=1
  fi
fi
[ -n "$PROXY" ] || PROXY=none
case "$PROXY" in nginx|caddy|none) ;; *) die "--proxy must be nginx, caddy or none";; esac
if [ -z "$LISTEN" ]; then
  if [ "$PROXY" != none ]; then LISTEN=127.0.0.1; else LISTEN=0.0.0.0; fi
fi

# ------------------------------------------------------------------ service account + dirs
if [ "$NO_SYSTEMD" -eq 0 ]; then
  if ! id "$SVC_USER" >/dev/null 2>&1; then
    log "Creating system user '$SVC_USER'"
    useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin --user-group "$SVC_USER"
  fi
  RUN_USER="$SVC_USER"
else
  RUN_USER="$(id -un)"
fi
mkdir -p "$INSTALL_DIR"/{bin,data,run} "$CONF_DIR"
chmod 755 "$INSTALL_DIR"
chmod 750 "$CONF_DIR"
[ "$NO_SYSTEMD" -eq 0 ] && chown root:"$SVC_USER" "$CONF_DIR"

# ------------------------------------------------------------------ PocketBase binary
PB_BIN="$INSTALL_DIR/bin/pocketbase"
have_pb_version() { [ -x "$PB_BIN" ] && "$PB_BIN" --version 2>/dev/null | grep -q "$PB_VERSION"; }
if have_pb_version; then
  log "PocketBase $PB_VERSION already installed"
else
  log "Installing PocketBase $PB_VERSION ($PB_ARCH)"
  TMP="$(mktemp -d)"; TMPS+=("$TMP")
  URL="https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip"
  if curl -fsSL --retry 3 -o "$TMP/pb.zip" "$URL" && unzip -q -o "$TMP/pb.zip" pocketbase -d "$TMP"; then
    :
  else
    warn "GitHub download failed; trying the PyPI mirror (pocketbase-bin)"
    have python3 || die "cannot download PocketBase from GitHub and python3 is not available for the fallback"
    python3 -m pip download --no-deps --only-binary=:all: "pocketbase-bin==$PB_VERSION" -d "$TMP/whl" >/dev/null 2>&1 \
      || die "PocketBase download failed from GitHub and PyPI. Download v$PB_VERSION manually to $PB_BIN and re-run."
    unzip -q -o "$TMP"/whl/*.whl '*/scripts/pocketbase' -d "$TMP/wheel"
    cp "$TMP"/wheel/*/scripts/pocketbase "$TMP/pocketbase"
  fi
  install -m 0755 "$TMP/pocketbase" "$PB_BIN"
  have_pb_version || die "installed PocketBase does not report version $PB_VERSION"
fi

# ------------------------------------------------------------------ source code
SRC="$INSTALL_DIR/src"
SRC_FROM=""
if [ -n "$SCRIPT_DIR" ] && [ -d "$SCRIPT_DIR/../pocketbase/pb_hooks" ] && [ -d "$SCRIPT_DIR/../app/src" ]; then
  SRC_FROM="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  log "Fetching source from $REPO_URL ($REF)"
  CLONE="$(mktemp -d)"; TMPS+=("$CLONE")
  git clone --quiet --depth 1 --branch "$REF" "$REPO_URL" "$CLONE"
  SRC_FROM="$CLONE"
fi
log "Installing application files into $SRC"
mkdir -p "$SRC"
for d in pocketbase app scripts deploy; do
  rm -rf "$SRC/$d.new"; mkdir -p "$SRC/$d.new"
  [ -d "$SRC_FROM/$d" ] || continue
  # copy without build junk; keep an existing node_modules for fast upgrades
  (cd "$SRC_FROM/$d" && tar --exclude=node_modules --exclude=dist --exclude=pb_data -cf - .) | (cd "$SRC/$d.new" && tar -xf -)
  if [ -d "$SRC/$d/node_modules" ]; then mv "$SRC/$d/node_modules" "$SRC/$d.new/node_modules"; fi
  rm -rf "$SRC/$d"; mv "$SRC/$d.new" "$SRC/$d"
done

# ------------------------------------------------------------------ Node (only for building + importing)
node_ok() { have node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; }
NODE_BIN_DIR=""
if node_ok; then
  log "Using system Node $(node -v) for the build"
else
  log "Downloading an isolated Node $NODE_VERSION for the build (nothing is installed system-wide)"
  NDIR="$INSTALL_DIR/.build/node"
  if [ ! -x "$NDIR/bin/node" ]; then
    mkdir -p "$NDIR"
    curl -fsSL --retry 3 "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz" | tar -xz --strip-components=1 -C "$NDIR"
  fi
  NODE_BIN_DIR="$NDIR/bin"
  export PATH="$NODE_BIN_DIR:$PATH"
fi

log "Building the web app"
(
  cd "$SRC/app"
  export npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false HOME="$INSTALL_DIR/.build"
  mkdir -p "$HOME"
  if [ -f package-lock.json ]; then npm ci --ignore-scripts --no-progress >/dev/null; else npm install --ignore-scripts --no-progress >/dev/null; fi
  npm run build >/dev/null
)
[ -f "$SRC/app/dist/index.html" ] || die "web build did not produce app/dist/index.html"

# ------------------------------------------------------------------ secrets / env file
if [ ! -f "$ENV_FILE" ]; then
  [ -n "$ADMIN_PIN" ] || ADMIN_PIN="$(rand_digits 6)"
  GENERATED_PIN=1
  umask 077
  {
    echo "# generated by deploy/bootstrap.sh - ECS instance '$INSTANCE'"
    echo "ECS_ADMIN_PIN=$ADMIN_PIN"
    echo "APRS_FI_API_KEY=\"$APRS_KEY\""
    echo "ECS_MAIL_FROM_NAME=\"${MAIL_NAME:-SWCRS ECS}\""
    echo "ECS_MAIL_FROM_ADDRESS=\"$MAIL_ADDR\""
  } > "$ENV_FILE"
  umask 022
else
  GENERATED_PIN=0
  # allow later runs to update individual values
  setenv() { grep -q "^$1=" "$ENV_FILE" && sed -i "s|^$1=.*|$1=\"$2\"|" "$ENV_FILE" || echo "$1=\"$2\"" >> "$ENV_FILE"; }
  [ -z "$APRS_KEY" ] || setenv APRS_FI_API_KEY "$APRS_KEY"
  [ -z "$MAIL_NAME" ] || setenv ECS_MAIL_FROM_NAME "$MAIL_NAME"
  [ -z "$MAIL_ADDR" ] || setenv ECS_MAIL_FROM_ADDRESS "$MAIL_ADDR"
fi
chmod 640 "$ENV_FILE"; [ "$NO_SYSTEMD" -eq 0 ] && chown root:"$SVC_USER" "$ENV_FILE"

# superuser credentials
if [ -f "$CRED_FILE" ]; then
  SU_EMAIL="$(sed -n 's/^PocketBase superuser email: //p' "$CRED_FILE")"
  SU_PASS="$(sed -n 's/^PocketBase superuser password: //p' "$CRED_FILE")"
else
  [ -n "$SU_EMAIL" ] || SU_EMAIL="admin@$INSTANCE.local"
  [ -n "$SU_PASS" ] || SU_PASS="$(rand_alnum 24)"
fi

# state for re-runs
cat > "$STATE_FILE" <<EOF
PORT=$PORT
LISTEN=$LISTEN
DOMAIN=$DOMAIN
PROXY=$PROXY
INSTALL_DIR=$INSTALL_DIR
EOF

[ "$NO_SYSTEMD" -eq 0 ] && chown -R "$SVC_USER":"$SVC_USER" "$INSTALL_DIR/data" "$INSTALL_DIR/run"
[ "$NO_SYSTEMD" -eq 0 ] && chown -R root:root "$INSTALL_DIR/bin" "$SRC" || true
# the .build dir (node, npm cache) is no longer needed once built
[ -d "$INSTALL_DIR/.build/.npm" ] && rm -rf "$INSTALL_DIR/.build/.npm" || true

# ------------------------------------------------------------------ superuser (needs the DB, before first start)
as_svc() { if [ "$NO_SYSTEMD" -eq 0 ]; then runuser -u "$SVC_USER" -- "$@"; else "$@"; fi; }
if [ ! -f "$CRED_FILE" ]; then
  log "Creating the PocketBase superuser"
  as_svc "$PB_BIN" superuser upsert "$SU_EMAIL" "$SU_PASS" --dir="$INSTALL_DIR/data/pb_data" >/dev/null
  umask 077
  {
    echo "ECS instance: $INSTANCE"
    echo "PocketBase superuser email: $SU_EMAIL"
    echo "PocketBase superuser password: $SU_PASS"
    echo "ECS admin PIN (first login): ${ADMIN_PIN:-<unchanged>}"
  } > "$CRED_FILE"
  umask 022
  chmod 600 "$CRED_FILE"
fi

# ------------------------------------------------------------------ start the service
if [ "$NO_SYSTEMD" -eq 0 ]; then
  [ -f "$SRC/deploy/ecs.service.in" ] || die "missing deploy/ecs.service.in"
  sed -e "s|@@INSTANCE@@|$INSTANCE|g" -e "s|@@USER@@|$SVC_USER|g" -e "s|@@DIR@@|$INSTALL_DIR|g" \
      -e "s|@@ENVFILE@@|$ENV_FILE|g" -e "s|@@LISTEN@@|$LISTEN|g" -e "s|@@PORT@@|$PORT|g" \
      "$SRC/deploy/ecs.service.in" > "$UNIT_FILE"
  systemctl daemon-reload
  systemctl enable "$SERVICE.service" >/dev/null 2>&1
  systemctl restart "$SERVICE.service"
else
  if [ -f "$INSTALL_DIR/run/pb.pid" ] && kill -0 "$(cat "$INSTALL_DIR/run/pb.pid")" 2>/dev/null; then kill "$(cat "$INSTALL_DIR/run/pb.pid")"; sleep 1; fi
  (
    set -a; . "$ENV_FILE"; set +a
    nohup "$PB_BIN" serve --http="$LISTEN:$PORT" --dir="$INSTALL_DIR/data/pb_data" \
      --hooksDir="$SRC/pocketbase/pb_hooks" --migrationsDir="$SRC/pocketbase/pb_migrations" \
      --publicDir="$SRC/app/dist" --indexFallback=true > "$INSTALL_DIR/run/serve.log" 2>&1 &
    echo $! > "$INSTALL_DIR/run/pb.pid"
  )
fi

HEALTH_HOST="$LISTEN"; [ "$HEALTH_HOST" = 0.0.0.0 ] && HEALTH_HOST=127.0.0.1
BASE="http://$HEALTH_HOST:$PORT"
log "Waiting for ECS to answer on $BASE"
for i in $(seq 1 60); do
  curl -fsS "$BASE/api/ecs/health" >/dev/null 2>&1 && break
  sleep 1
  [ "$i" -eq 60 ] && { [ "$NO_SYSTEMD" -eq 0 ] && journalctl -u "$SERVICE" -n 30 --no-pager || tail -n 30 "$INSTALL_DIR/run/serve.log"; die "service did not become healthy"; }
done

# first request seeds the admin PIN (blank database only)
curl -fsS "$BASE/api/ecs/public-events" >/dev/null

# ------------------------------------------------------------------ PocketBase settings
export PB_URL="$BASE" PB_SUPERUSER_EMAIL="$SU_EMAIL" PB_SUPERUSER_PASSWORD="$SU_PASS"
if [ -n "$DOMAIN" ]; then export PB_APP_URL="https://$DOMAIN"; fi
if [ "$PROXY" != none ]; then export PB_TRUSTED_PROXY=1; fi
if [ -n "$SMTP_HOST" ]; then
  export PB_SMTP_HOST="$SMTP_HOST" PB_SMTP_PORT="$SMTP_PORT" PB_SMTP_USER="$SMTP_USER" PB_SMTP_PASS="$SMTP_PASS" PB_SMTP_TLS="$SMTP_TLS"
  [ -z "$MAIL_ADDR" ] || export PB_SENDER_ADDRESS="$MAIL_ADDR"
  [ -z "$MAIL_NAME" ] || export PB_SENDER_NAME="$MAIL_NAME"
fi
node "$SRC/deploy/pb-settings.mjs"

# ------------------------------------------------------------------ data import
if [ "$NO_IMPORT" -eq 0 ]; then
  [ -n "$IMPORT_DIR" ] || { [ -d "$SRC_FROM/migration/base44-export" ] && IMPORT_DIR="$SRC_FROM/migration/base44-export" || true; }
  if [ -n "$IMPORT_DIR" ]; then
    [ -d "$IMPORT_DIR" ] || die "--import-dir $IMPORT_DIR not found"
    log "Importing Base44 export from $IMPORT_DIR"
    extra=(); [ "$IMPORT_ADMIN_PIN" -eq 1 ] && extra+=(--with-admin-pin)
    node "$SRC/scripts/import-base44.mjs" --dir "$IMPORT_DIR" --url "$BASE" --email "$SU_EMAIL" --password "$SU_PASS" "${extra[@]}"
  else
    log "No Base44 export supplied - starting with an empty database (use --import-dir later to import)"
  fi
fi

# ------------------------------------------------------------------ reverse proxy (only our own site file)
if [ "$PROXY" = nginx ] && [ -n "$DOMAIN" ]; then
  if ! have nginx; then
    log "Installing nginx"
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx
  fi
  log "Adding nginx site $NGINX_SITE for $DOMAIN"
  [ -e "$NGINX_SITE" ] && ! grep -q "managed by deploy/bootstrap.sh" "$NGINX_SITE" && die "$NGINX_SITE exists and is not ours"
  sed -e "s|@@INSTANCE@@|$INSTANCE|g" -e "s|@@DOMAIN@@|$DOMAIN|g" -e "s|@@PORT@@|$PORT|g" "$SRC/deploy/nginx.conf.in" > "$NGINX_SITE"
  ln -sf "$NGINX_SITE" "$NGINX_LINK"
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx 2>/dev/null || systemctl start nginx
  else
    rm -f "$NGINX_LINK" "$NGINX_SITE"
    nginx -t || true
    warn "nginx config test failed - our site was removed again, other sites are untouched."
  fi
  if [ "$CERTBOT" -eq 1 ]; then
    have certbot || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
      || warn "certbot failed; the site works over HTTP. Run certbot manually once DNS points here."
  fi
elif [ "$PROXY" = caddy ] && [ -n "$DOMAIN" ]; then
  mkdir -p /etc/caddy/conf.d
  [ -e "$CADDY_SITE" ] && ! grep -q "managed by deploy/bootstrap.sh" "$CADDY_SITE" && die "$CADDY_SITE exists and is not ours"
  sed -e "s|@@INSTANCE@@|$INSTANCE|g" -e "s|@@DOMAIN@@|$DOMAIN|g" -e "s|@@PORT@@|$PORT|g" "$SRC/deploy/Caddyfile.in" > "$CADDY_SITE"
  if grep -qE '^\s*import\s+(/etc/caddy/)?conf\.d/' /etc/caddy/Caddyfile 2>/dev/null; then
    caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 && systemctl reload caddy || warn "Caddy validation failed; check $CADDY_SITE"
  else
    warn "Your Caddyfile does not import /etc/caddy/conf.d/*. Add this line to /etc/caddy/Caddyfile (I do not edit existing proxy configs):"
    warn "    import /etc/caddy/conf.d/*.caddy"
  fi
fi

# the PIN now lives in the database; no need to keep seeding material around once it exists
if [ "$GENERATED_PIN" -eq 1 ]; then sed -i '/^ECS_ADMIN_PIN=/d' "$ENV_FILE"; fi

# ------------------------------------------------------------------ summary
URL_SHOWN="http://${DOMAIN:-$HEALTH_HOST}"; [ -z "$DOMAIN" ] && URL_SHOWN="$BASE"
[ -n "$DOMAIN" ] && [ "$CERTBOT" -eq 1 ] && URL_SHOWN="https://$DOMAIN"
cat <<EOF

────────────────────────────────────────────────────────────
 ECS instance '$INSTANCE' is running
   App                $URL_SHOWN
   PocketBase admin   $URL_SHOWN/_/
   Service            $( [ "$NO_SYSTEMD" -eq 0 ] && echo "systemctl status $SERVICE" || echo "pid $(cat "$INSTALL_DIR/run/pb.pid") (--no-systemd)" )
   Data               $INSTALL_DIR/data/pb_data   (back this up)
   Credentials        $CRED_FILE   (root only)
   Listening on       $LISTEN:$PORT   proxy: $PROXY
────────────────────────────────────────────────────────────
EOF
[ "$GENERATED_PIN" -eq 1 ] && echo " Admin PIN: $ADMIN_PIN  (also in the credentials file; change it in the app under Events)"
[ "$LISTEN" = 0.0.0.0 ] && warn "ECS is reachable over plain HTTP on port $PORT. For anything but a trusted LAN put it behind HTTPS (--domain)."
exit 0
