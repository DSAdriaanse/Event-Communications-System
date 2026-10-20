#!/usr/bin/env bash
# Tests for the guided installer (deploy/bootstrap.sh) and proxy mode (deploy/server.sh).
# They load the functions and stub the system commands, so nothing is installed:  bash deploy/test/install.test.sh
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TMP=$(mktemp -d); LISTEN_PIDS=()
cleanup() { for p in "${LISTEN_PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; rm -rf "$TMP"; }
trap cleanup EXIT
FAILS=0
check() { if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 (expected '$3', got '$2')"; FAILS=$((FAILS + 1)); fi; }
ok()   { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; FAILS=$((FAILS + 1)); fi; }

listen() { python3 -c "import socket,time,sys; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(('127.0.0.1',$1)); s.listen(); time.sleep(120)" & LISTEN_PIDS+=($!); sleep 0.4; }

# Pick a block of free ports so the tests do not depend on what is running here.
BASE=18090; while (exec 3<>/dev/tcp/127.0.0.1/$BASE) 2>/dev/null || (exec 3<>/dev/tcp/127.0.0.1/$((BASE+1))) 2>/dev/null || (exec 3<>/dev/tcp/127.0.0.1/$((BASE+2))) 2>/dev/null; do BASE=$((BASE+10)); done

# bootstrap's defaults start at 8090; these tests shift that start by overriding the function inputs
boot() { ( export ENV_FILE="$TMP/env" BOOTSTRAP_SOURCE_ONLY=1; source "$HERE/bootstrap.sh"; "$@" ); }

echo "--- validation"
for v in 1024 8090 65535; do ok "valid_port accepts $v" "boot valid_port $v"; done
for v in 0 80 1023 65536 abc '' 80.5 -1; do ok "valid_port rejects '$v'" "! boot valid_port '$v'"; done

echo "--- suggestion (bootstrap.sh)"
rm -f "$TMP/env"
check "no env file, 8090 free or taken: a number is suggested" "$(boot suggest_port | grep -c -E '^[0-9]+$')" "1"
echo "PW_PORT=8123" > "$TMP/env"
check "existing install keeps its own port" "$(boot suggest_port)" "8123"
rm -f "$TMP/env"
# Move the search window to a known-free block by temporarily defining the start via a wrapper
suggest_from() { ( export ENV_FILE="$TMP/env" BOOTSTRAP_SOURCE_ONLY=1; source "$HERE/bootstrap.sh"
  suggest_port() { local p=$1; while port_in_use "$p"; do p=$((p + 1)); done; echo "$p"; }; suggest_port "$1" ); }
check "free start port is suggested as is" "$(suggest_from $BASE)" "$BASE"
listen $BASE
check "taken port is skipped" "$(suggest_from $BASE)" "$((BASE+1))"
listen $((BASE+1))
check "two taken ports are skipped" "$(suggest_from $BASE)" "$((BASE+2))"
ok "port_in_use sees the listener" "boot port_in_use $BASE"
ok "port_in_use is false for a free port" "! boot port_in_use $((BASE+5))"

# The real suggest_port starts at 8090. Compare it with an independent search so this holds whatever is running here.
first_free=8090; while (exec 3<>/dev/tcp/127.0.0.1/$first_free) 2>/dev/null; do first_free=$((first_free + 1)); done
rm -f "$TMP/env"
check "real suggest_port returns the first free port from 8090" "$(boot suggest_port)" "$first_free"

echo "--- bootstrap.sh refuses a bad port before changing anything"
if [ "$(id -u)" = 0 ] && [ -r /etc/debian_version ]; then
  out=$(cd "$TMP" && timeout 20 bash "$HERE/bootstrap.sh" --domain d.example --email e@example.org --port abc </dev/null 2>&1); rc=$?
  check "bootstrap with --port abc exits 1" "$rc" "1"
  ok "bootstrap with --port abc explains why" "echo \"$out\" | grep -q 'not a valid port'"
  out=$(cd "$TMP" && timeout 20 bash "$HERE/bootstrap.sh" --domain d.example --email e@example.org --port $BASE </dev/null 2>&1); rc=$?
  check "bootstrap with a port in use exits 1" "$rc" "1"
  ok "bootstrap names the port in use" "echo \"$out\" | grep -q 'already in use'"
else
  echo "SKIP bootstrap end-to-end refusal (needs root on Debian)"
fi

echo "--- choose_port without a terminal"
choose() { ( export ENV_FILE="$TMP/env" BOOTSTRAP_SOURCE_ONLY=1; source "$HERE/bootstrap.sh"; PORT=$1; choose_port </dev/null; echo "$PORT" ) 2>"$TMP/err"; }
check "valid --port is used" "$(choose $((BASE+7)) | tail -1)" "$((BASE+7))"
choose "abc" >/dev/null; check "invalid --port is refused" "$?" "1"
ok "invalid --port says why" "grep -q 'not a valid port' $TMP/err"
choose $BASE >/dev/null; check "port already in use is refused" "$?" "1"
ok "in-use message names the port" "grep -q 'Port $BASE is already in use' $TMP/err"
echo "PW_PORT=$BASE" > "$TMP/env"
check "re-running on the same port is allowed (it is our own)" "$(choose $BASE | tail -1)" "$BASE"
rm -f "$TMP/env"

# ptyrun "<answers separated by |>" "<bash command>"  -> runs the command on a pseudo-terminal, answering each prompt in turn.
# Prints the terminal text (CR removed), then EXIT=<code>.
ptyrun() {
  python3 - "$1" "$2" <<'PY'
import os, pty, sys, time, select, re
answers, cmd = sys.argv[1].split("|") if sys.argv[1] != "" else [""], sys.argv[2]
if sys.argv[1] == "": answers = [""] * 20
pid, fd = pty.fork()
if pid == 0:
    os.execvp("bash", ["bash", "-c", cmd])
out = b""; sent = 0; mark = 0
deadline = time.time() + 20; code = None
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 0.3)
    if r:
        try: d = os.read(fd, 4096)
        except OSError: break
        if not d: break
        out += d
        if len(out) > mark and out.endswith((b": ", b"]: ", b"] ")) and sent < len(answers):
            os.write(fd, (answers[sent] + "\n").encode()); sent += 1; mark = len(out) + len(answers[sent-1]) + 2
    else:
        done, status = os.waitpid(pid, os.WNOHANG)
        if done: code = os.waitstatus_to_exitcode(status); break
if code is None:
    try:
        done, status = os.waitpid(pid, os.WNOHANG)
        if not done:
            time.sleep(0.5); done, status = os.waitpid(pid, os.WNOHANG)
        if done: code = os.waitstatus_to_exitcode(status)
    except ChildProcessError: pass
if code is None:
    # still waiting for input after the deadline: stop it so the test fails instead of hanging
    import signal
    try:
        os.kill(pid, signal.SIGKILL); os.waitpid(pid, 0)
    except (ProcessLookupError, ChildProcessError): pass
    code = 124
sys.stdout.write(out.decode(errors="replace").replace("\r", ""))
print("EXIT=%d" % code)
PY
}
PRE="export ENV_FILE=$TMP/env CONF=$TMP/conf BOOTSTRAP_SOURCE_ONLY=1; source $HERE/bootstrap.sh;"

echo "--- choose_port at a terminal"
rm -f "$TMP/env"
r=$(ptyrun "$((BASE+8))" "$PRE choose_port; echo RESULT=\$PORT"); ok "typed port is accepted" "echo \"\$r\" | grep -q 'RESULT=$((BASE+8))'"
r=$(ptyrun "" "$PRE choose_port; echo RESULT=\$PORT"); ok "empty answer takes the suggestion" "echo \"\$r\" | grep -qE 'RESULT=[0-9]+'"
r=$(ptyrun "70000|$((BASE+9))" "$PRE choose_port; echo RESULT=\$PORT"); ok "bad port re-asks, then accepts" "echo \"\$r\" | grep -q 'RESULT=$((BASE+9))' && echo \"\$r\" | grep -q 'not a valid port'"
r=$(ptyrun "$BASE|$((BASE+6))" "$PRE choose_port; echo RESULT=\$PORT"); ok "port in use re-asks, then accepts" "echo \"\$r\" | grep -q 'RESULT=$((BASE+6))' && echo \"\$r\" | grep -q 'already in use'"

echo "--- validators"
for v in 10.0.0.5 0.0.0.0 255.255.255.255; do ok "is_ipv4 accepts $v" "boot is_ipv4 $v"; done
for v in 256.1.1.1 1.2.3 1.2.3.4.5 a.b.c.d ""; do ok "is_ipv4 rejects '$v'" "! boot is_ipv4 '$v'"; done
for v in 10.0.0.5 10.0.0.0/24 10.0.0.5/32 fd00::1 fd00::/8; do ok "is_ip_or_range accepts $v" "boot is_ip_or_range $v"; done
for v in 10.0.0.0/33 10.0.0.5/ 300.0.0.1 hello fd00::1/129; do ok "is_ip_or_range rejects $v" "! boot is_ip_or_range $v"; done
for v in none 10.0.0.5 "10.0.0.5,10.1.0.0/24" "10.0.0.5, 10.1.0.0/24"; do ok "proxy list accepts '$v'" "boot v_proxy_ips '$v'"; done
for v in "" "10.0.0.5,bad" "999.0.0.1"; do ok "proxy list rejects '$v'" "! boot v_proxy_ips '$v' >/dev/null"; done
ok "domain accepts a hostname" "boot v_domain ecs.apps.swcrs.org"
ok "domain accepts an IP address" "boot v_domain 192.168.88.133"
ok "domain rejects spaces" "! boot v_domain 'a b' >/dev/null"
ok "domain rejects a leading dash" "! boot v_domain '-a.com' >/dev/null"
ok "email accepts a normal address" "boot v_email you@example.org"
ok "email rejects a missing domain" "! boot v_email you@ >/dev/null"
ok "optional email accepts empty" "boot v_optional_email ''"
ok "listen rejects a name" "! boot v_listen localhost >/dev/null"

echo "--- guided questions (bootstrap.sh --dry-run on a terminal)"
DRY="ENV_FILE=$TMP/env CONF=$TMP/conf bash $HERE/bootstrap.sh --dry-run"
rm -f "$TMP/env" "$TMP/conf"
r=$(ptyrun "ecs.example.org|1|me@example.org||$((BASE+11))|" "$DRY")
ok "local flow: finishes cleanly and changes nothing" "echo \"\$r\" | grep -q 'EXIT=0' && echo \"\$r\" | grep -q 'Dry run, nothing was changed'"
ok "local flow: plan says Nginx here" "echo \"\$r\" | grep -q 'Nginx on this server'"
ok "local flow: asked each question" "echo \"\$r\" | grep -q 'Public hostname' && echo \"\$r\" | grep -q 'How will people reach' && echo \"\$r\" | grep -q 'TLS certificate notices' && echo \"\$r\" | grep -q 'PocketBase admin' && echo \"\$r\" | grep -q 'Local port' && echo \"\$r\" | grep -q 'Git branch'"
ok "local flow: command carries the answers" "echo \"\$r\" | grep -q -- '--branch main --setup --domain ecs.example.org --mode local --port $((BASE+11)) --email me@example.org'"
ok "local flow: no proxy questions" "! echo \"\$r\" | grep -q 'allowed to connect'"
r=$(ptyrun "ecs.example.org|2|admin@example.org|$((BASE+12))|abc|10.0.0.9|10.0.0.5,10.1.0.0/24|dev" "$DRY")
ok "proxy flow: finishes cleanly" "echo \"\$r\" | grep -q 'EXIT=0'"
ok "proxy flow: no certificate question" "! echo \"\$r\" | grep -q 'TLS certificate notices'"
ok "proxy flow: bad listen address is refused and asked again" "echo \"\$r\" | grep -q \"'abc' is not an IPv4 address\""
ok "proxy flow: plan shows address, firewall and branch" "echo \"\$r\" | grep -q 'App listens on    10.0.0.9:$((BASE+12))' && echo \"\$r\" | grep -q 'allow 10.0.0.5,10.1.0.0/24 to reach port $((BASE+12))' && echo \"\$r\" | grep -q 'Git branch        dev'"
ok "proxy flow: command carries the proxy options" "echo \"\$r\" | grep -q -- '--mode proxy --port $((BASE+12)) --superuser-email admin@example.org --listen 10.0.0.9 --proxy-ip'"
r=$(ptyrun "n" "ENV_FILE=$TMP/env CONF=$TMP/conf bash $HERE/bootstrap.sh --domain a.example --email a@example.org --port $((BASE+13)) --branch main --superuser-email a@example.org --dry-run")
ok "options given up front are not asked again" "! echo \"\$r\" | grep -q 'Public hostname' && ! echo \"\$r\" | grep -q 'Local port'"

echo "--- bootstrap.sh without a terminal"
nb() { ( cd "$TMP"; ENV_FILE="$TMP/env" CONF="$TMP/conf" timeout 20 bash "$HERE/bootstrap.sh" "$@" </dev/null 2>&1; echo "EXIT=$?" ); }
r=$(nb --yes --dry-run --domain a.example --email a@example.org --port $((BASE+14)))
ok "all required options given: works and uses defaults" "echo \"\$r\" | grep -q 'EXIT=0' && echo \"\$r\" | grep -q -- '--branch main'"
r=$(nb --yes --dry-run --email a@example.org); ok "missing domain is an error" "echo \"\$r\" | grep -q 'EXIT=1' && echo \"\$r\" | grep -q 'Public hostname'"
r=$(nb --yes --dry-run --domain a.example); ok "local mode without --email is an error" "echo \"\$r\" | grep -q 'EXIT=1' && echo \"\$r\" | grep -q 'TLS certificate notices'"
r=$(nb --yes --dry-run --domain a.example --mode proxy --listen 10.0.0.9); ok "proxy mode without --proxy-ip is an error" "echo \"\$r\" | grep -q 'EXIT=1' && echo \"\$r\" | grep -q 'proxy allowed to connect'"
r=$(nb --yes --dry-run --domain a.example --mode proxy --listen 10.0.0.9 --proxy-ip none --port $((BASE+15))); ok "proxy mode with --proxy-ip none works and says no firewall rule" "echo \"\$r\" | grep -q 'EXIT=0' && echo \"\$r\" | grep -q 'you manage it'"
r=$(nb --yes --dry-run --domain a.example --mode weird); ok "unknown mode is refused" "echo \"\$r\" | grep -q 'EXIT=1' && echo \"\$r\" | grep -q \"must be 'local' or 'proxy'\""
r=$(nb --yes --dry-run --domain 'bad host' --email a@example.org); ok "bad hostname is refused" "echo \"\$r\" | grep -q 'EXIT=1'"
r=$(nb --yes --dry-run --domain a.example --email a@example.org --port 80); ok "privileged port is refused" "echo \"\$r\" | grep -q 'EXIT=1' && echo \"\$r\" | grep -q 'not a valid port'"
r=$(nb --help); ok "--help lists the options" "echo \"\$r\" | grep -q -- '--proxy-ip' && echo \"\$r\" | grep -q -- '--dry-run' && echo \"\$r\" | grep -q 'EXIT=0'"
r=$(nb --bogus); ok "unknown option exits 2" "echo \"\$r\" | grep -q 'EXIT=2'"

echo "--- server.sh"
srv() { ( export ENV_FILE="$TMP/senv" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"; "$@" ); }
rm -f "$TMP/senv"
check "no env file: no port recorded" "$(srv current_port)" ""
printf 'APP_URL=https://x\nPW_PORT=8100\n' > "$TMP/senv"
check "current_port reads the env file" "$(srv current_port)" "8100"
srv set_env_value PW_PORT 8200; check "set_env_value replaces the line" "$(grep -c '^PW_PORT=' "$TMP/senv"):$(srv current_port)" "1:8200"
printf 'APP_URL=https://x\n' > "$TMP/senv"
srv set_env_value PW_PORT 8300; check "set_env_value adds the line when missing" "$(srv current_port)" "8300"
check "set_env_value keeps other lines" "$(grep -c '^APP_URL=' "$TMP/senv")" "1"
printf 'APP_URL=https://x\n' > "$TMP/senv"
srv ensure_port_setting; check "older install without PW_PORT gets 8090 (what it already runs on)" "$(srv current_port)" "8090"
printf 'PW_PORT=8111\n' > "$TMP/senv"
srv ensure_port_setting; check "ensure_port_setting leaves an existing port alone" "$(srv current_port)" "8111"
check "health check follows PW_PORT" "$( ( export ENV_FILE="$TMP/senv" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"; resolve_health_url; echo "$HEALTH_URL" ) )" "http://127.0.0.1:8111/api/health"
check "HEALTH_URL override still wins" "$( ( export HEALTH_URL=http://h/x ENV_FILE="$TMP/senv" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"; resolve_health_url; echo "$HEALTH_URL" ) )" "http://h/x"
ok "server valid_port rejects 80" "! srv valid_port 80"

