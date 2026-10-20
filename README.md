# ECS – Event Communications System (standalone)

Net-control / event-communications suite for amateur-radio support of events (aid stations, operators, frequencies,
assignments, comms log, resource requests, bib tracking, ICS forms, bulletins, live map).
A **self-hosted, single-binary stack on PocketBase**:

| Layer | What |
|---|---|
| Server | [PocketBase](https://pocketbase.io) 0.40.5 – database, REST + realtime API, static hosting of the UI |
| Server logic | JavaScript hooks in `pocketbase/pb_hooks` (PIN login, reports, ICS e-mail, export/import, APRS.fi poller) |
| Schema | `pocketbase/pb_migrations` (applied automatically on start) |
| UI | React/Vite app in `app/`, talking to PocketBase through `app/src/api/ecs.js` |
| Ops | `deploy/` (Debian/Ubuntu): guided installer, `ecs-update`, backups, removal. See `docs/deployment.md` |

## Install on a Debian / Ubuntu server

On your own computer, copy the installer to the server and run it:

```bash
scp deploy/bootstrap.sh root@your-server:
ssh root@your-server
bash bootstrap.sh
```

It asks a few questions (hostname, whether Nginx runs here or on another machine, a port, a contact email for the certificate,
the git branch), shows a plan, and waits for a yes before changing anything. Every question also has an option, so it runs
unattended with `--yes`; `--dry-run` only prints the plan.

```bash
bash bootstrap.sh --yes --domain ecs.example.org --email you@example.org      # Nginx + TLS on this server
bash bootstrap.sh --yes --domain ecs.example.org --mode proxy --listen 10.0.0.9 --proxy-ip 10.0.0.5   # your own reverse proxy
```

When it finishes you have PocketBase, the app, systemd, a firewall, hourly backups, and Nginx with TLS (or a ready-to-paste proxy
config). It prints the PocketBase superuser login and the first admin PIN once. Save them. Update later with `ecs-update`
(it backs up, health-checks, and rolls back if the new version does not start).

Everything is named after `--name` (default `ecs`), so a second copy, or another app built the same way, can share the server.
The full guide (proxy mode, second instance, ports, backups and restore, moving from the old installer, manual install) is in
[`docs/deployment.md`](docs/deployment.md). Pass `--smtp-*`, `--aprs-key`, `--mail-from-*` and `--admin-pin` to set those up
during install.

Behind a proxy the installer sets PocketBase's trusted-proxy header (`X-Forwarded-For`) so the PIN-login throttling sees real client
addresses. The supplied proxy config sets that header to the connecting address and never appends to it.

To remove instances later: `bash deploy/uninstall-instances.sh` lists every instance on the server and removes the ones you pick.

## Importing data from the legacy Base44 deployment (optional, one time)

See [`migration/README.md`](migration/README.md). Place the exported CSVs in `migration/base44-export/` (git-ignored) and run
the importer from any computer with Node 18 or later. Ids and timestamps are preserved.

## How it works

### Authentication (PIN model, now enforced by the server)
`POST /api/ecs/login` verifies the PIN on the server and issues a real
PocketBase token for a service account in `ecs_users` (`admin`, or `event` bound to one event). The collection rules
then enforce access: an event session can only read/write records whose `event_id` is its own event; the admin session
can do everything. Brute force is throttled (10 failures / 10 min / IP). Changing a PIN revokes the sessions of that scope.
Event PINs and other events' briefing text are hidden from non-admin API responses; the admin PIN lives in `app_config`
and is readable by admins only. The PIN **list of events** on the login screen comes from `/api/ecs/public-events`
(names/status only).

Behind a proxy the bootstrap sets PocketBase's trusted-proxy header (`X-Forwarded-For`) so throttling sees real client IPs.

### Server functions (`/api/functions/<name>`)
`exportEventData`, `importEventData`, `sendICSEmail`, `aprsFiTracker` require a session.
`generatePrintableReport` (ICS 201/204/205A/213/309, resource requests, bib report, offline snapshot, full report) is
public by event id, so printed and emailed report links work without a login.

### E-mail
Bulletins and ICS forms are sent with PocketBase's mailer (**Settings → Mail settings** in `/_/`, or `--smtp-*` at install).
Without SMTP the UI reports that mail is not configured; nothing else is affected.

### APRS.fi
Set `APRS_FI_API_KEY` in `/etc/<name>/env` (or pass `--aprs-key` to the installer) and restart the service. A cron job polls every 5 minutes.

### Map tiles
The map uses CARTO dark tiles, which need internet access on the client devices. For offline events build the UI with
`VITE_TILE_URL=http://your-tile-server/{z}/{x}/{y}.png`. Marker icons are bundled locally.

## Operations

```bash
systemctl status ecs            # service state (the name is whatever you gave --name)
journalctl -u ecs -f            # logs
ecs-update                      # upgrade: pull, build, back up, restart, health check, roll back if unhealthy
```
**Backups:** taken hourly into `/var/backups/<name>` (kept 14 days) and before every update; copy that folder off the
machine. Restore steps are in [`docs/deployment.md`](docs/deployment.md). The database holds everything, including PINs in
clear text (as in the original), so treat backups as secrets.

## Development

```bash
# terminal 1: PocketBase with hooks + migrations
cd pocketbase && ECS_ADMIN_PIN=1234 pocketbase serve --http 127.0.0.1:8090 --dir ../.dev/pb_data \
   --hooksDir pb_hooks --migrationsDir pb_migrations
# terminal 2: UI with live reload (proxies /api to PocketBase)
cd app && npm install && npm run dev
```
`app/src/api/ecs.js` is the UI's data layer: `db.<collection>.list/filter/get/create/update/delete/subscribe` and
`callFunction(name, params)`. Lists that must stay current subscribe to realtime changes and refetch quietly.

## Notes

* **Module switches:** in Events > Edit, an admin can switch each module on or off per event. Operators of that event no longer see disabled modules in the sidebar (or on the mobile entry tabs) and get a notice if they open the URL; admins see everything, with disabled modules dimmed. This is a UI-level switch, not a data-access rule.
* Access is PIN based (admin PIN, per-event PIN); there are no individual user accounts.
* Documents are links to files hosted elsewhere.
* E-mail goes through your own SMTP server.
* Deleting an event cascades to all of its records in the database; no cleanup job is needed.
