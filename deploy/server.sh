#!/usr/bin/env bash
# Runs ON THE SERVER. Started by <name>-update (deploy/update.sh), which stages the files first.
#
#   NAME=<name> server.sh ...   instance name (default ecs); update.sh passes it on.
#   server.sh setup --domain ecs.example.org --email you@example.org [--port 8090] [--superuser-email you@example.org]
#       ECS extras (all optional): --admin-pin PIN  --aprs-key KEY  --mail-from-name N  --mail-from-address A
#                                  --smtp-host H --smtp-port P --smtp-user U --smtp-pass PW [--smtp-tls]
#   server.sh setup --domain ecs.example.org --mode proxy --listen 10.0.0.9 --proxy-ip 10.0.0.5 [--port 8090]
#       One-time (and safe to re-run) server preparation + first release.
#       --mode local (default): Nginx and a TLS certificate are installed on this server.
#       --mode proxy: an external reverse proxy handles TLS. No Nginx or certbot here; the app listens on
#                     --listen (an IPv4 address, default this server's main address) and the firewall lets
#                     --proxy-ip through (address, range, comma separated list, or "none" to skip the rule).
#       --port is the port the app listens on (default: the current one, else 8090).
#       The settings live in the env file (PW_PORT, PW_LISTEN, PW_MODE, PW_PROXY_IPS); to change them later,
#       re-run setup with the new options.
#   server.sh release
#       Install the code staged next to this script, restart, health check, roll back on failure.
#
# Layout: code in /opt/<name>, data in /var/lib/<name>, secrets in /etc/<name>/env, unit <name>.service,
# user <name>, backups in /var/backups/<name>.
set -euo pipefail
# su (without -) and some ssh setups omit the sbin folders that useradd, ufw, nginx, sshd and runuser live in.
export PATH="$PATH:/usr/local/sbin:/usr/sbin:/sbin"

NAME=${NAME:-ecs}
[[ "$NAME" =~ ^[a-z][a-z0-9-]{0,23}$ ]] || { echo "ERROR: invalid instance name '$NAME' (1 to 24 lowercase letters, digits or dashes, starting with a letter)" >&2; exit 1; }
APP=${APP:-/opt/$NAME}
DATA=${DATA:-/var/lib/$NAME}
ENV_FILE=${ENV_FILE:-/etc/$NAME/env}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/$NAME}
UNIT_DIR=${UNIT_DIR:-/etc/systemd/system}
CRON_DIR=${CRON_DIR:-/etc/cron.d}
SVC_USER=${SVC_USER:-$NAME}
PB_VERSION=${PB_VERSION:-0.40.5}
DEFAULT_PORT=8090
DEFAULT_LISTEN=127.0.0.1
HEALTH_URL=${HEALTH_URL:-}    # default is built from PW_PORT once the env file is known
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-30}
STAGE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)   # parent of deploy/

