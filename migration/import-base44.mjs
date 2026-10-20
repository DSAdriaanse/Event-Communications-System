#!/usr/bin/env node
// One-time legacy import: a Base44 export into the ECS PocketBase. The export is either the single JSON file
// from the app's "Export all data" button, or a folder of CSV files (Event_export.csv, Operator_export.csv, ...).
//
//   node migration/import-base44.mjs --json ./migration/base44-export/export.json \
//        --url http://127.0.0.1:8090 --email admin@example.com --password '...'
//   node migration/import-base44.mjs --dir ./migration/base44-export  ...        (CSV folder)
//
// * Original Base44 record ids and created/updated timestamps are preserved, so every cross
//   reference (event_id, station ids, participant ids ...) stays valid.
// * Re-runnable: records whose id already exists are skipped.
// * Orphans are skipped: a record is left out when its event is not in the export, or when a link
//   (station, frequency, operator, participant, log entry) points at a record that is not in the
//   export. That cascades: a record that pointed at a skipped one is skipped too. Every skip is listed.
// * Needs only Node 18+ (no npm dependencies).
//
// Options
//   --json FILE         the single JSON export file (use this or --dir)
//   --dir DIR           folder holding the *_export.csv files (file name prefixes like "ab12cd34-" are fine)
//   --url URL           PocketBase base URL                      (env PB_URL,   default http://127.0.0.1:8090)
//   --email / --password  superuser credentials                  (env PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD)
//   --with-admin-pin    also import the Base44 `admin_pin` config (default: keep the PIN chosen at install)
//   --keep-orphans      also import records whose links point at nothing (default: skip them, see below)
//   --dry-run           parse and validate only, write nothing

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------- args
const args = process.argv.slice(2);
const opt = (name, env, dflt) => {
  const i = args.indexOf("--" + name);
  if (i !== -1 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1];
  return (env && process.env[env]) || dflt;
};
const flag = (name) => args.includes("--" + name);

const JSON_FILE = opt("json", null);
const DIR = opt("dir", null, "./migration/base44-export");
const URL_ = opt("url", "PB_URL", "http://127.0.0.1:8090").replace(/\/+$/, "");
const EMAIL = opt("email", "PB_SUPERUSER_EMAIL");
const PASSWORD = opt("password", "PB_SUPERUSER_PASSWORD");
const WITH_ADMIN_PIN = flag("with-admin-pin");
const DRY = flag("dry-run");
const KEEP_ORPHANS = flag("keep-orphans");

if (flag("help") || flag("h")) {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 20).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}

// ---------------------------------------------------------------- CSV
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

// ---------------------------------------------------------------- JSON export
// The JSON keeps real types (true, 5, null). Turn every value into the text a CSV cell holds, so the
// rest of the importer sees the same thing from either source.
const stringifyRow = (r) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)]));

let JSON_DATA = null;
if (JSON_FILE) {
  if (!fs.existsSync(JSON_FILE)) { console.error(`File not found: ${JSON_FILE}`); process.exit(2); }
  try { JSON_DATA = JSON.parse(fs.readFileSync(JSON_FILE, "utf8").replace(/^\uFEFF/, "")); }
  catch (e) { console.error(`${JSON_FILE} is not valid JSON: ${e.message}`); process.exit(2); }
}

// ---------------------------------------------------------------- mapping
// order matters: events first (relations)
const ENTITIES = [
  { file: "Event", col: "events" },
  { file: "AideStation", col: "aide_stations" },
  { file: "Frequency", col: "frequencies" },
  { file: "Operator", col: "operators" },
  { file: "Assignment", col: "assignments" },
  { file: "EventLog", col: "event_logs" },
  { file: "ResourceRequest", col: "resource_requests" },
  { file: "Participant", col: "participants" },
  { file: "ParticipantStatusUpdate", col: "participant_status_updates" },
  { file: "EventDocument", col: "event_documents" },
  { file: "Bulletin", col: "bulletins" },
  { file: "AppConfig", col: "app_config" },
];
const DROP = new Set(["created_by_id", "is_sample"]);

