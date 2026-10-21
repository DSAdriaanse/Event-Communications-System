#!/usr/bin/env node
// End-to-end check of the orphan handling against a running PocketBase (see pocketbase/pb_hooks/lib/orphans.js).
//   PB_URL=http://127.0.0.1:8090 PB_SUPERUSER_EMAIL=... PB_SUPERUSER_PASSWORD=... ECS_ADMIN_PIN=... node pocketbase/test/orphans.smoke.mjs
// Everything it creates is made up and lives under one event that it deletes again at the end.
const PB = (process.env.PB_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
let token = "";
const call = async (method, p, body, tok = token) => {
  const r = await fetch(PB + p, { method, headers: { "content-type": "application/json", ...(tok ? { authorization: tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { raw: t }; }
  return { status: r.status, json: j };
};
let failed = 0;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failed++; };

token = (await call("POST", "/api/collections/_superusers/auth-with-password", { identity: process.env.PB_SUPERUSER_EMAIL, password: process.env.PB_SUPERUSER_PASSWORD }, "")).json.token;

// make a record, filling every required field from the collection's own schema
const schemas = {};
async function make(col, over = {}) {
  schemas[col] ||= (await call("GET", `/api/collections/${col}`)).json.fields;
  const body = {};
  for (const f of schemas[col]) {
    if (!f.required || f.name in over || f.system) continue;
    body[f.name] = f.type === "number" ? 1 : f.type === "bool" ? false : f.type === "select" ? f.values[0] : f.type === "date" ? new Date().toISOString() : "x";
  }
  const r = await call("POST", `/api/collections/${col}/records`, { ...body, ...over });
  if (r.status !== 200) throw new Error(`create ${col}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}
const get = async (col, id) => { const r = await call("GET", `/api/collections/${col}/records/${id}`); return r.status === 200 ? r.json : null; };
const del = async (col, id) => (await call("DELETE", `/api/collections/${col}/records/${id}`)).status;
const count = async (col, filter) => (await call("GET", `/api/collections/${col}/records?perPage=1&filter=${encodeURIComponent(filter)}`)).json.totalItems;

const ev = await make("events", { name: "Orphan smoke test", pin: "123456" });
const E = { event_id: ev.id };
const freq = await make("frequencies", { ...E, name: "F1" });
const op = await make("operators", { ...E, callsign: "TEST1" });
const mkStation = (name, over = {}) => make("aide_stations", { ...E, name, ...over });
const st1 = await mkStation("S1", { primary_frequency_id: freq.id, backup_frequency_id: freq.id });
const log = await make("event_logs", { ...E });
const bul = await make("bulletins", { ...E, event_log_id: log.id });
const asg = await make("assignments", { ...E, operator_id: op.id, station_id: st1.id, operator_callsign: "TEST1", station_name: "S1" });
const p1 = await make("participants", { ...E, current_location_station_id: st1.id });
const u1 = await make("participant_status_updates", { ...E, participant_id: p1.id, aide_station_id: st1.id });
const p2 = await make("participants", { ...E, current_location_station_id: st1.id });
const u2 = await make("participant_status_updates", { ...E, participant_id: p2.id, aide_station_id: st1.id });

console.log("--- deleting a record fixes what pointed at it");
check((await del("participants", p1.id)) === 204, "delete a participant");
check((await get("participant_status_updates", u1.id)) === null, "its status update went with it");
check((await get("participant_status_updates", u2.id)) !== null, "another participant's status update is untouched");
check((await del("aide_stations", st1.id)) === 204, "delete a station");
check((await get("participants", p2.id)).current_location_station_id === "", "participant's location link cleared, participant kept");
check((await get("assignments", asg.id)).station_id === "", "assignment's station link cleared, assignment kept");
check((await get("assignments", asg.id)).station_name === "S1", "assignment keeps its station name");
check((await get("participant_status_updates", u2.id)).aide_station_id === "", "status update's station link cleared");
const st2 = await mkStation("S2", { primary_frequency_id: freq.id });
check((await del("frequencies", freq.id)) === 204, "delete a frequency");
check((await get("aide_stations", st2.id)).primary_frequency_id === "", "station's frequency link cleared");
check((await del("operators", op.id)) === 204, "delete an operator");
check((await get("assignments", asg.id)).operator_id === "", "assignment's operator link cleared");
check((await del("event_logs", log.id)) === 204, "delete a log entry");
check((await get("bulletins", bul.id)).event_log_id === "", "bulletin's log link cleared, bulletin kept");

console.log("--- the report and the repair of dead links that already exist");
const o1 = await make("bulletins", { ...E, event_log_id: "nosuchlog" });
const o2 = await make("participant_status_updates", { ...E, participant_id: "nosuchparticipant" });
const o3 = await make("participants", { ...E, current_location_station_id: "nosuchstation" });
const rep = await call("GET", "/api/ecs/admin/orphans");
check(rep.status === 200 && rep.json.total === 3, `report as superuser finds 3 (got ${rep.json && rep.json.total})`);
check(rep.json.orphans.some((o) => o.collection === "bulletins" && o.field === "event_log_id" && o.count === 1), "report names the bulletin link");
check((await call("GET", "/api/ecs/admin/orphans", null, "")).status === 401, "report without sign-in is refused (401)");
const evLogin = await call("POST", "/api/ecs/login", { mode: "event", eventId: ev.id, pin: "123456" }, "");
check(evLogin.status === 200 && (await call("GET", "/api/ecs/admin/orphans", null, evLogin.json.token)).status === 403, "report as an event operator is refused (403)");
if (process.env.ECS_ADMIN_PIN) {
  // the admin PIN is seeded by the first public request
  await call("GET", "/api/ecs/public-events", null, "");
  const adm = await call("POST", "/api/ecs/login", { mode: "admin", pin: process.env.ECS_ADMIN_PIN }, "");
  check(adm.status === 200 && (await call("GET", "/api/ecs/admin/orphans", null, adm.json.token)).status === 200, "report as an ECS admin works");
  check((await call("POST", "/api/ecs/admin/orphans/clean", null, evLogin.json.token)).status === 403, "repair as an event operator is refused (403)");
}
const fix = await call("POST", "/api/ecs/admin/orphans/clean");
check(fix.status === 200 && fix.json.cleared === 2 && fix.json.deleted === 1, `repair clears 2 links and deletes 1 record (got ${JSON.stringify(fix.json)})`);
check((await get("bulletins", o1.id)).event_log_id === "" && (await get("participant_status_updates", o2.id)) === null && (await get("participants", o3.id)).current_location_station_id === "", "each repaired as described");
check((await call("GET", "/api/ecs/admin/orphans")).json.total === 0, "report is empty afterwards");

console.log("--- deleting the event removes everything under it");
const t0 = Date.now();
check((await del("events", ev.id)) === 204, "delete the event");
console.log(`    (took ${Date.now() - t0} ms)`);
let left = 0;
for (const c of ["aide_stations", "frequencies", "operators", "assignments", "event_logs", "participants", "participant_status_updates", "bulletins"]) left += await count(c, `event_id = "${ev.id}"`);
check(left === 0, `nothing of the event is left (found ${left})`);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