say()  { printf '\n==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# Port handling. PW_PORT in the env file is the single source of truth: the systemd unit reads it,
# and setup writes it into the Nginx config.
valid_port() { [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1024 ] && [ "$1" -le 65535 ]; }
current_port() { [ -f "$ENV_FILE" ] && sed -n 's/^PW_PORT=//p' "$ENV_FILE" | head -1 || true; }
set_env_value() {   # name value
  if grep -q "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else printf '\n%s=%s\n' "$1" "$2" >> "$ENV_FILE"; fi
}
env_get() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | head -1 || true; }
current_listen() { env_get PW_LISTEN; }
rand_digits() { LC_ALL=C tr -dc '0-9' </dev/urandom | head -c "$1" || true; }
rand_alnum() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1" || true; }
# KEY="value" in the env file (systemd reads the quotes). Refuses values that would break the quoting.
set_env_quoted() {   # name value
  case "$2" in *'"'*|*'\'*|*'$'*|*$'\n'*) die "the value for $1 may not contain double quotes, backslashes, dollar signs or line breaks" ;; esac
  sed -i "/^$1=/d" "$ENV_FILE"
  printf '%s="%s"\n' "$1" "$2" >> "$ENV_FILE"
}
is_ipv4() {
  local IFS=. o; local -a parts=($1)
  [ "${#parts[@]}" -eq 4 ] || return 1
  for o in "${parts[@]}"; do [[ "$o" =~ ^[0-9]{1,3}$ ]] && [ "$o" -le 255 ] || return 1; done
}
is_ip_or_range() {
  local addr=${1%%/*} mask=
  if [[ "$1" == */* ]]; then mask=${1#*/}; [ -n "$mask" ] || return 1; fi
  if is_ipv4 "$addr"; then
    [ -z "$mask" ] || { [[ "$mask" =~ ^[0-9]{1,2}$ ]] && [ "$mask" -le 32 ]; }
  elif [[ "$addr" == *:* && "$addr" =~ ^[0-9A-Fa-f:]+$ ]]; then
    [ -z "$mask" ] || { [[ "$mask" =~ ^[0-9]{1,3}$ ]] && [ "$mask" -le 128 ]; }
  else
    return 1
  fi
}
primary_ip() {
  local addr
  addr=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')
  [ -n "$addr" ] || addr=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo "$addr"
}
# Installs made before these settings existed run on 127.0.0.1:8090, so record that.
ensure_port_setting() {
  [ -f "$ENV_FILE" ] || return 0
  [ -n "$(current_port)" ] || set_env_value PW_PORT "$DEFAULT_PORT"
  [ -n "$(current_listen)" ] || set_env_value PW_LISTEN "$DEFAULT_LISTEN"
}
# The health check runs on this machine. An app listening on 0.0.0.0 is reached through localhost;
# one bound to a single address has to be asked on that address.
resolve_health_url() {
  [ -z "$HEALTH_URL" ] || return 0
  local port=${PORT:-$(current_port)} host=${LISTEN:-$(current_listen)}
  case "$host" in ""|0.0.0.0) host=127.0.0.1 ;; esac
  HEALTH_URL="http://$host:${port:-$DEFAULT_PORT}/api/health"
}
# Where the web server should send traffic: the address the app listens on.
backend_address() {
  local host=${LISTEN:-$(current_listen)}; host=${host:-$DEFAULT_LISTEN}
  [ "$host" != 0.0.0.0 ] || host=$(primary_ip)
  echo "$host:${PORT:-$(current_port)}"
}

need_root() { [ "$(id -u)" = 0 ] || exec sudo -E bash "${BASH_SOURCE[0]}" "$@"; }

install_packages() {
  say "Installing packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  local pkgs=(sqlite3 unzip curl ca-certificates ufw fail2ban unattended-upgrades cron)
  [ "$MODE" = proxy ] || pkgs+=(nginx certbot python3-certbot-nginx)   # in proxy mode the web server lives elsewhere
  apt-get install -y -qq "${pkgs[@]}" >/dev/null
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
}

create_user_and_dirs() {
  say "Creating service user and directories"
  id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin "$SVC_USER"
  install -d -o "$SVC_USER" -g "$SVC_USER" -m 750 "$DATA" "$DATA/pb_data" "$BACKUP_DIR"
  install -d -m 755 "$APP"
  install -d -m 750 -g "$SVC_USER" "$(dirname "$ENV_FILE")"
}

install_pocketbase() {
  if [ -x "$APP/pocketbase" ] && "$APP/pocketbase" --version 2>/dev/null | grep -q " $PB_VERSION\$"; then
    say "PocketBase $PB_VERSION already installed"; return
  fi
  say "Installing PocketBase $PB_VERSION"
  local arch; arch=$(dpkg --print-architecture)
  case "$arch" in amd64|arm64) ;; armhf) arch=armv7 ;; *) die "unsupported architecture: $arch" ;; esac
  local zip="pocketbase_${PB_VERSION}_linux_${arch}.zip"
  local base="https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}"
  local tmp; tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/$zip" "$base/$zip"
  curl -fsSL -o "$tmp/checksums.txt" "$base/checksums.txt"
  (cd "$tmp" && grep " $zip\$" checksums.txt | sha256sum -c -) || die "PocketBase checksum mismatch"
  unzip -q -o "$tmp/$zip" pocketbase -d "$tmp"
  install -m 755 -o root -g root "$tmp/pocketbase" "$APP/pocketbase"
  rm -rf "$tmp"
}

