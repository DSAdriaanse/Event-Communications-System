#!/usr/bin/env bash
# Removes every instance installed by the Priority-Watch style installer (bootstrap.sh / server.sh) on this server.
# Run as root on the server:
#
#   bash uninstall-instances.sh --dry-run     show what would be removed, change nothing
#   bash uninstall-instances.sh               list instances, choose which to remove (numbers, or "a" for all),
#                                             confirm, archive each one, then remove it
#
# Options:
#   --dry-run       show the plan only
#   --yes           do not ask for confirmation
#   --no-archive    do not save a copy of each instance's data and env file before deleting
#   --only <name>   remove just this instance (can be repeated)
#   --keep-backups  keep /var/backups/<name>
#   --purge-leftovers  also delete anything the final sweep finds named after an instance
#
# An instance is found by its systemd unit: a PocketBase service with the installer's settings file (/etc/<name>/env with a <PREFIX>_PORT line such as PW_PORT or RT_PORT, or /etc/<name>/instance.conf). Both installers are
# recognised: the Priority-Watch style one (Priority-Watch, Round-Table-Net) and the Event Communications System one.
# For each one it removes: the service, the hourly backup cron job, /opt/<name>, /opt/<name>-src,
# /var/lib/<name> (the database), /etc/<name> (env file and secrets), /var/backups/<name>,
# /var/tmp/<name>-stage, the /usr/local/bin/<name>-update command, the service user, the firewall rule(s)
# opened for the proxy, and (local mode only) the Nginx site and its Let's Encrypt certificate.
#
# It also removes the instance's SSH deploy key (/root/.ssh/<name>-deploy and .pub) and its entry in
# /root/.ssh/config (a backup of that file is kept), then sweeps the usual folders for anything else named
# after the instance and reports what it finds. A reinstall will need a new deploy key on GitHub, so also
# delete the old key there (Repo -> Settings -> Deploy keys).
#
# It never touches: Node, apt packages, ufw/fail2ban themselves, other SSH keys, journal logs, or anything
# outside the instances it finds.
set -euo pipefail
export PATH="$PATH:/usr/local/sbin:/usr/sbin:/sbin"

# Locations (overridable so the script can be tested against a fake tree).
UNIT_DIR=${UNIT_DIR:-/etc/systemd/system}
CRON_DIR=${CRON_DIR:-/etc/cron.d}
BIN_DIR=${BIN_DIR:-/usr/local/bin}
OPT_DIR=${OPT_DIR:-/opt}
LIB_DIR=${LIB_DIR:-/var/lib}
ETC_DIR=${ETC_DIR:-/etc}
BACKUP_ROOT=${BACKUP_ROOT:-/var/backups}
TMP_DIR=${TMP_DIR:-/var/tmp}
NGINX_DIR=${NGINX_DIR:-/etc/nginx}
SSH_DIR=${SSH_DIR:-/root/.ssh}
CADDY_DIR=${CADDY_DIR:-/etc/caddy}
ARCHIVE_DIR=${ARCHIVE_DIR:-/root/instance-teardown-$(date +%Y%m%d-%H%M%S)}

DRY=0; YES=0; ARCHIVE=1; KEEP_BACKUPS=0; PURGE=0; ONLY=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --yes|-y) YES=1; shift ;;
    --no-archive) ARCHIVE=0; shift ;;
    --keep-backups) KEEP_BACKUPS=1; shift ;;
    --purge-leftovers) PURGE=1; shift ;;
    --only) ONLY+=("$2"); shift 2 ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done
if [ "$DRY" != 1 ] && [ "${SKIP_ROOT_CHECK:-}" != 1 ]; then
  [ "$(id -u)" = 0 ] || { echo "ERROR: run as root" >&2; exit 1; }
fi

