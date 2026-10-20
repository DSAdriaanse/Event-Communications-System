# Deploying ECS on Debian

ECS is installed the same way as the other apps built on this stack (Priority-Watch, Round-Table-Net): one guided
installer, one update command, hourly backups, and every name derived from `--name`, so several apps can share a server.

Layout on the server (default name `ecs`; with `--name foo` replace `ecs` by `foo`):

| Path | Contents |
|---|---|
| `/opt/ecs/pocketbase` | PocketBase binary (v0.40.x) |
| `/opt/ecs/pb_migrations`, `pb_hooks` | copied from `pocketbase/` in the repo |
| `/opt/ecs/dist` | built front end (`app/dist`) |
| `/opt/ecs/backup.sh` | backup script run by cron |
| `/opt/ecs-src` | git clone that `ecs-update` pulls from and builds |
| `/var/lib/ecs/pb_data` | the database and uploads (back this up) |
| `/etc/ecs/env` | settings and secrets, mode 640 (see `.env.example`) |
| `/var/backups/ecs` | hourly backups, kept 14 days |

## Scripted install on the server (recommended)

Prerequisites: a Debian or Ubuntu server you can ssh into as root. If Nginx and the certificate live on this server, DNS for
the hostname must already point at it. The code must be on the branch you install (`main` by default; pass `--branch dev` to try `dev`).

```bash
scp deploy/bootstrap.sh root@your-server:
ssh root@your-server
bash bootstrap.sh --domain ecs.apps.swcrs.org --email you@example.org
```

Run it with no options and it asks what it needs, shows a plan, and waits for a yes:

1. Public hostname (default: the one from a previous install).
2. How people reach the app: **1** Nginx and a Let's Encrypt certificate on this server, or **2** an external reverse proxy (see below).
3. Local mode only: email for certificate notices.
4. PocketBase admin email (Enter for `admin@<name>.local`; only used on a first install).
5. Local port (suggests the first free one from 8090 up; 1024 to 65535, refuses one in use).
6. Proxy mode only: the address to listen on and which proxy addresses may connect.
7. Git branch.

Anything passed as an option is not asked again: `--domain --mode local|proxy --email --superuser-email --port --listen --proxy-ip --branch --name --repo --yes --dry-run`.
`--dry-run` asks and prints the plan without changing anything. `--yes` (or no terminal) never asks; it uses the options and defaults and stops with a clear message if something required is missing.

ECS options (all optional, none is asked): `--admin-pin`, `--aprs-key`, `--mail-from-name`, `--mail-from-address`,
`--smtp-host --smtp-port --smtp-user --smtp-pass [--smtp-tls]`. Without `--admin-pin` a random 6 digit PIN is generated.
SMTP can also be set later in the PocketBase admin (`/_/`, Settings, Mail settings).

The script installs Node 22, gets the code from the repository (public, so over HTTPS, no key needed), builds it, and sets up
PocketBase, systemd, the firewall and hourly backups, plus Nginx and TLS in local mode. For a private copy of the repo pass
`--repo git@github.com:you/your-copy.git`; it then shows a read-only deploy key to add on GitHub.