write_env_file() {
  if [ -f "$ENV_FILE" ]; then say "Keeping existing $ENV_FILE"; return; fi
  say "Creating $ENV_FILE"
  cp "$STAGE/.env.example" "$ENV_FILE"
  sed -i "s|^APP_URL=.*|APP_URL=https://$DOMAIN|" "$ENV_FILE"
  # The first request after the first start seeds this PIN into the database (blank database only).
  [ -n "$ADMIN_PIN" ] || ADMIN_PIN=$(rand_digits 6)
  sed -i "s|^ECS_ADMIN_PIN=.*|ECS_ADMIN_PIN=$ADMIN_PIN|" "$ENV_FILE"
  chown root:"$SVC_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"
  NEW_PIN=$ADMIN_PIN
  FIRST_RUN=1
}

# Optional ECS settings given as options are written on every setup run (also when updating an install).
apply_optional_env() {
  [ -z "$APRS_KEY" ] || set_env_quoted APRS_FI_API_KEY "$APRS_KEY"
  [ -z "$MAIL_NAME" ] || set_env_quoted ECS_MAIL_FROM_NAME "$MAIL_NAME"
  [ -z "$MAIL_ADDR" ] || set_env_quoted ECS_MAIL_FROM_ADDRESS "$MAIL_ADDR"
  return 0
}

install_service() {
  say "Installing systemd service"
  sed -e "s|__NAME__|$NAME|g" -e "s|__USER__|$SVC_USER|g" -e "s|__APP__|$APP|g" -e "s|__DATA__|$DATA|g" -e "s|__ENV_FILE__|$ENV_FILE|g" \
    "$STAGE/deploy/ecs.service" > "$UNIT_DIR/$NAME.service"
  chmod 644 "$UNIT_DIR/$NAME.service"
  systemctl daemon-reload
  systemctl enable "$NAME" >/dev/null
}

install_nginx() {
  say "Configuring Nginx for $DOMAIN (app on 127.0.0.1:$PORT)"
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__BACKEND__|127.0.0.1:$PORT|g" "$STAGE/deploy/nginx.conf" > "/etc/nginx/sites-available/$NAME"
  ln -sf "/etc/nginx/sites-available/$NAME" "/etc/nginx/sites-enabled/$NAME"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx
  say "Requesting a TLS certificate (DNS for $DOMAIN must already point at this server)"
  if certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --no-eff-email -n --redirect; then
    TLS=yes
  else
    TLS=no
    warn "certbot failed. The site works over plain HTTP for now. Fix DNS, then re-run:  server.sh setup --domain $DOMAIN --email $EMAIL"
  fi
}

configure_firewall() {
  say "Configuring firewall"
  local ssh_port; ssh_port=$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}'); ssh_port=${ssh_port:-22}
  ufw allow "$ssh_port"/tcp >/dev/null
  if [ "$MODE" = proxy ]; then
    # Only the proxy may reach the app. Nothing is opened on 80 or 443 because Nginx is not installed here.
    if [ "$PROXY_IPS" = none ]; then
      warn "No firewall rule added for the proxy. Make sure $LISTEN:$PORT is reachable only from it."
    else
      local item list; IFS=, read -ra list <<< "$PROXY_IPS"
      for item in "${list[@]}"; do
        item=${item// /}
        ufw allow from "$item" to any port "$PORT" proto tcp >/dev/null
      done
    fi
  else
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
  fi
  ufw --force enable >/dev/null
  systemctl enable --now fail2ban >/dev/null 2>&1 || true
}

install_backup() {
  install -m 755 "$STAGE/deploy/backup.sh" "$APP/backup.sh"
  cat > "$CRON_DIR/$NAME" <<CRON
# Hourly consistent backup of the PocketBase database (kept 14 days). Output goes to the journal.
0 * * * * $SVC_USER DATA=$DATA/pb_data OUT=$BACKUP_DIR $APP/backup.sh 2>&1 | logger -t $NAME-backup
CRON
  chmod 644 "$CRON_DIR/$NAME"
}

