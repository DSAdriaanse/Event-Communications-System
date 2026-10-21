/// <reference path="../pb_data/types.d.ts" />
//
// ECS server logic for PocketBase.
// NOTE: goja runs every handler in its own isolated JS VM, so handlers may not close over
// top-level variables — shared code is loaded with require() inside each handler.

// ---------------------------------------------------------------------- public routes
routerAdd("GET", "/api/ecs/health", (e) => {
  return e.json(200, { ok: true, app: "ecs", time: new Date().toISOString() });
});

// Event list for the login screens. Deliberately exposes NO pin and no briefing text.
routerAdd("GET", "/api/ecs/public-events", (e) => {
  // Lazily seed the admin PIN from ECS_ADMIN_PIN on a blank database. PocketBase JS hooks have
  // no "server started" event and migrations run after onBootstrap, so the first request does it.
  require(`${__hooks}/lib/auth.js`).seedAdminPin();
  const recs = $app.findRecordsByFilter("events", "", "-date", 1000, 0);
  return e.json(200, recs.map((r) => ({
    id: r.id,
    name: r.getString("name"),
    status: r.getString("status"),
    date: r.getString("date"),
    has_pin: !!r.getString("pin").trim(),
  })));
});

routerAdd("POST", "/api/ecs/login", (e) => require(`${__hooks}/lib/auth.js`).login(e));

// ------------------------------------------------------------- server functions API
// /api/functions/<name>. The report URL shape is stable: printed/emailed report links rely on it.
const REQUIRE_AUTH = $apis.requireAuth("ecs_users");

routerAdd("POST", "/api/functions/exportEventData", (e) => require(`${__hooks}/lib/functions.js`).exportEventData(e), REQUIRE_AUTH);
routerAdd("POST", "/api/functions/importEventData", (e) => require(`${__hooks}/lib/functions.js`).importEventData(e), REQUIRE_AUTH);
routerAdd("POST", "/api/functions/sendICSEmail", (e) => require(`${__hooks}/lib/functions.js`).sendICSEmail(e), REQUIRE_AUTH);
routerAdd("POST", "/api/functions/aprsFiTracker", (e) => {
  const r = require(`${__hooks}/lib/functions.js`).aprsFiTracker();
  return e.json(r.status, r.body);
}, REQUIRE_AUTH);

// Printable reports: HTTP GET, no auth
// ("All report URLs are simple HTTP GET requests"). The 24-char event id is the capability.
routerAdd("GET", "/api/functions/generatePrintableReport", (e) => require(`${__hooks}/lib/functions.js`).generatePrintableReport(e));
routerAdd("POST", "/api/functions/generatePrintableReport", (e) => require(`${__hooks}/lib/functions.js`).generatePrintableReport(e));

// APRS.fi position poller (every 5 minutes)
cronAdd("ecs_aprs_fi", "*/5 * * * *", () => {
  try { require(`${__hooks}/lib/functions.js`).aprsFiTracker(); } catch (err) { console.log("[ecs] aprs cron:", String(err)); }
});

// ---------------------------------------------------------------- orphaned links
// Deleting a station, frequency, operator, participant or log entry clears the links that pointed at
// it (and deletes a participant's status updates), in the same transaction as the delete.
// See lib/orphans.js. A nightly job repairs anything older (data imported from Base44, say).
onRecordDeleteExecute((e) => {
  require(`${__hooks}/lib/orphans.js`).onDelete(e.app, e.record);
  e.next();
}, "frequencies", "operators", "aide_stations", "participants", "event_logs");

// Admin-only report (GET) and repair (POST). Superusers and ECS admins only.
const ORPHAN_AUTH = $apis.requireAuth("ecs_users", "_superusers");
routerAdd("GET", "/api/ecs/admin/orphans", (e) => {
  const orphans = require(`${__hooks}/lib/orphans.js`);
  orphans.guard(e);
  const found = orphans.find($app);
  return e.json(200, { ok: true, total: found.reduce((n, f) => n + f.count, 0), orphans: found });
}, ORPHAN_AUTH);
routerAdd("POST", "/api/ecs/admin/orphans/clean", (e) => {
  const orphans = require(`${__hooks}/lib/orphans.js`);
  orphans.guard(e);
  const r = orphans.clean($app);
  return e.json(200, { ok: true, cleared: r.cleared, deleted: r.deleted });
}, ORPHAN_AUTH);

