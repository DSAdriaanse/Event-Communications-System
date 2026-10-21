// Links between ECS records, and what to do when the record they point at is gone.
//
// Only `event_id` is a real PocketBase relation (deleting an event deletes everything under it).
// The links below are plain text ids, which the database does not enforce. Base44 never enforced
// them either, so deleted records left dead links behind. This module keeps them clean:
//
//   onDelete(app, record)   runs when a record is deleted, inside the same transaction:
//                           links that point at it are cleared, and rows that make no sense
//                           without it (a participant's status updates) are deleted with it.
//   find(app)               read-only report of dead links that exist now.
//   clean(app)              repairs them the same way onDelete would have.
//
// "clear" blanks the link and keeps the record (an assignment keeps its callsign and station name);
// "delete" removes the record (a status update without its participant is meaningless).

const LINKS = [
  { col: "aide_stations", field: "primary_frequency_id", parent: "frequencies", action: "clear" },
  { col: "aide_stations", field: "backup_frequency_id", parent: "frequencies", action: "clear" },
  { col: "assignments", field: "operator_id", parent: "operators", action: "clear" },
  { col: "assignments", field: "station_id", parent: "aide_stations", action: "clear" },
  { col: "participants", field: "current_location_station_id", parent: "aide_stations", action: "clear" },
  { col: "participant_status_updates", field: "participant_id", parent: "participants", action: "delete" },
  { col: "participant_status_updates", field: "aide_station_id", parent: "aide_stations", action: "clear" },
  { col: "bulletins", field: "event_log_id", parent: "event_logs", action: "clear" },
];

// the collections that others point at (the hook is registered for exactly these)
const PARENTS = LINKS.map((l) => l.parent).filter((p, i, a) => a.indexOf(p) === i);

function apply(app, link, rec) {
  if (link.action === "delete") app.delete(rec);
  else { rec.set(link.field, ""); app.save(rec); }
}

/** A record was deleted: fix everything that pointed at it. Never blocks the delete itself. */
function onDelete(app, record) {
  // Deleting an event removes the event first and then everything under it. Those children are going
  // anyway, and saving a record whose event is already gone would fail, so there is nothing to tidy.
  const eventId = record.getString("event_id");
  if (eventId) { try { app.findRecordById("events", eventId); } catch (_) { return; } }
  const parent = record.collection().name;
  for (const link of LINKS) {
    if (link.parent !== parent) continue;
    try {
      const rows = app.findRecordsByFilter(link.col, `${link.field} = {:id}`, "", 0, 0, { id: record.id });
      for (const r of rows) apply(app, link, r);
    } catch (err) {
      // the nightly job picks up whatever this missed
      console.log(`[ecs] orphans: could not fix ${link.col}.${link.field} after deleting ${parent} ${record.id}:`, String(err));
    }
  }
}

function deadLinks(app) {
  const alive = {};
  for (const p of PARENTS) alive[p] = new Set(app.findAllRecords(p).map((r) => r.id));
  const out = [];
  for (const link of LINKS) {
    const rows = [];
    for (const r of app.findRecordsByFilter(link.col, `${link.field} != ''`, "", 0, 0)) {
      if (!alive[link.parent].has(r.getString(link.field))) rows.push(r);
    }
    if (rows.length) out.push({ link, rows });
  }
  return out;
}

/** Read-only. [{ collection, field, points_at, action, count, ids }] */
function find(app) {
  return deadLinks(app).map(({ link, rows }) => ({
    collection: link.col,
    field: link.field,
    points_at: link.parent,
    action: link.action,
    count: rows.length,
    ids: rows.slice(0, 20).map((r) => r.id),
  }));
}

/** Repairs what find() reports. Returns { cleared, deleted } with the number of records touched. */
function clean(app) {
  let cleared = 0, deleted = 0;
  const gone = new Set(); // a record deleted for one dead link may also be listed under another
  for (const { link, rows } of deadLinks(app)) {
    for (const r of rows) {
      if (gone.has(r.id)) continue;
      apply(app, link, r);
      if (link.action === "delete") { deleted++; gone.add(r.id); } else cleared++;
    }
  }
  return { cleared, deleted };
}

/** Route guard: superusers and ECS admins only. */
function guard(e) {
  if (e.hasSuperuserAuth() || (e.auth && e.auth.getString("role") === "admin")) return;
  throw new ForbiddenError("Admins only.");
}

module.exports = { LINKS, PARENTS, onDelete, find, clean, guard };