echo "--- server.sh: listen address, health check, firewall"
printf 'APP_URL=https://x\n' > "$TMP/senv"
srv ensure_port_setting
check "older install gets PW_LISTEN=127.0.0.1" "$(srv current_listen)" "127.0.0.1"
hurl() { ( export ENV_FILE="$TMP/senv" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"; LISTEN=$1; PORT=8111; resolve_health_url; echo "$HEALTH_URL" ); }
check "health check: 0.0.0.0 is checked through localhost" "$(hurl 0.0.0.0)" "http://127.0.0.1:8111/api/health"
check "health check: a single address is asked on that address" "$(hurl 10.0.0.9)" "http://10.0.0.9:8111/api/health"
check "health check: localhost stays localhost" "$(hurl 127.0.0.1)" "http://127.0.0.1:8111/api/health"
baddr() { ( export ENV_FILE="$TMP/senv" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"; primary_ip() { echo 192.0.2.7; }; LISTEN=$1; PORT=$2; backend_address ); }
check "backend address: a single listen address" "$(baddr 10.0.0.9 8091)" "10.0.0.9:8091"
check "backend address: 0.0.0.0 becomes this server's main address" "$(baddr 0.0.0.0 8091)" "192.0.2.7:8091"
fw() {  # fw <mode> <port> <proxy ips> -> the ufw commands that setup would run
  ( export ENV_FILE="$TMP/senv" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"
    ufw() { echo "ufw $*" >> "$TMP/ufw.log"; }; rm -f "$TMP/ufw.log"; sshd() { echo "port 22"; }; systemctl() { :; }; warn() { echo "WARN $*"; }
    MODE=$1; PORT=$2; PROXY_IPS=$3; LISTEN=10.0.0.9; configure_firewall; cat "$TMP/ufw.log" )
}
out=$(fw local 8090 "")
ok "firewall, local mode: ssh, 80 and 443" "echo \"\$out\" | grep -q 'allow 22/tcp' && echo \"\$out\" | grep -q 'allow 80/tcp' && echo \"\$out\" | grep -q 'allow 443/tcp'"
ok "firewall, local mode: the app port is not opened" "! echo \"\$out\" | grep -q 'port 8090'"
out=$(fw proxy 8091 "10.0.0.5,10.1.0.0/24")
ok "firewall, proxy mode: ssh still allowed" "echo \"\$out\" | grep -q 'allow 22/tcp'"
ok "firewall, proxy mode: one rule per proxy address, for the app port only" "echo \"\$out\" | grep -q 'allow from 10.0.0.5 to any port 8091 proto tcp' && echo \"\$out\" | grep -q 'allow from 10.1.0.0/24 to any port 8091 proto tcp'"
ok "firewall, proxy mode: 80 and 443 stay closed" "! echo \"\$out\" | grep -q 'allow 80/tcp' && ! echo \"\$out\" | grep -q 'allow 443/tcp'"
out=$(fw proxy 8091 "none")
ok "firewall, proxy mode with 'none': no rule, with a warning" "! echo \"\$out\" | grep -q 'allow from' && echo \"\$out\" | grep -q 'WARN No firewall rule'"
out=$(fw proxy 8091 "10.0.0.5, 10.1.0.0/24")
ok "firewall: spaces in the list are ignored" "echo \"\$out\" | grep -q 'allow from 10.1.0.0/24 to any port 8091'"

echo "--- server.sh: full setup run with the system steps stubbed"
sim() {  # sim <setup options...> -> output, plus what was called
  ( export ENV_FILE="$TMP/simenv" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"
    rm -f "$ENV_FILE"
    for f in install_packages create_user_and_dirs install_pocketbase install_service install_backup do_release create_superuser; do eval "$f() { echo CALLED:$f; }"; done
    write_env_file() { echo CALLED:write_env_file; printf 'APP_URL=https://x\n' > "$ENV_FILE"; }
    install_nginx() { echo CALLED:install_nginx; }
    configure_firewall() { echo "CALLED:configure_firewall mode=$MODE listen=$LISTEN ips=$PROXY_IPS port=$PORT"; }
    primary_ip() { echo 192.0.2.7; }
    cmd_setup "$@"; echo "ENVFILE:"; cat "$ENV_FILE" )
}
out=$(sim --domain a.example --email a@example.org --port 8123 2>&1)
ok "setup, local: installs Nginx and sets up the firewall" "echo \"\$out\" | grep -q 'CALLED:install_nginx' && echo \"\$out\" | grep -q 'CALLED:configure_firewall mode=local listen=127.0.0.1'"
ok "setup, local: env file records the settings" "echo \"\$out\" | grep -q '^PW_PORT=8123' && echo \"\$out\" | grep -q '^PW_LISTEN=127.0.0.1' && echo \"\$out\" | grep -q '^PW_MODE=local'"
ok "setup, local: no proxy instructions" "! echo \"\$out\" | grep -q 'On the reverse proxy server'"
out=$(sim --domain a.example --mode proxy --listen 10.0.0.9 --proxy-ip 10.0.0.5 --port 8124 2>&1)
ok "setup, proxy: Nginx is not installed" "! echo \"\$out\" | grep -q 'CALLED:install_nginx'"
ok "setup, proxy: firewall gets mode, listen address, proxy and port" "echo \"\$out\" | grep -q 'CALLED:configure_firewall mode=proxy listen=10.0.0.9 ips=10.0.0.5 port=8124'"
ok "setup, proxy: env file records the settings" "echo \"\$out\" | grep -q '^PW_LISTEN=10.0.0.9' && echo \"\$out\" | grep -q '^PW_MODE=proxy' && echo \"\$out\" | grep -q '^PW_PROXY_IPS=10.0.0.5' && echo \"\$out\" | grep -q '^PW_PORT=8124'"
ok "setup, proxy: prints a ready-to-paste proxy config" "echo \"\$out\" | grep -q 'On the reverse proxy server' && echo \"\$out\" | grep -q 'server_name a.example;' && echo \"\$out\" | grep -q 'proxy_pass http://10.0.0.9:8124;'"
ok "setup, proxy: the config keeps realtime unbuffered and sets X-Real-IP" "echo \"\$out\" | grep -q 'proxy_buffering off' && echo \"\$out\" | grep -q 'X-Real-IP'"
ok "setup, proxy: no placeholders left in the printed config" "! echo \"\$out\" | sed -n '/On the reverse proxy server/,/CALLED:\\|Next:/p' | grep -q '__'"
ok "setup, proxy: a certificate email is not needed" "! echo \"\$out\" | grep -q 'needs --email'"
out=$(sim --domain a.example --mode proxy --proxy-ip 10.0.0.5 --port 8124 2>&1)
ok "setup, proxy: default listen address is this server's main address" "echo \"\$out\" | grep -q '^PW_LISTEN=192.0.2.7'"
for bad in "--domain a.example --mode proxy --listen 10.0.0.9" "--domain a.example --mode proxy --listen abc --proxy-ip 10.0.0.5" "--domain a.example --mode proxy --listen 10.0.0.9 --proxy-ip 999.1.1.1" "--domain a.example --email a@x.org --mode weird" "--email a@x.org" "--domain a.example"; do
  out=$(sim $bad 2>&1); ok "setup refuses: $bad" "echo \"\$out\" | grep -q 'ERROR' && ! echo \"\$out\" | grep -q 'CALLED:install_packages'"
done
out=$(sim --domain a.example --email a@example.org --port 80 2>&1); ok "setup refuses a privileged port" "echo \"\$out\" | grep -q 'invalid port'"

echo "--- instances (--name)"
vn() { boot v_name "$1" >/dev/null; }
for v in blog ecs a b2 my-app-2; do ok "name accepts '$v'" "vn '$v'"; done
for v in "" Blog 1blog -blog "my app" "a/b" "a.b" abcdefghijklmnopqrstuvwxy; do ok "name rejects '$v'" "! vn '$v'"; done
bp() { ( unset ENV_FILE CONF SRC; export NAME=$1 BOOTSTRAP_SOURCE_ONLY=1; source "$HERE/bootstrap.sh"; echo "$SRC $KEY $ENV_FILE $CONF" ); }
check "bootstrap paths, default instance" "$(bp ecs)" "/opt/ecs-src /root/.ssh/ecs-deploy /etc/ecs/env /etc/ecs/update.conf"
check "bootstrap paths, named instance" "$(bp blog)" "/opt/blog-src /root/.ssh/blog-deploy /etc/blog/env /etc/blog/update.conf"
sp() { ( unset ENV_FILE APP DATA SVC_USER BACKUP_DIR; export NAME=$1 SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"; echo "$APP $DATA $ENV_FILE $SVC_USER $BACKUP_DIR" ); }
check "server paths, default instance " "$(sp ecs)" "/opt/ecs /var/lib/ecs /etc/ecs/env ecs /var/backups/ecs"
check "server paths, named instance" "$(sp blog)" "/opt/blog /var/lib/blog /etc/blog/env blog /var/backups/blog"
out=$(NAME='Bad Name' SERVER_SH_SOURCE_ONLY=1 bash "$HERE/server.sh" 2>&1); check "server.sh refuses a bad name" "$?" "1"
ok "server.sh says why" "echo \"\$out\" | grep -q 'invalid instance name'"
out=$(cd "$TMP" && timeout 20 bash "$HERE/bootstrap.sh" --dry-run --yes --name 'Bad Name' --domain a.example --email a@x.org --port $((BASE+20)) 2>&1); rc=$?
check "bootstrap refuses a bad --name" "$rc" "1"
ok "bootstrap explains the name rule" "echo \"\$out\" | grep -q 'not a valid name'"
out=$(cd "$TMP" && ENV_FILE="$TMP/none" CONF="$TMP/none" timeout 20 bash "$HERE/bootstrap.sh" --dry-run --yes --name blog --domain blog.example --email a@x.org --port $((BASE+20)) 2>&1); rc=$?
check "bootstrap --name dry run succeeds" "$rc" "0"
ok "plan shows the instance name" "echo \"\$out\" | grep -q 'Instance name     blog'"
ok "plan shows the instance's update command" "echo \"\$out\" | grep -q 'blog-update --branch main --setup'"
# unit file and cron line for two instances
inst() {  # inst <name> -> renders the unit and cron line into $TMP/<name>/
  ( unset ENV_FILE APP DATA SVC_USER BACKUP_DIR; export NAME=$1 SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"
    mkdir -p "$TMP/$1/units" "$TMP/$1/cron" "$TMP/$1/app"
    UNIT_DIR="$TMP/$1/units"; CRON_DIR="$TMP/$1/cron"; APP="$TMP/$1/app"
    systemctl() { :; }
    install_service >/dev/null; install_backup ) >/dev/null 2>&1
}
inst ecs; inst blog
ok "default unit: user, paths and env file as before" "grep -q '^User=ecs' $TMP/ecs/units/ecs.service && grep -q '^EnvironmentFile=/etc/ecs/env' $TMP/ecs/units/ecs.service && grep -q -- '--dir /var/lib/ecs/pb_data' $TMP/ecs/units/ecs.service"
ok "named unit: own file, user, env file and data folder" "grep -q '^User=blog' $TMP/blog/units/blog.service && grep -q '^EnvironmentFile=/etc/blog/env' $TMP/blog/units/blog.service && grep -q -- '--dir /var/lib/blog/pb_data' $TMP/blog/units/blog.service && grep -q '^ReadWritePaths=/var/lib/blog' $TMP/blog/units/blog.service"
ok "named unit: nothing of the default instance left" "! grep -q 'ecs\|ecs' $TMP/blog/units/blog.service"
ok "units keep the port settings from the env file" "grep -q -- '--http \${PW_LISTEN}:\${PW_PORT}' $TMP/blog/units/blog.service"
ok "no placeholders left in a unit" "! grep -q '__[A-Z]*__' $TMP/blog/units/blog.service"
ok "named cron: own file, user, data and backup folder" "grep -q ' blog DATA=/var/lib/blog/pb_data OUT=/var/backups/blog ' $TMP/blog/cron/blog && grep -q 'logger -t blog-backup' $TMP/blog/cron/blog"
ok "default cron: backs up the default data" "grep -q ' ecs DATA=/var/lib/ecs/pb_data OUT=/var/backups/ecs ' $TMP/ecs/cron/ecs"
# update.sh learns the name from its own file name
cp "$HERE/update.sh" "$TMP/blog-update"; cp "$HERE/update.sh" "$TMP/update.sh"
if [ "$(id -u)" = 0 ]; then
  out=$(bash "$TMP/blog-update" 2>&1); ok "update command named blog-update looks in /opt/blog-src" "echo \"\$out\" | grep -q '/opt/blog-src'"
  out=$(bash "$TMP/update.sh" 2>&1); ok "update.sh run directly uses the default instance" "echo \"\$out\" | grep -q '/opt/ecs-src'"
  out=$(NAME=other bash "$TMP/update.sh" 2>&1); ok "NAME in the environment overrides" "echo \"\$out\" | grep -q '/opt/other-src'"
else
  echo "SKIP update.sh name tests (need root)"
fi

echo "--- ECS specifics: env file, PIN, settings"
EE="$TMP/eenv"
es() { ( export ENV_FILE="$EE" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"; chown() { :; }; "$@" ); }
we() { ( export ENV_FILE="$EE" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"; chown() { :; }
  DOMAIN=ecs.example; ADMIN_PIN=$1; NEW_PIN=; FIRST_RUN=0; rm -f "$ENV_FILE"; write_env_file >/dev/null; echo "PIN=$NEW_PIN FIRST=$FIRST_RUN" ); }
out=$(we ""); ok "new env file: a 6 digit admin PIN is generated" "echo \"\$out\" | grep -qE '^PIN=[0-9]{6} FIRST=1'"
pin=$(echo "$out" | sed -n 's/^PIN=\([0-9]*\) .*/\1/p')
ok "new env file: the PIN is written for the first start" "grep -q \"^ECS_ADMIN_PIN=$pin\$\" $EE"
ok "new env file: APP_URL follows the domain" "grep -q '^APP_URL=https://ecs.example\$' $EE"
ok "new env file: keeps the settings block from .env.example" "grep -q '^PW_PORT=' $EE && grep -q '^APRS_FI_API_KEY=' $EE"
out=$(we 4321); ok "a PIN given with --admin-pin is used as is" "echo \"\$out\" | grep -q '^PIN=4321 ' && grep -q '^ECS_ADMIN_PIN=4321\$' $EE"
printf 'APRS_FI_API_KEY=\nECS_MAIL_FROM_NAME="SWCRS ECS"\nPW_PORT=8090\n' > "$EE"
es set_env_quoted ECS_MAIL_FROM_NAME 'Field Day Net'
check "set_env_quoted replaces the value, quoted, once" "$(grep -c '^ECS_MAIL_FROM_NAME=' $EE):$(sed -n 's/^ECS_MAIL_FROM_NAME=//p' $EE)" '1:"Field Day Net"'
es set_env_quoted APRS_FI_API_KEY abc123; check "set_env_quoted adds a value for an empty key" "$(sed -n 's/^APRS_FI_API_KEY=//p' $EE)" '"abc123"'
check "set_env_quoted leaves other lines alone" "$(grep -c '^PW_PORT=8090' $EE)" "1"
for bad in 'a"b' 'a\b' 'a$b'; do ok "set_env_quoted refuses a value like $bad" "! es set_env_quoted X '$bad' >/dev/null 2>&1"; done
ok "apply_optional_env writes only what was given" "( export ENV_FILE=$EE SERVER_SH_SOURCE_ONLY=1; source $HERE/server.sh; APRS_KEY=k2; MAIL_NAME=; MAIL_ADDR=; apply_optional_env ) && grep -q '^APRS_FI_API_KEY=\"k2\"\$' $EE && grep -q '^ECS_MAIL_FROM_NAME=\"Field Day Net\"\$' $EE"

seed() {  # seed <curl exit code> -> output; env file left for inspection
  ( export ENV_FILE="$EE" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"
    printf 'PW_PORT=8123\nECS_ADMIN_PIN=123456\n' > "$ENV_FILE"; rm -f "$TMP/curl.log"
    curl() { echo "$*" >> "$TMP/curl.log"; return "$1_RC"; }
    CODE=$1; curl() { echo "$*" >> "$TMP/curl.log"; return "$CODE"; }
    warn() { echo "WARN $*"; }; HEALTH_URL=http://127.0.0.1:8123/api/health; NEW_PIN=123456; seed_admin_pin )
}
out=$(seed 0); ok "seeding: opens the app's public events page once" "grep -q 'http://127.0.0.1:8123/api/ecs/public-events' $TMP/curl.log"
ok "seeding: PIN line is removed from the env file after it works" "! grep -q '^ECS_ADMIN_PIN=' $EE && grep -q '^PW_PORT=8123' $EE"
out=$(seed 22); ok "seeding: if the app cannot be reached the PIN line stays, with a warning" "grep -q '^ECS_ADMIN_PIN=123456' $EE && echo \"\$out\" | grep -q 'WARN Could not open the app'"
check "seeding: nothing to do on an update (no new PIN)" "$( ( export ENV_FILE=$EE SERVER_SH_SOURCE_ONLY=1; source $HERE/server.sh; curl() { echo CALLED; }; NEW_PIN=; seed_admin_pin ) )" ""

pbs() {  # pbs <superuser password> <smtp host> -> what pb-settings.mjs would receive
  ( export ENV_FILE="$EE" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"
    node() { env | grep '^PB_' | sort; }; warn() { echo "WARN $*"; }
    HEALTH_URL=http://127.0.0.1:8123/api/health; DOMAIN=ecs.example; SUPERUSER_EMAIL=a@example.org; SUPERUSER_PW=$1
    SMTP_HOST=$2; SMTP_PORT=2525; SMTP_USER=u; SMTP_PASS=p; SMTP_TLS=1; MAIL_NAME="My Net"; MAIL_ADDR=net@example.org
    apply_pb_settings )
}
out=$(pbs secret smtp.example.org)
ok "settings: site address, trusted proxy and superuser login are passed" "echo \"\$out\" | grep -q '^PB_URL=http://127.0.0.1:8123\$' && echo \"\$out\" | grep -q '^PB_APP_URL=https://ecs.example\$' && echo \"\$out\" | grep -q '^PB_TRUSTED_PROXY=1\$' && echo \"\$out\" | grep -q '^PB_SUPERUSER_PASSWORD=secret\$'"
ok "settings: SMTP and sender are passed when given" "echo \"\$out\" | grep -q '^PB_SMTP_HOST=smtp.example.org\$' && echo \"\$out\" | grep -q '^PB_SMTP_PORT=2525\$' && echo \"\$out\" | grep -q '^PB_SMTP_TLS=1\$' && echo \"\$out\" | grep -q '^PB_SENDER_ADDRESS=net@example.org\$'"
out=$(pbs secret ""); ok "settings: no SMTP variables without --smtp-host" "! echo \"\$out\" | grep -q 'PB_SMTP_HOST'"
out=$(pbs "" smtp.example.org); ok "settings: without a superuser from this run they are skipped, with a warning" "echo \"\$out\" | grep -q 'WARN PocketBase settings' && ! echo \"\$out\" | grep -q '^PB_URL'"

echo "--- ECS specifics: setup flow"
sim2() {  # sim2 <first run 1|0> <setup options...>
  ( export ENV_FILE="$TMP/simenv2" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"
    FR=$1; shift; rm -f "$ENV_FILE"
    for f in install_packages create_user_and_dirs install_pocketbase install_service install_backup do_release seed_admin_pin apply_pb_settings install_nginx configure_firewall; do eval "$f() { echo CALLED:$f; }"; done
    write_env_file() { printf 'APP_URL=https://x\n' > "$ENV_FILE"; FIRST_RUN=$FR; if [ "$FR" = 1 ]; then NEW_PIN=246810; fi; }
    create_superuser() { echo "SUPERUSER:${SUPERUSER_EMAIL:-none}"; }
    cmd_setup "$@" )
}
out=$(sim2 1 --domain a.example --email a@example.org --port 8123 2>&1)
ok "first install: a superuser is created even without --superuser-email" "echo \"\$out\" | grep -q 'SUPERUSER:admin@ecs.local'"
ok "first install: the PIN is seeded and settings applied after the release" "echo \"\$out\" | grep -q 'CALLED:seed_admin_pin' && echo \"\$out\" | grep -q 'CALLED:apply_pb_settings'"
ok "first install: the admin PIN is shown once" "echo \"\$out\" | grep -q 'Admin PIN:       246810'"
ok "first install: no webhook secret from the other app is shown" "! echo \"\$out\" | grep -qi 'webhook'"
out=$(sim2 1 --domain a.example --email a@example.org --port 8123 --superuser-email me@example.org 2>&1); ok "first install: --superuser-email is respected" "echo \"\$out\" | grep -q 'SUPERUSER:me@example.org'"
out=$(sim2 0 --domain a.example --email a@example.org --port 8123 2>&1); ok "update of an existing install: no superuser is created or reset" "echo \"\$out\" | grep -q 'SUPERUSER:none' && ! echo \"\$out\" | grep -q 'Admin PIN:'"
for bad in "--admin-pin ab" "--admin-pin 'a b c d'" "--smtp-port abc"; do
  out=$(sim2 1 --domain a.example --email a@example.org $bad 2>&1); ok "setup refuses: $bad" "echo \"\$out\" | grep -q 'ERROR' && ! echo \"\$out\" | grep -q 'CALLED:install_packages'"
done
out=$(sim2 1 --domain a.example --mode proxy --listen 10.0.0.9 --proxy-ip 10.0.0.5 --port 8124 2>&1)
ok "proxy mode: a Caddy site block is saved next to the Nginx one" "grep -q '^a.example {' $TMP/Caddyfile-proxy.conf && grep -q 'reverse_proxy 10.0.0.9:8124' $TMP/Caddyfile-proxy.conf && grep -q 'flush_interval -1' $TMP/Caddyfile-proxy.conf"
ok "proxy mode: the printed instructions mention it" "echo \"\$out\" | grep -q 'Caddyfile-proxy.conf'"
mkdir -p "$TMP/legacy/ecs"; echo "PORT=8090" > "$TMP/legacy/ecs/instance.conf"
out=$( ( export ENV_FILE="$TMP/legacy/ecs/env" SERVER_SH_SOURCE_ONLY=1; source "$HERE/server.sh"; install_packages() { echo CALLED:install_packages; }; cmd_setup --domain a.example --email a@x.org --port 8123 ) 2>&1 )
ok "an install from the old ECS installer is not overwritten" "echo \"\$out\" | grep -q 'previous ECS installer' && ! echo \"\$out\" | grep -q 'CALLED:install_packages'"

echo "--- ECS specifics: bootstrap forwards the extra options"
out=$(nb --yes --dry-run --domain a.example --email a@example.org --port $((BASE+21)) --admin-pin 4321 --aprs-key K1 --mail-from-name Net --mail-from-address n@example.org --smtp-host smtp.example.org --smtp-user u --smtp-pass p --smtp-tls)
ok "dry run exits cleanly" "echo \"\$out\" | grep -q 'EXIT=0'"
ok "command carries PIN, APRS key and sender" "echo \"\$out\" | grep -q -- '--admin-pin 4321 --aprs-key K1 --mail-from-name Net --mail-from-address n@example.org'"
ok "command carries SMTP settings with the default port" "echo \"\$out\" | grep -q -- '--smtp-host smtp.example.org --smtp-port 587 --smtp-user u --smtp-pass p --smtp-tls'"
out=$(nb --yes --dry-run --domain a.example --email a@example.org --port $((BASE+22)))
ok "without them the command is unchanged" "! echo \"\$out\" | grep -q -- '--smtp-host' && ! echo \"\$out\" | grep -q -- '--admin-pin'"
ok "plan names the default superuser for a first install" "echo \"\$out\" | grep -q 'admin@ecs.local'"

echo "--- ECS specifics: repository layout the scripts depend on"
ok "update.sh builds app/ and stages pocketbase/ hooks and migrations" "grep -q 'cd \"\$SRC/app\"' $HERE/update.sh && grep -q '\$SRC/app/dist' $HERE/update.sh && grep -q '\$SRC/pocketbase/pb_hooks' $HERE/update.sh && grep -q 'pb-settings.mjs' $HERE/update.sh"
ok "those folders and files exist in this repository" "[ -f $HERE/../app/package.json ] && [ -d $HERE/../pocketbase/pb_hooks ] && [ -d $HERE/../pocketbase/pb_migrations ] && [ -f $HERE/pb-settings.mjs ] && [ -f $HERE/../.env.example ]"
ok "update.sh stages every file server.sh needs" "for f in server.sh backup.sh ecs.service nginx.conf pb-settings.mjs; do [ -f $HERE/\$f ] && grep -q \"\$f\" $HERE/update.sh || exit 1; done"

echo "--- uninstall-instances.sh"
U="$TMP/un"; rm -rf "$U"; mkdir -p "$U"/{units,opt,etc,lib,cron,bin,bk,tmp,ssh,nginx/sites-available,nginx/sites-enabled,caddy/conf.d}
mkdir -p "$U/opt/ecs" "$U/etc/ecs" "$U/lib/ecs/pb_data"; printf 'PW_PORT=8091\nPW_MODE=proxy\nAPP_URL=https://ecs.example.org\n' > "$U/etc/ecs/env"
printf 'User=ecs\nExecStart=%s/opt/ecs/pocketbase serve\n' "$U" > "$U/units/ecs.service"; touch "$U/cron/ecs" "$U/bin/ecs-update"
mkdir -p "$U/opt/old/bin" "$U/etc/old"; printf 'PORT=8092\nPROXY=caddy\nDOMAIN=old.example.org\n' > "$U/etc/old/instance.conf"
printf 'User=old\nExecStart=%s/opt/old/bin/pocketbase serve\n' "$U" > "$U/units/old.service"
mkdir -p "$U/opt/other"; printf 'ExecStart=%s/opt/other/pocketbase serve\n' "$U" > "$U/units/other.service"
UENV="UNIT_DIR=$U/units CRON_DIR=$U/cron BIN_DIR=$U/bin OPT_DIR=$U/opt LIB_DIR=$U/lib ETC_DIR=$U/etc BACKUP_ROOT=$U/bk TMP_DIR=$U/tmp NGINX_DIR=$U/nginx SSH_DIR=$U/ssh CADDY_DIR=$U/caddy SKIP_SYSTEMCTL=1 SKIP_ROOT_CHECK=1 ARCHIVE_DIR=$U/archive"
out=$(env $UENV bash "$HERE/uninstall-instances.sh" --dry-run 2>&1)
ok "finds the current layout and the old ECS layout" "echo \"\$out\" | grep -q 'ecs .*type=std' && echo \"\$out\" | grep -q 'old .*type=old-ecs'"
ok "ignores a PocketBase service that has no installer settings file" "! echo \"\$out\" | grep -q 'other'"
ok "dry run removes nothing" "[ -d $U/opt/ecs ] && [ -f $U/units/ecs.service ]"
env $UENV bash "$HERE/uninstall-instances.sh" --yes --purge-leftovers >/dev/null 2>&1
ok "real run removes both instances and archives them" "[ ! -e $U/opt/ecs ] && [ ! -e $U/opt/old ] && [ ! -e $U/units/ecs.service ] && [ ! -e $U/cron/ecs ] && [ -f $U/archive/ecs.tar.gz ] && [ -f $U/archive/old.tar.gz ]"
ok "real run leaves the unrelated service alone" "[ -f $U/units/other.service ] && [ -d $U/opt/other ]"

echo "--- generated config"
sed -e "s|__DOMAIN__|ecs.example.org|g" -e "s|__BACKEND__|127.0.0.1:8123|g" "$HERE/nginx.conf" > "$TMP/site.conf"
check "nginx: no placeholders left" "$(grep -c '__' "$TMP/site.conf")" "0"
check "nginx: every proxy_pass uses the chosen port" "$(grep -c 'proxy_pass http://127.0.0.1:8123;' "$TMP/site.conf")" "3"
check "nginx: old fixed port is gone" "$(grep -c '8090' "$TMP/site.conf")" "0"
ok "systemd unit reads address and port from the env file" "grep -q -- '--http \${PW_LISTEN}:\${PW_PORT}' '$HERE/ecs.service'"
ok "systemd unit loads the instance's env file" "grep -q '^EnvironmentFile=__ENV_FILE__' '$HERE/ecs.service'"
check "nginx: X-Forwarded-For is set from the connecting address, never appended" "$(grep -c 'X-Forwarded-For \$remote_addr;' "$TMP/site.conf"):$(grep -c 'proxy_add_x_forwarded_for' "$TMP/site.conf")" "2:0"
ok "nginx: realtime stays unbuffered with a long timeout" "grep -q 'proxy_buffering off' '$TMP/site.conf' && grep -q 'proxy_read_timeout 3h' '$TMP/site.conf'"
ok "systemd unit serves the single-page app for every route" "grep -q -- '--indexFallback=true' '$HERE/ecs.service'"
ok ".env.example documents the settings" "grep -q '^PW_PORT=8090' '$HERE/../.env.example' && grep -q '^PW_LISTEN=127.0.0.1' '$HERE/../.env.example' && grep -q '^PW_MODE=local' '$HERE/../.env.example'"

echo
[ "$FAILS" = 0 ] && echo "ALL PASSED" || echo "$FAILS FAILED"
exit $((FAILS > 0))