// Nightly repair of dead links. Set ECS_ORPHAN_CLEANUP=off in the env file to switch it off.
cronAdd("ecs_orphan_cleanup", "30 3 * * *", () => {
  if (String($os.getenv("ECS_ORPHAN_CLEANUP") || "").toLowerCase() === "off") return;
  try {
    const r = require(`${__hooks}/lib/orphans.js`).clean($app);
    if (r.cleared || r.deleted) console.log(`[ecs] orphan cleanup: cleared ${r.cleared} link(s), deleted ${r.deleted} record(s)`);
  } catch (err) { console.log("[ecs] orphan cleanup:", String(err)); }
});

// ------------------------------------------------------- record defaults + audit fields
// (schema defaults and created_date/updated_date/created_by)
const ECS_COLLECTIONS = [
  "events", "aide_stations", "frequencies", "operators", "assignments", "event_logs",
  "resource_requests", "participants", "participant_status_updates", "event_documents",
  "bulletins", "app_config",
];

// Browser requests can never forge audit fields.
onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const now = new Date().toISOString();
    e.record.set("created_date", now);
    e.record.set("updated_date", now);
    e.record.set("created_by", (e.auth && e.auth.getString("label")) || "");
  }
  e.next();
}, ...ECS_COLLECTIONS);

onRecordUpdateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const orig = e.record.original();
    e.record.set("created_date", orig.get("created_date"));
    e.record.set("created_by", orig.get("created_by"));
  }
  e.next();
}, ...ECS_COLLECTIONS);

onRecordCreate((e) => {
  const D = {
    events: { status: "Planning", timezone: "America/Phoenix" },
    aide_stations: { type: "Aide Station", status: "Standby", sort_order: 0, position_source: "None" },
    frequencies: { mode: "FM", use: "Primary Net", sort_order: 0 },
    operators: { status: "Available", position_source: "None" },
    assignments: { role: "Station Operator", status: "Scheduled" },
    event_logs: { type: "communication", priority: "Routine", message_type: "General" },
    resource_requests: { type: "SAG", status: "Pending", priority: "Routine" },
    participants: { status: "Active" },
    participant_status_updates: { update_type: "Seen" },
    bulletins: { priority: "Routine" },
  }[e.record.collection().name] || {};
  Object.keys(D).forEach((k) => {
    const v = e.record.get(k);
    if (v === "" || v === null || v === undefined) e.record.set(k, D[k]);
  });
  const now = new Date().toISOString();
  if (!e.record.getString("created_date")) e.record.set("created_date", now);
  if (!e.record.getString("updated_date")) e.record.set("updated_date", now);
  e.next();
}, ...ECS_COLLECTIONS);

onRecordUpdate((e) => {
  // importer (superuser) may pin an explicit updated_date; everything else gets "now"
  e.record.set("updated_date", new Date().toISOString());
  e.next();
}, ...ECS_COLLECTIONS);

// ----------------------------------------------------------------------- secrets hygiene
// Event PINs and other events' briefing text are only visible to admins / their own event.
onRecordEnrich((e) => {
  const auth = e.requestInfo && e.requestInfo.auth;
  const isSuper = e.requestInfo && e.requestInfo.hasSuperuserAuth();
  e.record.withCustomData(true);
  e.record.set("has_pin", !!e.record.getString("pin").trim());
  if (isSuper) return e.next();
  const isAdmin = auth && auth.collection().name === "ecs_users" && auth.getString("role") === "admin";
  if (isAdmin) return e.next();
  e.record.hide("pin");
  const own = auth && auth.getString("event_id") === e.record.id;
  if (!own) e.record.hide("discussion", "conops_comms", "notes", "documents_url");
  e.next();
}, "events");

// A changed PIN signs everybody out of that scope.
onRecordAfterUpdateSuccess((e) => {
  const auth = require(`${__hooks}/lib/auth.js`);
  if (e.record.collection().name === "events") {
    if (e.record.original().getString("pin") !== e.record.getString("pin")) auth.revokeSessions("event", e.record.id);
  } else if (e.record.getString("key") === "admin_pin") {
    auth.revokeSessions("admin", "");
  }
  e.next();
}, "events", "app_config");