/** Base44 "2026-04-04T16:02:22.597000" (UTC, no zone) -> ISO with Z */
const isoZ = (s) => (s ? (/[Zz]$|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z") : s);

function convert(raw, fields) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (DROP.has(k)) continue;
    const f = fields[k];
    if (!f && k !== "id") continue; // unknown column — ignore
    if (k === "created_date" || k === "updated_date") { out[k] = isoZ(v); continue; }
    if (v === "") { if (f?.type === "text" || f?.type === "editor") out[k] = ""; continue; }
    switch (f?.type) {
      case "number": { const n = Number(v); if (!Number.isNaN(n)) out[k] = n; break; }
      case "bool": out[k] = v === "true" || v === "True" || v === "1"; break;
      case "json": try { out[k] = JSON.parse(v); } catch { out[k] = [v]; } break;
      default: out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------- PocketBase REST
let token = "";
async function api(method, p, body) {
  const res = await fetch(URL_ + p, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

// ---------------------------------------------------------------- main
function findFile(name) {
  const rx = new RegExp(`(^|-)${name}_export\\.csv$`);
  const hit = fs.readdirSync(DIR).filter((f) => rx.test(f));
  return hit.length ? path.join(DIR, hit[0]) : null;
}

if (!JSON_DATA && !fs.existsSync(DIR)) { console.error(`Directory not found: ${DIR} (use --json FILE for the single JSON export)`); process.exit(2); }
if (JSON_DATA && !ENTITIES.some((e) => Array.isArray(JSON_DATA[e.file]))) {
  console.error(`${JSON_FILE} does not look like a Base44 export: none of ${ENTITIES.map((e) => e.file).join(", ")} is a list.`); process.exit(2);
}

if (!DRY) {
  if (!EMAIL || !PASSWORD) { console.error("Superuser credentials required (--email/--password or PB_SUPERUSER_EMAIL/PB_SUPERUSER_PASSWORD)."); process.exit(2); }
  const r = await api("POST", "/api/collections/_superusers/auth-with-password", { identity: EMAIL, password: PASSWORD });
  if (!r.ok) { console.error("Superuser login failed:", r.json?.message || r.status); process.exit(2); }
  token = r.json.token;
}

// ---- read every table first: finding orphans needs to see all of them
const ROWS = {};
for (const { file, col } of ENTITIES) {
  if (JSON_DATA) {
    if (Array.isArray(JSON_DATA[file])) ROWS[col] = JSON_DATA[file].map(stringifyRow);
  } else {
    const fp = findFile(file);
    if (fp) ROWS[col] = parseCSV(fs.readFileSync(fp, "utf8"));
  }
}

// Links between records. Only event_id is a real PocketBase relation; the rest are plain text ids
// that Base44 never enforced, so deleted records left dead links behind.
const LINKS = [
  ["aide_stations", "primary_frequency_id", "frequencies"], ["aide_stations", "backup_frequency_id", "frequencies"],
  ["assignments", "operator_id", "operators"], ["assignments", "station_id", "aide_stations"],
  ["participants", "current_location_station_id", "aide_stations"],
  ["participant_status_updates", "participant_id", "participants"], ["participant_status_updates", "aide_station_id", "aide_stations"],
  ["bulletins", "event_log_id", "event_logs"],
];

/** Which records to leave out, and why. A skipped record takes the records that point at it with it. */
function findOrphans(rows, keepDeadLinks) {
  const alive = Object.fromEntries(Object.entries(rows).map(([c, r]) => [c, new Set(r.map((x) => x.id))]));
  const skipped = new Map(); // "col:id" -> reason
  for (let changed = true; changed;) {
    changed = false;
    for (const [col, list] of Object.entries(rows)) {
      if (col === "events" || col === "app_config") continue;
      for (const r of list) {
        const key = col + ":" + r.id;
        if (skipped.has(key)) continue;
        let why = "";
        if (!(alive.events || new Set()).has(r.event_id)) why = "its event is not in the export";
        else if (!keepDeadLinks) {
          for (const [c, f, parent] of LINKS) {
            if (c === col && r[f] && !(alive[parent] || new Set()).has(r[f])) { why = `${f} points at a record in ${parent} that is not in the export`; break; }
          }
        }
        if (why) { skipped.set(key, why); alive[col].delete(r.id); changed = true; }
      }
    }
  }
  return skipped;
}
const ORPHANS = findOrphans(ROWS, KEEP_ORPHANS);

const summary = [];
let failures = 0;

for (const { file, col } of ENTITIES) {
  const rows = ROWS[col];
  if (!rows) { summary.push([col, JSON_DATA ? "no list" : "no file", 0, 0, 0, 0]); continue; }

  let fields = {};
  if (!DRY) {
    const sch = await api("GET", `/api/collections/${col}`);
    if (!sch.ok) { console.error(`Collection ${col} missing — has the ECS migration run?`); process.exit(2); }
    fields = Object.fromEntries(sch.json.fields.map((f) => [f.name, f]));
  } else {
    // dry-run: assume every CSV column is valid, numbers per name heuristics
    for (const k of Object.keys(rows[0] || {})) fields[k] = { type: "text" };
  }

  let created = 0, skipped = 0, orphans = 0, errors = 0;
  for (const raw of rows) {
    if (col === "app_config") {
      if (raw.key === "aprs_last_run") { skipped++; continue; }
      if (raw.key === "admin_pin" && !WITH_ADMIN_PIN) { skipped++; continue; }
    }
    if (ORPHANS.has(col + ":" + raw.id)) { orphans++; continue; }
    const rec = convert(raw, fields);
    if (DRY) { created++; continue; }

    const exists = await api("GET", `/api/collections/${col}/records/${rec.id}`);
    if (exists.ok) { skipped++; continue; }

    // app_config keys are unique: replace instead of colliding
    if (col === "app_config") {
      const hit = await api("GET", `/api/collections/app_config/records?filter=${encodeURIComponent(`key="${rec.key}"`)}`);
      if (hit.ok && hit.json.items.length) { await api("DELETE", `/api/collections/app_config/records/${hit.json.items[0].id}`); }
    }
    const r = await api("POST", `/api/collections/${col}/records`, rec);
    if (r.ok) created++;
    else {
      errors++; failures++;
      console.error(`  ! ${col} ${rec.id}: ${JSON.stringify(r.json?.data || r.json?.message)}`);
    }
  }
  summary.push([col, `${rows.length} rows`, created, skipped, orphans, errors]);
}

console.log("\n" + (DRY ? "DRY RUN — nothing written\n" : ""));
console.log("collection".padEnd(30), (JSON_DATA ? "json" : "csv").padEnd(10), "created".padEnd(9), "skipped".padEnd(9), "orphans".padEnd(9), "errors");
for (const s of summary) console.log(String(s[0]).padEnd(30), String(s[1]).padEnd(10), String(s[2]).padEnd(9), String(s[3]).padEnd(9), String(s[4]).padEnd(9), s[5]);
if (ORPHANS.size) {
  console.log(`\nSkipped as orphans (${ORPHANS.size}):`);
  const groups = new Map();
  for (const [key, why] of ORPHANS) { const col = key.split(":")[0]; const k = col + " | " + why; (groups.get(k) || groups.set(k, []).get(k)).push(key.split(":")[1]); }
  for (const [k, ids] of groups) { const [col, why] = k.split(" | "); console.log(`  ${String(ids.length).padStart(4)}  ${col}: ${why}  (ids: ${ids.slice(0, 5).join(", ")}${ids.length > 5 ? ", ..." : ""})`); }
  console.log("  Pass --keep-orphans to import records whose links point at nothing (a record whose event is missing is always skipped).");
}
if (!WITH_ADMIN_PIN) console.log("\nNote: Base44 admin_pin was NOT imported (pass --with-admin-pin to import it). The PIN chosen at install time stays active.");
process.exit(failures ? 1 : 0);