On a first install it also:
- creates the PocketBase superuser (the database admin, separate from the app's PIN login) and applies the PocketBase settings
  ECS needs: the public site address and the trusted proxy header (so the PIN-login rate limit sees real client addresses) plus
  SMTP if given;
- seeds the first admin PIN into the blank database, then removes it from the env file.

The superuser login and the admin PIN are printed once. Save them.

Update later, from the server:

```bash
ecs-update                  # pull, build, back up, restart, health check, roll back if unhealthy
ecs-update --branch main    # switch branch
```

A tiny server (under 2 GB RAM) may struggle with the front-end build. Add a swap file before running an update.
Rolling back restores the previous code only. Migrations that already ran are not undone, so restore a backup if the schema changed.

Re-running setup is safe (for example after fixing DNS when certbot failed). It never touches your env file values, the data, or the superuser of an existing install, except for options you pass again.

### The port

The chosen port is saved as `PW_PORT` in `/etc/ecs/env`. The systemd unit reads it from there and setup writes it into the Nginx site. To change it later, re-run setup with the new port:

```bash
ecs-update --setup --domain ecs.apps.swcrs.org --email you@example.org --port 8095   # add --mode proxy --listen ... --proxy-ip ... for proxy mode
```

Do not just edit `PW_PORT` by hand; Nginx would still point at the old port.

### External reverse proxy (several servers)

Pick mode 2 (or `--mode proxy`) when Nginx or Caddy and TLS live on another machine. Setup then does not install Nginx or certbot. The app listens on the address you give (for example this server's LAN address), and ufw allows only your proxy addresses to reach the app port (`--proxy-ip 10.0.0.5,10.1.0.0/24`, or `none` to manage the firewall yourself; ports 80 and 443 stay closed).

```bash
bash bootstrap.sh --domain ecs.apps.swcrs.org --mode proxy --listen 10.0.0.9 --proxy-ip 10.0.0.5 --port 8090
```

At the end setup prints a ready-to-paste Nginx site and saves it as `/etc/ecs/nginx-proxy.conf`; a Caddy site block is saved as
`/etc/ecs/Caddyfile-proxy.conf`. Copy the one you need to the proxy, get the certificate there, and reload. Keep these two things:
- `proxy_buffering off` and the long read timeout on `/api/realtime` (Caddy: `flush_interval -1`), or live updates stop;
- `X-Forwarded-For` set to the connecting address, never appended to. ECS trusts the leftmost entry for its PIN-login rate limit, so a client must not be able to send its own.

The app uses a single SQLite database, so run exactly one app server behind the proxy. The proxy can be shared, but the app cannot be load balanced.

### Second instance on the same server

Give the second copy its own name. Everything is named after it, so nothing is shared with the first install except Node, Nginx and the firewall:

```bash
bash bootstrap.sh --name ecs-demo --domain demo.example.org --email you@example.org
```

| Thing | Default instance (`ecs`) | `--name ecs-demo` |
|---|---|---|
| Service, service user | `ecs` | `ecs-demo` |
| Code, git clone | `/opt/ecs`, `/opt/ecs-src` | `/opt/ecs-demo`, `/opt/ecs-demo-src` |
| Data, backups | `/var/lib/ecs`, `/var/backups/ecs` | `/var/lib/ecs-demo`, `/var/backups/ecs-demo` |
| Settings | `/etc/ecs/env` | `/etc/ecs-demo/env` |
| Nginx site, backup job | `ecs` | `ecs-demo` |
| Update command | `ecs-update` | `ecs-demo-update` |

The name is 1 to 24 characters: lowercase letters, digits and dashes, starting with a letter. The installer suggests a free port for each instance. Without `--name`, running the installer again updates the existing install in place; the plan it prints says so.

## Upgrading from the old installer

Installs made before this layout existed kept everything under `/opt/<name>` and their settings in `/etc/<name>/instance.conf`. The new installer refuses to touch such an install. Move to the new layout like this (replace `ecs` with your instance name):

```bash
# 1. stop it and keep a copy of the data
systemctl stop ecs
cp -a /opt/ecs/data/pb_data /root/ecs-pb_data-backup

# 2. remove the old install (copy deploy/uninstall-instances.sh to the server first; it asks, and archives the data first)
bash uninstall-instances.sh --only ecs

# 3. install with the new installer, then put the data back
bash bootstrap.sh --name ecs --domain ecs.apps.swcrs.org --mode proxy --listen ... --proxy-ip ...
systemctl stop ecs
rm -rf /var/lib/ecs/pb_data && cp -a /root/ecs-pb_data-backup /var/lib/ecs/pb_data
chown -R ecs:ecs /var/lib/ecs/pb_data
systemctl start ecs
```

The PINs, settings and the old PocketBase superuser live in the database, so they come back with it (the old superuser login is in the archive the removal step made, as `etc/ecs/credentials.txt`). The new superuser and PIN printed in step 3 are replaced by the old ones. Check the app and the PocketBase admin login before deleting the backup copy.

## Removing instances

`deploy/uninstall-instances.sh` finds every instance on the server (this layout and the old ECS one), lists them, and removes the ones you pick (or all): service, backup job, code, data, settings, backups, update command, service user, proxy firewall rule, Nginx site and certificate, deploy key. It saves an archive of each database first. Run it with `--dry-run` to see the plan; `--help` lists the options.

## Manual install (what the script does)

```bash
sudo apt install nginx certbot python3-certbot-nginx sqlite3 unzip
sudo useradd --system --home /var/lib/ecs --shell /usr/sbin/nologin ecs
sudo install -d -o ecs -g ecs /var/lib/ecs /opt/ecs /var/backups/ecs
sudo install -d -m 750 -g ecs /etc/ecs

# PocketBase binary: download the linux_amd64 zip from github.com/pocketbase/pocketbase/releases
sudo unzip pocketbase_*_linux_amd64.zip pocketbase -d /opt/ecs

# Code (build on your workstation or the server: cd app && npm ci && npm run build)
sudo rsync -a pocketbase/pb_migrations pocketbase/pb_hooks /opt/ecs/
sudo rsync -a --delete app/dist/ /opt/ecs/dist/
sudo install -m 755 deploy/backup.sh /opt/ecs/backup.sh

sudo cp .env.example /etc/ecs/env   # then edit it: set ECS_ADMIN_PIN, APP_URL, PW_PORT=8090, PW_LISTEN=127.0.0.1
sudo chmod 640 /etc/ecs/env; sudo chown root:ecs /etc/ecs/env

sudo sed -e 's|__NAME__|ecs|g; s|__USER__|ecs|g; s|__APP__|/opt/ecs|g; s|__DATA__|/var/lib/ecs|g; s|__ENV_FILE__|/etc/ecs/env|g' \
  deploy/ecs.service | sudo tee /etc/systemd/system/ecs.service >/dev/null
sudo sed 's/__DOMAIN__/ecs.apps.swcrs.org/; s/__BACKEND__/127.0.0.1:8090/' deploy/nginx.conf | sudo tee /etc/nginx/sites-available/ecs >/dev/null
sudo ln -s /etc/nginx/sites-available/ecs /etc/nginx/sites-enabled/
sudo certbot --nginx -d ecs.apps.swcrs.org
sudo systemctl daemon-reload && sudo systemctl enable --now ecs
sudo nginx -t && sudo systemctl reload nginx
curl -fsS http://127.0.0.1:8090/api/ecs/public-events >/dev/null   # seeds the admin PIN on a blank database
```

Create the PocketBase superuser, then set the site address and trusted proxy header (`deploy/pb-settings.mjs` documents its variables):

```bash
sudo -u ecs /opt/ecs/pocketbase superuser upsert you@example.org 'a-long-password' --dir /var/lib/ecs/pb_data --migrationsDir /opt/ecs/pb_migrations
PB_URL=http://127.0.0.1:8090 PB_SUPERUSER_EMAIL=you@example.org PB_SUPERUSER_PASSWORD='a-long-password' \
  PB_APP_URL=https://ecs.apps.swcrs.org PB_TRUSTED_PROXY=1 node deploy/pb-settings.mjs
```

The admin UI is at `/_/`. Restrict it by IP in `nginx.conf` if you like.

## Load your data

To bring data over from the old Base44 app, see [`migration/README.md`](../migration/README.md). From any computer with Node 18 or later:

```bash
node migration/import-base44.mjs --json ./migration/base44-export/export.json --url https://ecs.apps.swcrs.org \
     --email you@example.org --password '...' --dry-run     # check the counts, then run again without --dry-run
```

Or start empty and create events in the app.

## Backups

`deploy/backup.sh` takes a consistent SQLite backup of the database and uploads and prunes after 14 days. Setup schedules it hourly through `/etc/cron.d/<name>`, and `ecs-update` takes one before every release. Copy `/var/backups/ecs` off the machine too (rsync, rclone, restic). Restore: stop the service, unpack the tarball into `/var/lib/ecs/pb_data`, fix ownership (`chown -R ecs:ecs`), start. PINs are in the database in clear text, so treat backups as secrets.

## Upgrades

App: run `ecs-update` on the server.
PocketBase itself: back up, then re-run `setup` with `PB_VERSION=x.y.z` set in the server environment (or replace the binary by hand), and restart. Read the release notes first; it is pre-1.0.

## Troubleshooting

- App will not start after choosing a port: another program may be using it (`ss -ltnp | grep :PORT`). Re-run setup with a free `--port`.
- Live updates stop: the proxy is buffering `/api/realtime`. Use the supplied config.
- Too many PIN failures from everyone at once: the proxy is not passing the client address. Check `X-Forwarded-For` and that the PocketBase trusted proxy setting is on (Settings, Application, in `/_/`).
- No e-mail: set the mail server in `/_/` under Settings, Mail settings, and send a test.
- Logs: `journalctl -u ecs -f`.