healthy() {
  local i; for ((i = 0; i < HEALTH_TIMEOUT; i++)); do
    curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

do_release() {
  say "Releasing"
  ensure_port_setting
  resolve_health_url
  [ -x "$APP/pocketbase" ] || die "PocketBase is not installed. Run:  server.sh setup ..."
  for d in dist pb_hooks pb_migrations; do [ -d "$STAGE/$d" ] || die "missing $STAGE/$d in the staged release"; done

  [ -x "$APP/backup.sh" ] && runuser -u "$SVC_USER" -- env DATA="$DATA/pb_data" OUT="$BACKUP_DIR" "$APP/backup.sh" || warn "skipping pre-release backup"

  rm -rf "$APP/.prev"; mkdir -p "$APP/.prev"
  for d in dist pb_hooks pb_migrations; do
    [ -d "$APP/$d" ] && mv "$APP/$d" "$APP/.prev/$d"
    cp -a "$STAGE/$d" "$APP/$d"
  done
  chown -R root:root "$APP/dist" "$APP/pb_hooks" "$APP/pb_migrations"

  systemctl restart "$NAME"
  if healthy; then
    say "Release is up ($(date -u +%FT%TZ))"
    return 0
  fi

  warn "New release did not become healthy. Rolling back."
  journalctl -u "$NAME" -n 30 --no-pager || true
  for d in dist pb_hooks pb_migrations; do
    if [ -d "$APP/.prev/$d" ]; then rm -rf "${APP:?}/$d"; mv "$APP/.prev/$d" "$APP/$d"; fi
  done
  systemctl restart "$NAME"
  healthy && warn "Rolled back to the previous code. Database migrations that already ran were NOT undone; restore a backup if the schema changed." || warn "Still unhealthy after rollback. Check: journalctl -u $NAME"
  return 1
}

create_superuser() {
  [ -n "${SUPERUSER_EMAIL:-}" ] || return 0
  say "Creating PocketBase superuser $SUPERUSER_EMAIL"
  local pw; pw=$(openssl rand -base64 18 | tr -d '/+=')
  runuser -u "$SVC_USER" -- "$APP/pocketbase" superuser upsert "$SUPERUSER_EMAIL" "$pw" \
    --dir "$DATA/pb_data" --migrationsDir "$APP/pb_migrations" >/dev/null
  SUPERUSER_PW=$pw
}

# The first request to the app seeds the admin PIN into a blank database. After that the PIN lives in
# the database, so the line is removed from the env file.
seed_admin_pin() {
  [ -n "${NEW_PIN:-}" ] || return 0
  resolve_health_url
  if curl -fsS --max-time 15 "${HEALTH_URL%/api/health}/api/ecs/public-events" >/dev/null 2>&1; then
    sed -i '/^ECS_ADMIN_PIN=/d' "$ENV_FILE"
  else
    warn "Could not open the app once to seed the admin PIN. Open the site in a browser, then delete the ECS_ADMIN_PIN line from $ENV_FILE."
  fi
}

# Site address, trusted proxy header (so rate limiting sees real client addresses) and optional SMTP are
# PocketBase settings. They are set through the admin API, so this needs the superuser created in this run.
apply_pb_settings() {
  if [ -z "${SUPERUSER_PW:-}" ]; then
    warn "PocketBase settings (site address, trusted proxy header$([ -n "$SMTP_HOST" ] && echo ', SMTP')) were not applied because no superuser was created in this run. Re-run setup with --superuser-email, or set them in /_/ > Settings."
    return 0
  fi
  command -v node >/dev/null || { warn "node is not installed; PocketBase settings were not applied"; return 0; }
  resolve_health_url
  (
    export PB_URL="${HEALTH_URL%/api/health}" PB_SUPERUSER_EMAIL="$SUPERUSER_EMAIL" PB_SUPERUSER_PASSWORD="$SUPERUSER_PW"
    export PB_APP_URL="https://$DOMAIN" PB_TRUSTED_PROXY=1
    if [ -n "$SMTP_HOST" ]; then
      export PB_SMTP_HOST="$SMTP_HOST" PB_SMTP_PORT="$SMTP_PORT" PB_SMTP_USER="$SMTP_USER" PB_SMTP_PASS="$SMTP_PASS" PB_SMTP_TLS="$SMTP_TLS"
    fi
    [ -z "$MAIL_ADDR" ] || export PB_SENDER_ADDRESS="$MAIL_ADDR"
    [ -z "$MAIL_NAME" ] || export PB_SENDER_NAME="$MAIL_NAME"
    node "$STAGE/deploy/pb-settings.mjs"
  ) || warn "Applying the PocketBase settings failed. Set them in /_/ > Settings, or re-run setup."
}

cmd_setup() {
  DOMAIN=; EMAIL=; SUPERUSER_EMAIL=; SUPERUSER_PW=; TLS=no; PORT=; MODE=; LISTEN=; PROXY_IPS=
  ADMIN_PIN=; NEW_PIN=; FIRST_RUN=0; APRS_KEY=; MAIL_NAME=; MAIL_ADDR=
  SMTP_HOST=; SMTP_PORT=587; SMTP_USER=; SMTP_PASS=; SMTP_TLS=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --domain) DOMAIN=$2; shift 2 ;;
      --email) EMAIL=$2; shift 2 ;;
      --superuser-email) SUPERUSER_EMAIL=$2; shift 2 ;;
      --port) PORT=$2; shift 2 ;;
      --mode) MODE=$2; shift 2 ;;
      --listen) LISTEN=$2; shift 2 ;;
      --proxy-ip) PROXY_IPS=$2; shift 2 ;;
      --admin-pin) ADMIN_PIN=$2; shift 2 ;;
      --aprs-key) APRS_KEY=$2; shift 2 ;;
      --mail-from-name) MAIL_NAME=$2; shift 2 ;;
      --mail-from-address) MAIL_ADDR=$2; shift 2 ;;
      --smtp-host) SMTP_HOST=$2; shift 2 ;;
      --smtp-port) SMTP_PORT=$2; shift 2 ;;
      --smtp-user) SMTP_USER=$2; shift 2 ;;
      --smtp-pass) SMTP_PASS=$2; shift 2 ;;
      --smtp-tls) SMTP_TLS=1; shift ;;
      *) die "unknown option: $1" ;;
    esac
  done
  MODE=${MODE:-$(env_get PW_MODE)}; MODE=${MODE:-local}
  [ -r /etc/debian_version ] || die "this script is for Debian/Ubuntu"
  [ -n "$DOMAIN" ] || die "usage: server.sh setup --domain <host> --email <certbot email> [--port <n>] [--superuser-email <email>]  (or --mode proxy ...)"
  case "$MODE" in
    local)
      [ -n "$EMAIL" ] || die "local mode needs --email (used for the TLS certificate)"
      LISTEN=$DEFAULT_LISTEN; PROXY_IPS=
      ;;
    proxy)
      LISTEN=${LISTEN:-$(current_listen)}
      case "${LISTEN:-}" in ""|127.*) LISTEN=$(primary_ip) ;; esac
      is_ipv4 "$LISTEN" || die "--listen must be an IPv4 address (got '$LISTEN')"
      PROXY_IPS=${PROXY_IPS:-$(env_get PW_PROXY_IPS)}
      [ -n "$PROXY_IPS" ] || die "proxy mode needs --proxy-ip (the proxy's address or range, or 'none' if you manage the firewall elsewhere)"
      if [ "$PROXY_IPS" != none ]; then
        local item list; IFS=, read -ra list <<< "$PROXY_IPS"
        for item in "${list[@]}"; do is_ip_or_range "${item// /}" || die "--proxy-ip: '$item' is not an IP address or range"; done
      fi
      TLS=yes   # assumed: the proxy terminates TLS
      ;;
    *) die "--mode must be 'local' or 'proxy'" ;;
  esac

  [[ -z "$ADMIN_PIN" || "$ADMIN_PIN" =~ ^[A-Za-z0-9]{4,32}$ ]] || die "--admin-pin must be 4 to 32 letters or digits"
  [[ "$SMTP_PORT" =~ ^[0-9]+$ ]] || die "--smtp-port must be a number"
  local old_state; old_state="$(dirname "$ENV_FILE")/instance.conf"
  [ ! -f "$old_state" ] || [ -f "$ENV_FILE" ] || die "Found an install made by the previous ECS installer ($old_state). This installer uses a different layout and will not overwrite it. See 'Upgrading from the old installer' in docs/deployment.md, or pick another --name."

  install_packages
  create_user_and_dirs
  install_pocketbase
  write_env_file
  apply_optional_env
  # Port: --port, else keep the one already in use, else the default.
  PORT=${PORT:-$(current_port)}; PORT=${PORT:-$DEFAULT_PORT}
  valid_port "$PORT" || die "invalid port '$PORT' (use a number from 1024 to 65535)"
  set_env_value PW_PORT "$PORT"
  set_env_value PW_LISTEN "$LISTEN"
  set_env_value PW_MODE "$MODE"
  set_env_value PW_PROXY_IPS "$PROXY_IPS"
  install_service
  install_backup
  do_release || die "first release failed"
  seed_admin_pin
  # A first install always gets a PocketBase superuser, because the settings below need one.
  [ -n "$SUPERUSER_EMAIL" ] || [ "$FIRST_RUN" != 1 ] || SUPERUSER_EMAIL=admin@$NAME.local
  create_superuser
  apply_pb_settings
  [ "$MODE" = proxy ] || install_nginx
  configure_firewall

  say "Done"
  echo "Site:            http$([ "$TLS" = yes ] && echo s)://$DOMAIN   (app listens on $LISTEN:$PORT)"
  echo "Admin UI:        http$([ "$TLS" = yes ] && echo s)://$DOMAIN/_/"
  [ -n "$SUPERUSER_PW" ] && echo "Superuser login: $SUPERUSER_EMAIL / $SUPERUSER_PW   (shown once; change it in the admin UI)"
  [ -n "$NEW_PIN" ] && echo "Admin PIN:       $NEW_PIN   (first login to the app, shown once; change it under Events > Admin PIN)"
  if [ "$MODE" = proxy ]; then
    local conf; conf="$(dirname "$ENV_FILE")/nginx-proxy.conf"
    sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__BACKEND__|$(backend_address)|g" "$STAGE/deploy/nginx.conf" > "$conf"
    printf '%s {\n    reverse_proxy %s {\n        flush_interval -1\n    }\n}\n' "$DOMAIN" "$(backend_address)" > "$(dirname "$ENV_FILE")/Caddyfile-proxy.conf"
    cat <<PROXY

