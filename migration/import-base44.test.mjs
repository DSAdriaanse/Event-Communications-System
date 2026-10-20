// Run:  node --test migration/import-base44.test.mjs
// Dry runs only (no server needed). The fixture is made-up data in the shape of the Base44 JSON export.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = new URL("./import-base44.mjs", import.meta.url).pathname;
const FIXTURE = new URL("./test/fixture-export.json", import.meta.url).pathname;
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
const tmp = (obj) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ecs-")), "export.json"); fs.writeFileSync(f, typeof obj === "string" ? obj : JSON.stringify(obj)); return f; };

test("a JSON export is read and every collection is planned", () => {
  const r = run("--json", FIXTURE, "--dry-run");
  assert.equal(r.status, 0, r.stderr);
  const row = (c) => new RegExp(`^${c}\\s+(\\d+) rows\\s+(\\d+)\\s+(\\d+)`, "m").exec(r.stdout);
  for (const [c, n] of [["events", 1], ["aide_stations", 2], ["operators", 2], ["assignments", 1], ["event_logs", 2]]) {
    const m = row(c); assert.ok(m, c); assert.equal(Number(m[1]), n, c); assert.equal(Number(m[2]), n, `${c} created`);
  }
  // app_config: aprs_last_run and admin_pin are not imported by default
  const cfg = row("app_config"); assert.deepEqual([cfg[1], cfg[2], cfg[3]], ["3", "1", "2"]);
});

test("a bulletin whose log entry is missing is skipped and listed, unless --keep-orphans", () => {
  const r = run("--json", FIXTURE, "--dry-run");
  assert.match(r.stdout, /^bulletins\s+1 rows\s+0\s+0\s+1\s+0/m);
  assert.match(r.stdout, /bulletins: event_log_id points at a record in event_logs that is not in the export/);
  const k = run("--json", FIXTURE, "--dry-run", "--keep-orphans");
  assert.match(k.stdout, /^bulletins\s+1 rows\s+1\s+0\s+0\s+0/m);
  assert.doesNotMatch(k.stdout, /Skipped as orphans/);
});

test("skipping cascades: a record that pointed at a skipped record is skipped too", () => {
  const data = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  // a status update points at a participant, which points at a station that is not in the export
  data.Participant[0].current_location_station_id = "nosuchstation";
  const r = run("--json", tmp(data), "--dry-run");
  assert.match(r.stdout, /^participants\s+1 rows\s+0\s+0\s+1\s+0/m);
  assert.match(r.stdout, /^participant_status_updates\s+1 rows\s+0\s+0\s+1\s+0/m);
});

test("a dead frequency link skips the station, and --keep-orphans keeps it", () => {
  const data = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  data.AideStation[0].primary_frequency_id = "nosuchfreq";
  const f = tmp(data);
  assert.match(run("--json", f, "--dry-run").stdout, /^aide_stations\s+2 rows\s+1\s+0\s+1\s+0/m);
  assert.match(run("--json", f, "--dry-run", "--keep-orphans").stdout, /^aide_stations\s+2 rows\s+2\s+0\s+0\s+0/m);
});

test("rows of an event that is not in the export are counted as orphans, even with --keep-orphans", () => {
  const data = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  data.Operator[0].event_id = "nosuchevent";
  const f = tmp(data);
  assert.match(run("--json", f, "--dry-run").stdout, /^operators\s+2 rows\s+1\s+0\s+1\s+0/m);
  assert.match(run("--json", f, "--dry-run", "--keep-orphans").stdout, /^operators\s+2 rows\s+1\s+0\s+1\s+0/m);
});

test("--with-admin-pin takes the admin PIN too", () => {
  const r = run("--json", FIXTURE, "--dry-run", "--with-admin-pin");
  assert.match(r.stdout, /^app_config\s+3 rows\s+2\s+1/m);
});

test("a file that is not an export, not JSON, or not there is refused", () => {
  assert.equal(run("--json", tmp({ hello: "world" }), "--dry-run").status, 2);
  assert.equal(run("--json", tmp("not json {"), "--dry-run").status, 2);
  assert.equal(run("--json", "/nonexistent/export.json", "--dry-run").status, 2);
});
