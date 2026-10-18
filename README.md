# ECS – Event Communications System (standalone)

Net-control / event-communications suite for amateur-radio support of events (aid stations, operators, frequencies,
assignments, comms log, resource requests, bib tracking, ICS forms, bulletins, live map).
This is the former Base44 app converted into a **self-hosted, single-binary stack on PocketBase**:

| Layer | What |
|---|---|
| Server | [PocketBase](https://pocketbase.io) 0.40.5 – database, REST + realtime API, static hosting of the UI |
| Server logic | JavaScript hooks in `pocketbase/pb_hooks` (PIN login, reports, ICS e-mail, export/import, APRS.fi poller) |
| Schema | `pocketbase/pb_migrations` (applied automatically on start) |
| UI | React/Vite app in `app/` (the original UI; only its data layer was swapped for PocketBase) |
| Ops | `deploy/bootstrap.sh` (Debian/Ubuntu), `scripts/import-base44.mjs` (CSV import) |

## Install on a Debian / Ubuntu server

```bash
git clone https://github.com/DSAdriaanse/event_communications_system.git
cd event_communications_system
sudo ./deploy/bootstrap.sh --domain ecs.example.org          # with nginx/Caddy site
sudo ./deploy/bootstrap.sh                                    # plain, no proxy (LAN)
```

The script is idempotent: running it again upgrades code and keeps data, PINs and credentials.
It prints the URL, the admin PIN and where the PocketBase superuser credentials are stored
(`/etc/<instance>/credentials.txt`, root only).

### Coexisting with other PocketBase instances

Everything is namespaced by `--instance` (default `ecs`):

| Thing | Value |
|---|---|
| System user / systemd unit | `<instance>` / `<instance>.service` |
| Code, binary, data | `/opt/<instance>/{src,bin,data}` (own PocketBase binary, nothing shared) |
| Config / secrets | `/etc/<instance>/` |
| TCP port | first free port from 8090 up; ports configured in other systemd units are skipped too (`--port` to force) |
| Reverse proxy | only its own `sites-available/<instance>.conf` (nginx, validated with `nginx -t`, removed again if invalid) or `/etc/caddy/conf.d/<instance>.caddy`; existing sites and Caddyfiles are never edited |
| Node.js | system Node ≥ 18 if present, otherwise an isolated tarball under `/opt/<instance>/.build` (only for building) |

A second suite on the same host: `sudo ./deploy/bootstrap.sh --instance ecs-demo --domain demo.example.org`.

### Common options

```
--domain HOST --proxy nginx|caddy|none --certbot   public host name, proxy, Let's Encrypt
--import-dir DIR                                    import a Base44 CSV export (default: migration/base44-export if present)
--smtp-host H --smtp-port P --smtp-user U --smtp-pass PW [--smtp-tls]   e-mail for bulletins/ICS forms
--aprs-key KEY                                      aprs.fi position polling
--admin-pin PIN  --superuser-email E --superuser-password PW
--no-systemd                                        run as current user in the background (testing / containers)
--uninstall [--purge]                               remove service and proxy site (--purge also data, user, config)
```
`./deploy/bootstrap.sh --help` lists everything.

PocketBase is downloaded from GitHub releases (pinned `0.40.5`, override with `--pb-version`); if GitHub is not
reachable the script falls back to the `pocketbase-bin` wheel on PyPI.

## Migrating the Base44 data

See [`migration/README.md`](migration/README.md). Place the exported CSVs in `migration/base44-export/` (git-ignored)
and bootstrap picks them up, or run `node scripts/import-base44.mjs` later. Ids and timestamps are preserved.

## How it works

### Authentication (PIN model, now enforced by the server)
The Base44 app checked PINs in the browser. Here `POST /api/ecs/login` verifies the PIN server-side and issues a real
PocketBase token for a service account in `ecs_users` (`admin`, or `event` bound to one event). The collection rules
then enforce access: an event session can only read/write records whose `event_id` is its own event; the admin session
can do everything. Brute force is throttled (10 failures / 10 min / IP). Changing a PIN revokes the sessions of that scope.
Event PINs and other events' briefing text are hidden from non-admin API responses; the admin PIN lives in `app_config`
and is readable by admins only. The PIN **list of events** on the login screen comes from `/api/ecs/public-events`
(names/status only).

Behind a proxy the bootstrap sets PocketBase's trusted-proxy header (`X-Forwarded-For`) so throttling sees real client IPs.

### Server functions (`/api/functions/<name>`, same URLs as Base44)
`exportEventData`, `importEventData`, `sendICSEmail`, `aprsFiTracker` require a session.
`generatePrintableReport` (ICS 201/204/205A/213/309, resource requests, bib report, offline snapshot, full report) is
public by event id exactly like the original, so existing report links keep working when your old hostname points here.

### E-mail
Bulletins and ICS forms are sent with PocketBase's mailer (**Settings → Mail settings** in `/_/`, or `--smtp-*` at install).
Without SMTP the UI reports that mail is not configured; nothing else is affected.

### APRS.fi
Set `APRS_FI_API_KEY` in `/etc/<instance>/<instance>.env` and restart the unit. A cron job polls every 5 minutes.

### Map tiles
The map uses CARTO dark tiles, which need internet access on the client devices. For offline events build the UI with
`VITE_TILE_URL=http://your-tile-server/{z}/{x}/{y}.png`. Marker icons are bundled locally.

## Operations

```bash
systemctl status <instance>            # service state
journalctl -u <instance> -f            # logs
sudo ./deploy/bootstrap.sh             # upgrade to the checked-out version
```
**Backups:** copy `/opt/<instance>/data/pb_data` (stop the service or use `/_/` → Settings → Backups). It contains
everything, including PINs in clear text (as in the original).

## Development

```bash
# terminal 1: PocketBase with hooks + migrations
cd pocketbase && ECS_ADMIN_PIN=1234 pocketbase serve --http 127.0.0.1:8090 --dir ../.dev/pb_data \
   --hooksDir pb_hooks --migrationsDir pb_migrations
# terminal 2: UI with live reload (proxies /api to PocketBase)
cd app && npm install && npm run dev
```
`app/src/api/base44Client.js` is a small compatibility layer: the pages still call
`base44.entities.X.list/filter/create/update/delete/subscribe` and `base44.functions.invoke`, which now talk to PocketBase.

## Differences from the Base44 version

* No Base44 account/login; access is PIN based only (as it effectively was).
* Documents are links, as before; links that point at Base44 file storage stop working once that app is gone (re-host the files and update the links).
* E-mail goes through your SMTP server instead of Brevo.
* The nightly cleanup job is gone: deleting an event cascades to all its records in the database.
