#!/usr/bin/env node
// One-time legacy import: Base44 CSV export (Event_export.csv, Operator_export.csv, ...) into the ECS PocketBase.
//
//   node migration/import-base44.mjs --dir ./migration/base44-export \
//        --url http://127.0.0.1:8090 --email admin@example.com --password '...'
//
// * Original Base44 record ids and created/updated timestamps are preserved, so every cross
//   reference (event_id, station ids, participant ids ...) stays valid.
// * Re-runnable: records whose id already exists are skipped.
// * Needs only Node 18+ (no npm dependencies).
//
// Options
//   --dir DIR           folder holding the *_export.csv files (file name prefixes like "ab12cd34-" are fine)
//   --url URL           PocketBase base URL                      (env PB_URL,   default http://127.0.0.1:8090)
//   --email / --password  superuser credentials                  (env PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD)
//   --with-admin-pin    also import the Base44 `admin_pin` config (default: keep the PIN chosen at install)
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

const DIR = opt("dir", null, "./migration/base44-export");
const URL_ = opt("url", "PB_URL", "http://127.0.0.1:8090").replace(/\/+$/, "");
const EMAIL = opt("email", "PB_SUPERUSER_EMAIL");
const PASSWORD = opt("password", "PB_SUPERUSER_PASSWORD");
const WITH_ADMIN_PIN = flag("with-admin-pin");
const DRY = flag("dry-run");

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

if (!fs.existsSync(DIR)) { console.error(`Directory not found: ${DIR}`); process.exit(2); }

if (!DRY) {
  if (!EMAIL || !PASSWORD) { console.error("Superuser credentials required (--email/--password or PB_SUPERUSER_EMAIL/PB_SUPERUSER_PASSWORD)."); process.exit(2); }
  const r = await api("POST", "/api/collections/_superusers/auth-with-password", { identity: EMAIL, password: PASSWORD });
  if (!r.ok) { console.error("Superuser login failed:", r.json?.message || r.status); process.exit(2); }
  token = r.json.token;
}

const eventIds = new Set();
const summary = [];
let failures = 0;

for (const { file, col } of ENTITIES) {
  const fp = findFile(file);
  if (!fp) { summary.push([col, "no file", 0, 0, 0, 0]); continue; }
  const rows = parseCSV(fs.readFileSync(fp, "utf8"));

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
    const rec = convert(raw, fields);
    if (col === "events") eventIds.add(rec.id);
    else if ("event_id" in fields && !eventIds.has(rec.event_id)) { orphans++; continue; }
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
console.log("collection".padEnd(30), "csv".padEnd(10), "created".padEnd(9), "skipped".padEnd(9), "orphans".padEnd(9), "errors");
for (const s of summary) console.log(String(s[0]).padEnd(30), String(s[1]).padEnd(10), String(s[2]).padEnd(9), String(s[3]).padEnd(9), String(s[4]).padEnd(9), s[5]);
if (!WITH_ADMIN_PIN) console.log("\nNote: Base44 admin_pin was NOT imported (pass --with-admin-pin to import it). The PIN chosen at install time stays active.");
process.exit(failures ? 1 : 0);