say() { printf '\n==> %s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then printf '   [dry-run] %s\n' "$*"; else "$@"; fi; }
env_get() { local f=$1 k=$2; [ -f "$f" ] && sed -n "s/^$k=//p" "$f" | head -1 || true; }

# Reads one instance's settings. Two installers are recognised:
#   std     = current layout shared by ECS, Priority-Watch and Round-Table-Net: /etc/<n>/env, code in /opt/<n>
#   old-ecs = installs made by the previous ECS installer: /etc/<n>/instance.conf, code and data inside /opt/<n>
load_instance() {
  local n=$1 conf envf px
  I_PROXYIPS=
  if [ -f "$ETC_DIR/$n/instance.conf" ]; then
    KIND=old-ecs; conf=$ETC_DIR/$n/instance.conf
    I_MODE=$(env_get "$conf" PROXY); I_PORT=$(env_get "$conf" PORT); I_URL=$(env_get "$conf" DOMAIN)
    I_DIR=$(env_get "$conf" INSTALL_DIR)
  else
    KIND=std; envf=$ETC_DIR/$n/env
    # Each app has its own prefix for the same settings (PW_PORT, RT_PORT, ...). Use whichever this one has.
    px=$(sed -n 's/^\([A-Z][A-Z0-9]*\)_PORT=.*/\1/p' "$envf" 2>/dev/null | head -1); px=${px:-PW}
    I_MODE=$(env_get "$envf" "${px}_MODE"); I_PORT=$(env_get "$envf" "${px}_PORT"); I_URL=$(env_get "$envf" APP_URL)
    I_PROXYIPS=$(env_get "$envf" "${px}_PROXY_IPS"); I_DIR=
  fi
  I_DIR=${I_DIR:-$OPT_DIR/$n}
  I_DOMAIN=${I_URL#http://}; I_DOMAIN=${I_DOMAIN#https://}; I_DOMAIN=${I_DOMAIN%%/*}
}
show_instance() {   # prints one line for instance $1
  load_instance "$1"
  printf '%-20s type=%-7s mode=%-6s port=%-6s url=%s' "$1" "$KIND" "${I_MODE:-?}" "${I_PORT:-?}" "${I_URL:-?}"
}

# ------------------------------------------------------------ discover instances
NAMES=()
shopt -s nullglob
for unit in "$UNIT_DIR"/*.service; do
  n=$(basename "$unit" .service)
  grep -Eq "^ExecStart=.*pocketbase( |$)" "$unit" || continue
  # Must carry the installer's own settings file, so an unrelated PocketBase service is never touched.
  if [ ! -f "$ETC_DIR/$n/instance.conf" ] && ! grep -Eq '^[A-Z][A-Z0-9]*_PORT=' "$ETC_DIR/$n/env" 2>/dev/null; then continue; fi
  if [ "${#ONLY[@]}" -gt 0 ]; then
    keep=0; for o in "${ONLY[@]}"; do [ "$o" = "$n" ] && keep=1; done
    [ "$keep" = 1 ] || continue
  fi
  NAMES+=("$n")
done
shopt -u nullglob

if [ "${#NAMES[@]}" -eq 0 ]; then
  echo "No instances found (looked for systemd units in $UNIT_DIR that run PocketBase from a folder named after the instance)."
  exit 0
fi

# ------------------------------------------------------------ interactive choice
# With a terminal, and no --only / --yes, list what was found and ask which to remove.
if [ "${#ONLY[@]}" -eq 0 ] && [ "$YES" != 1 ] && [ -t 0 ]; then
  while true; do
    printf '\nInstances found on this server:\n'
    i=1
    for n in "${NAMES[@]}"; do
      printf '  %d) %s\n' "$i" "$(show_instance "$n")"
      i=$((i + 1))
    done
    printf '  a) all of them\n  q) quit, change nothing\n'
    read -r -p $'\nWhich to remove? (numbers like 1 3, or a, or q): ' choice </dev/tty
    choice=${choice//,/ }
    case "$choice" in
      q|Q|"") echo "Cancelled. Nothing was changed."; exit 0 ;;
      a|A|all|ALL) break ;;
    esac
    PICKED=(); bad=0
    for c in $choice; do
      if [[ "$c" =~ ^[0-9]+$ ]] && [ "$c" -ge 1 ] && [ "$c" -le "${#NAMES[@]}" ]; then
        dup=0; for p in "${PICKED[@]+"${PICKED[@]}"}"; do [ "$p" = "${NAMES[$((c - 1))]}" ] && dup=1; done
        [ "$dup" = 1 ] || PICKED+=("${NAMES[$((c - 1))]}")
      else bad=1; fi
    done
    if [ "$bad" = 1 ] || [ "${#PICKED[@]}" -eq 0 ]; then echo "Please enter numbers from the list, a, or q."; continue; fi
    NAMES=("${PICKED[@]}")
    break
  done
fi

# ------------------------------------------------------------ show the plan
printf '\nSelected for removal: %s\n' "${#NAMES[@]}"
for n in "${NAMES[@]}"; do
  printf '  - %s\n' "$(show_instance "$n")"
done
if [ "$ARCHIVE" = 1 ]; then printf '\nA copy of each instance'"'"'s data and env file will be saved in %s first.\n' "$ARCHIVE_DIR"
else printf '\nNo archive will be made. The data will be gone for good.\n'; fi
printf 'The database, env file and secrets of every instance above will be deleted.\n'

if [ "$DRY" != 1 ] && [ "$YES" != 1 ]; then
  [ -t 0 ] || { echo "ERROR: no terminal to ask on. Use --yes." >&2; exit 1; }
  read -r -p $'\nType DELETE to continue: ' a </dev/tty
  [ "$a" = DELETE ] || { echo "Cancelled. Nothing was changed."; exit 1; }
fi

# ------------------------------------------------------------ remove each one
for n in "${NAMES[@]}"; do
  say "Removing instance: $n"
  load_instance "$n"
  unit=$UNIT_DIR/$n.service
  svc_user=$(sed -n 's/^User=//p' "$unit" | head -1)
  mode=$I_MODE; port=$I_PORT; proxy_ips=$I_PROXYIPS; domain=$I_DOMAIN
  # Safety: the install folder must be a real subfolder (for example /opt/name), never / or a top-level folder.
  case "$I_DIR" in /*/?*) ;; *) echo "   refusing: install folder '$I_DIR' looks unsafe, skipping this instance" >&2; continue ;; esac

  if [ "$ARCHIVE" = 1 ]; then
    echo "   archiving to $ARCHIVE_DIR/$n.tar.gz"
    if [ "$DRY" != 1 ]; then
      mkdir -p "$ARCHIVE_DIR"; chmod 700 "$ARCHIVE_DIR"
      paths=()
      for d in "$LIB_DIR/$n" "$ETC_DIR/$n" "$I_DIR/data"; do [ -d "$d" ] && paths+=("${d#/}"); done
      if [ "${#paths[@]}" -gt 0 ]; then tar -czf "$ARCHIVE_DIR/$n.tar.gz" -C / "${paths[@]}" 2>/dev/null || true; fi
      chmod 600 "$ARCHIVE_DIR/$n.tar.gz" 2>/dev/null || true
    fi
  fi

  # service
  if command -v systemctl >/dev/null 2>&1 && [ "${SKIP_SYSTEMCTL:-}" != 1 ]; then
    run systemctl disable --now "$n" || true
  fi
  run rm -f "$unit"
  if command -v systemctl >/dev/null 2>&1 && [ "${SKIP_SYSTEMCTL:-}" != 1 ]; then run systemctl daemon-reload; fi

  # cron, code, data, config, staging, update command
  run rm -f "$CRON_DIR/$n"
  run rm -rf "$I_DIR" "$OPT_DIR/$n" "$OPT_DIR/$n-src" "$LIB_DIR/$n" "$ETC_DIR/$n" "$TMP_DIR/$n-stage"
  [ "$KEEP_BACKUPS" = 1 ] || run rm -rf "$BACKUP_ROOT/$n"
  run rm -f "$BIN_DIR/$n-update"

  # SSH deploy key and its stanza in the SSH config
  run rm -f "$SSH_DIR/$n-deploy" "$SSH_DIR/$n-deploy.pub"
  if [ -f "$SSH_DIR/config" ] && grep -q "$SSH_DIR/$n-deploy" "$SSH_DIR/config"; then
    echo "   removing the $n entry from $SSH_DIR/config (backup: $SSH_DIR/config.bak-teardown)"
    if [ "$DRY" != 1 ]; then
      cp -p "$SSH_DIR/config" "$SSH_DIR/config.bak-teardown"
      awk -v key="$SSH_DIR/$n-deploy" 'BEGIN{RS="";ORS="\n\n"} index($0,key)==0' "$SSH_DIR/config.bak-teardown" > "$SSH_DIR/config"
      chmod 600 "$SSH_DIR/config"
    fi
  fi
  run systemctl reset-failed "$n" 2>/dev/null || true

  # service user (only if it exists and nothing else needs it)
  if [ -n "$svc_user" ] && id "$svc_user" >/dev/null 2>&1; then run userdel "$svc_user" || true; fi

  # firewall: proxy mode opened the app port to the proxy address(es) only
  if [ "$mode" = proxy ] && [ -n "$port" ] && [ -n "$proxy_ips" ] && [ "$proxy_ips" != none ] && command -v ufw >/dev/null 2>&1; then
    IFS=, read -ra ips <<< "$proxy_ips"
    for ip in "${ips[@]}"; do
      ip=${ip// /}
      run ufw --force delete allow from "$ip" to any port "$port" proto tcp || true
    done
  fi

  # local mode: Nginx site and certificate on this server
  if [ -e "$NGINX_DIR/sites-available/$n" ] || [ -e "$NGINX_DIR/sites-enabled/$n" ] \
     || [ -e "$NGINX_DIR/sites-available/$n.conf" ] || [ -e "$NGINX_DIR/sites-enabled/$n.conf" ]; then
    run rm -f "$NGINX_DIR/sites-enabled/$n" "$NGINX_DIR/sites-available/$n" "$NGINX_DIR/sites-enabled/$n.conf" "$NGINX_DIR/sites-available/$n.conf"
    NGINX_CHANGED=1
    if [ -n "$domain" ] && command -v certbot >/dev/null 2>&1 && [ -d "/etc/letsencrypt/live/$domain" ]; then
      run certbot delete --cert-name "$domain" -n || true
    fi
  fi
  # Caddy site (ECS installs may use Caddy instead of Nginx)
  if [ -e "$CADDY_DIR/conf.d/$n.caddy" ]; then run rm -f "$CADDY_DIR/conf.d/$n.caddy"; CADDY_CHANGED=1; fi
done

if [ "${CADDY_CHANGED:-0}" = 1 ] && command -v systemctl >/dev/null 2>&1 && [ "${SKIP_SYSTEMCTL:-}" != 1 ]; then
  say "Reloading Caddy"
  run systemctl reload caddy || true
fi
if [ "${NGINX_CHANGED:-0}" = 1 ] && command -v nginx >/dev/null 2>&1; then
  say "Reloading Nginx"
  if [ "$DRY" = 1 ]; then echo "   [dry-run] nginx -t && systemctl reload nginx"; else nginx -t && systemctl reload nginx; fi
fi

# ------------------------------------------------------------ sweep for leftovers
say "Checking for anything left over"
LEFT=()
if [ "$DRY" != 1 ]; then
  for n in "${NAMES[@]}"; do
    for d in "$UNIT_DIR" "$CRON_DIR" "$BIN_DIR" "$OPT_DIR" "$LIB_DIR" "$ETC_DIR" "$BACKUP_ROOT" "$TMP_DIR" "$NGINX_DIR/sites-available" "$NGINX_DIR/sites-enabled" "$CADDY_DIR/conf.d" "$SSH_DIR"; do
      [ -d "$d" ] || continue
      while IFS= read -r f; do
        [ "$KEEP_BACKUPS" = 1 ] && [ "$d" = "$BACKUP_ROOT" ] && continue
        LEFT+=("$f")
      done < <(find "$d" -maxdepth 1 \( -name "$n" -o -name "$n-*" -o -name "$n.*" \) 2>/dev/null)
    done
  done
  if [ "${#LEFT[@]}" -eq 0 ]; then echo "   nothing left."; else
    if [ "$PURGE" = 1 ]; then
      echo "   Deleting leftovers:"; printf '     %s\n' "${LEFT[@]}"
      rm -rf -- "${LEFT[@]}"
    else
      echo "   These still exist (not removed automatically; check them, or re-run with --purge-leftovers):"
      printf '     %s\n' "${LEFT[@]}"
    fi
  fi
else
  echo "   [dry-run] would sweep the usual folders for leftovers"
fi

say "Done"
if [ "$DRY" = 1 ]; then echo "Dry run: nothing was changed."; else
  echo "Removed: ${NAMES[*]}"
  [ "$ARCHIVE" = 1 ] && echo "Archives (contain secrets, keep private): $ARCHIVE_DIR"
  echo "Delete each old deploy key on GitHub (Repo -> Settings -> Deploy keys); a reinstall makes a new one."
  echo "Reinstall with bootstrap.sh --name <app> ..."
fi