On the reverse proxy server:
  1. Save the config below (also kept at $conf on this server) as an Nginx site, enable it and reload Nginx.
  2. Get a certificate there, for example:  certbot --nginx -d $DOMAIN
  Keep the proxy_set_header lines: the app reads X-Forwarded-For for rate limiting, so only the proxy should be able
  to reach port $PORT on this server.
  If your proxy is Caddy instead, use the site block saved at $(dirname "$ENV_FILE")/Caddyfile-proxy.conf.
--------------------------------------------------------------------------
$(cat "$conf")
--------------------------------------------------------------------------
PROXY
  fi
  cat <<NEXT

Next:
  1. Optional: edit $ENV_FILE (APRS key, mail sender), then:  systemctl restart $NAME
  2. Mail (bulletins, ICS forms) needs an SMTP server: set it in https://$DOMAIN/_/ under Settings > Mail settings, unless you passed --smtp-host.
  3. To bring over data from the old app, from your laptop:  node migration/import-base44.mjs --json <export.json> --url https://$DOMAIN --email <superuser> --password '...' --dry-run
  4. Harden SSH once your key login works: PasswordAuthentication no, PermitRootLogin no in /etc/ssh/sshd_config.d/
  5. Copy $BACKUP_DIR off this machine regularly.
NEXT
}

main() {
  local cmd=${1:-}; shift || true
  case "$cmd" in
    setup)   need_root "$cmd" "$@"; cmd_setup "$@" ;;
    release) need_root "$cmd" "$@"; do_release ;;
    *) die "usage: server.sh {setup|release} ..." ;;
  esac
}

[ "${SERVER_SH_SOURCE_ONLY:-}" = 1 ] || main "$@"
