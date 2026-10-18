/// <reference path="../pb_data/types.d.ts" />
//
// ECS schema — ported from the Base44 entities (base44/entities/*.jsonc).
//
// Design notes
//  * Field names are IDENTICAL to the Base44 entities so the React UI keeps working
//    unchanged. Base44's built-in `created_date` / `updated_date` are plain date fields
//    stamped by hooks (pb_hooks/main.pb.js) — PocketBase "autodate" fields cannot be set
//    explicitly, which would make it impossible to import historical timestamps.
//    `created_by` is a text field filled by a hook.
//  * The record `id` is relaxed (15–24 chars, a-z0-9) so ids exported from Base44
//    (24 hex chars) can be imported verbatim and every cross reference keeps working.
//  * App-level timestamps (start_time, timestamp, last_heard ...) are kept as TEXT, exactly
//    as Base44 stored them (ISO strings, sometimes without a zone). The UI already parses
//    them with parseAsUTC(), so no behaviour changes.
//  * Only `event_id` is a real relation (cascade delete). That replaces the Base44
//    "nightlyCleanup" orphan sweeper: deleting an Event now removes its data atomically.
//  * Access control lives in the collection rules (see ecs_users + /api/ecs/login in
//    pb_hooks/main.pb.js): admin sessions see everything, event sessions only their event.

migrate((app) => {
  const ID_FIELD = {
    name: "id", type: "text", system: true, primaryKey: true, required: true,
    min: 15, max: 24, pattern: "^[a-z0-9]+$", autogeneratePattern: "[a-z0-9]{15}",
  };
  const AUDIT_FIELDS = [
    { name: "created_date", type: "date" },
    { name: "updated_date", type: "date" },
    { name: "created_by", type: "text", max: 255 },
  ];

  const txt = (name, extra) => Object.assign({ name, type: "text", max: 20000 }, extra || {});
  const long = (name) => ({ name, type: "text", max: 2000000 });
  const num = (name) => ({ name, type: "number" });
  const bool = (name) => ({ name, type: "bool" });
  const json = (name) => ({ name, type: "json", maxSize: 2000000 });
  const sel = (name, values) => ({ name, type: "select", values, maxSelect: 1 });

  // ---- access rules -------------------------------------------------------
  const AUTH = '@request.auth.id != ""';
  const ADMIN = '@request.auth.role = "admin"';
  // event-scoped collections: admin = everything, event session = own event only
  const SCOPED_READ = `${AUTH} && (${ADMIN} || event_id = @request.auth.event_id)`;
  const SCOPED_CREATE = `${AUTH} && (${ADMIN} || @request.body.event_id = @request.auth.event_id)`;
  const SCOPED_UPDATE = `${AUTH} && (${ADMIN} || (event_id = @request.auth.event_id && (@request.body.event_id:isset = false || @request.body.event_id = @request.auth.event_id)))`;
  const SCOPED = {
    listRule: SCOPED_READ, viewRule: SCOPED_READ,
    createRule: SCOPED_CREATE, updateRule: SCOPED_UPDATE, deleteRule: SCOPED_READ,
  };

  // ---- 1. auth collection for PIN sessions ---------------------------------
  // Records here are created on demand by POST /api/ecs/login; nobody logs in with a
  // password. All API rules are null => only server code / superusers can touch them.
  const users = new Collection({
    type: "auth",
    name: "ecs_users",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    authRule: "",
    passwordAuth: { enabled: false },
    oauth2: { enabled: false },
    otp: { enabled: false },
    mfa: { enabled: false },
    authToken: { duration: 60 * 60 * 24 * 3 }, // 3 days — covers a multi-day event
    fields: [
      { name: "role", type: "select", values: ["admin", "event"], maxSelect: 1, required: true },
      { name: "event_id", type: "text", max: 40 },
      { name: "label", type: "text", max: 255 },
    ],
  });
  app.save(users);

  // login throttle (DB backed because every hook request may run in a different JS VM)
  app.save(new Collection({
    type: "base",
    name: "ecs_login_attempts",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      txt("bucket", { max: 255, required: true }),
      num("failures"),
      txt("window_start", { max: 40 }),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_ecs_login_attempts_bucket ON ecs_login_attempts (bucket)"],
  }));

  // ---- 2. events -------------------------------------------------------------
  // Everyone signed in may list events (needed for the event switcher); the hook in
  // main.pb.js hides `pin` (and other events' briefing text) from non-admins.
  const events = new Collection({
    type: "base",
    name: "events",
    listRule: AUTH,
    viewRule: AUTH,
    createRule: `${AUTH} && ${ADMIN}`,
    // event sessions may edit the briefing / ConOps of their own event, nothing else
    updateRule: `${AUTH} && (${ADMIN} || (id = @request.auth.event_id && @request.body.pin:isset = false && @request.body.name:isset = false && @request.body.status:isset = false))`,
    deleteRule: `${AUTH} && ${ADMIN}`,
    fields: [
      ID_FIELD,
      txt("name", { required: true }),
      txt("incident_name"),
      txt("date", { max: 40 }),
      txt("start_datetime", { max: 40 }),
      txt("end_datetime", { max: 40 }),
      txt("location"),
      txt("net_control_callsign", { max: 255 }),
      sel("status", ["Planning", "Active", "Completed", "Archived"]),
      txt("timezone", { max: 100 }),
      txt("pin", { max: 100 }),
      long("notes"),
      long("discussion"),
      long("conops_comms"),
      txt("documents_url", { max: 2000 }),
      ...AUDIT_FIELDS,
    ],
    indexes: ["CREATE INDEX idx_events_status ON events (status)"],
  });
  app.save(events);

  const eventRel = {
    name: "event_id", type: "relation", collectionId: events.id,
    cascadeDelete: true, maxSelect: 1, required: true,
  };
  const evIdx = (table) => `CREATE INDEX idx_${table}_event ON ${table} (event_id)`;

  // ---- 3. event scoped collections -----------------------------------------------
  const scoped = (name, fields, extraIdx) => {
    app.save(new Collection(Object.assign({
      type: "base", name,
      fields: [ID_FIELD, eventRel, ...fields, ...AUDIT_FIELDS],
      indexes: [evIdx(name)].concat(extraIdx || []),
    }, SCOPED)));
  };

  scoped("aide_stations", [
    txt("name", { required: true }),
    txt("station_id", { max: 100 }),
    num("latitude"), num("longitude"),
    txt("address"),
    sel("type", ["Aide Station", "Net Control", "Command Post", "Staging", "Water Point", "Start Line", "Finish Line", "Other"]),
    sel("status", ["Active", "Standby", "Closed", "Requested"]),
    txt("start_datetime", { max: 40 }), txt("end_datetime", { max: 40 }),
    txt("primary_frequency_id", { max: 40 }), txt("backup_frequency_id", { max: 40 }),
    json("assets"),
    long("notes"),
    num("sort_order"),
    sel("position_source", ["None", "Manual", "APRS.fi"]),
    txt("tracking_identifier", { max: 255 }),
  ]);

  scoped("frequencies", [
    txt("name", { required: true }),
    num("frequency_mhz"),
    txt("tone", { max: 100 }),
    sel("mode", ["FM", "AM", "SSB", "DMR", "P25", "FRS", "GMRS", "Other"]),
    sel("use", ["Primary Net", "Tactical", "Emergency", "Simplex", "Repeater", "Interop", "Other"]),
    txt("repeater_offset", { max: 100 }),
    long("remarks"), long("notes"),
    num("sort_order"),
  ]);

  scoped("operators", [
    txt("callsign", { max: 255, required: true }),
    txt("full_name", { required: true }),
    txt("phone", { max: 100 }), txt("email", { max: 255 }),
    sel("license_class", ["Technician", "General", "Amateur Extra", "GMRS", "Other"]),
    json("certifications"),
    sel("status", ["Available", "Assigned", "En Route", "Off Duty", "Standby"]),
    txt("last_heard", { max: 40 }),
    long("notes"),
    num("latitude"), num("longitude"),
    sel("position_source", ["None", "Manual", "APRS.fi"]),
    txt("tracking_identifier", { max: 255 }),
  ]);

  scoped("assignments", [
    txt("operator_id", { max: 40 }),
    txt("operator_callsign", { max: 255, required: true }),
    txt("station_id", { max: 40 }),
    txt("station_name", { required: true }),
    sel("role", ["Net Control", "Station Operator", "Liaison", "Floater", "Backup"]),
    txt("start_time", { max: 40 }), txt("end_time", { max: 40 }),
    sel("status", ["Scheduled", "Active", "Completed", "Cancelled"]),
    long("notes"),
  ]);

  scoped("event_logs", [
    sel("type", ["communication", "task_completion", "note", "system_event"]),
    long("content"),
    txt("from_callsign", { max: 255 }), txt("from_station", { max: 255 }), txt("to_station", { max: 255 }),
    sel("priority", ["Routine", "Welfare", "Priority", "Emergency"]),
    sel("message_type", ["Net Check-in", "Situation Report", "Resource Request", "Medical", "General", "Alert"]),
    bool("acknowledged"),
    txt("acknowledged_by", { max: 255 }),
    txt("task_id", { max: 255 }), txt("task_label", { max: 500 }),
  ], ["CREATE INDEX idx_event_logs_created ON event_logs (event_id, created_date)"]);

  scoped("resource_requests", [
    sel("type", ["SAG", "Food", "Water", "Medical", "Logistics", "Personnel", "Equipment", "Information", "Other"]),
    long("item"),
    num("quantity"), txt("unit", { max: 100 }),
    sel("status", ["Pending", "Approved", "En Route", "Fulfilled", "Cancelled"]),
    sel("priority", ["Routine", "Urgent", "Emergency"]),
    txt("requested_by", { max: 255 }), txt("station_name", { max: 255 }), txt("fulfilled_by", { max: 255 }),
    long("notes"),
  ]);

  scoped("participants", [
    txt("bib_number", { max: 100, required: true }),
    txt("runner_name", { required: true }),
    sel("status", ["Active", "DNS", "DNF", "Completed", "Withdrawn"]),
    txt("current_location_station_id", { max: 40 }),
    txt("current_location_name", { max: 255 }),
    txt("last_update_date", { max: 40 }),
    long("notes"),
  ], ["CREATE INDEX idx_participants_bib ON participants (event_id, bib_number)"]);

  scoped("participant_status_updates", [
    txt("participant_id", { max: 40, required: true }),
    txt("bib_number", { max: 100, required: true }),
    sel("update_type", ["Seen", "DNS", "DNF", "Completed", "Comment", "Withdrawn"]),
    txt("aide_station_id", { max: 40 }), txt("aide_station_name", { max: 255 }),
    txt("timestamp", { max: 40, required: true }),
    long("comment"),
    txt("recorded_by", { max: 255 }),
  ], ["CREATE INDEX idx_psu_participant ON participant_status_updates (participant_id)"]);

  scoped("event_documents", [
    txt("name", { required: true }),
    txt("file_url", { max: 4000 }),
    txt("file_type", { max: 255 }),
    num("size_bytes"),
    long("description"),
    // NEW: Base44 hosted files are not reachable once Base44 is gone — new uploads live here.
    { name: "file", type: "file", maxSelect: 1, maxSize: 50 * 1024 * 1024, protected: true },
  ]);

  scoped("bulletins", [
    txt("message_number", { max: 100 }),
    txt("to", { max: 500 }), txt("from_name", { max: 500 }),
    txt("subject", { max: 1000, required: true }),
    txt("date", { max: 100 }), txt("time", { max: 100 }),
    sel("priority", ["Routine", "Welfare", "Priority", "Emergency"]),
    long("message"),
    txt("approved_by", { max: 500 }),
    long("reply"), txt("reply_by", { max: 500 }),
    num("sent_count"),
    txt("event_log_id", { max: 40 }),
  ]);

  // ---- 4. global key/value config -----------------------------------------------
  // admin_pin and aprs_last_run are admin / server only. NCO timers & tasks are shared.
  const CFG_READ = `${AUTH} && (${ADMIN} || (key != "admin_pin" && key != "aprs_last_run"))`;
  const CFG_WRITE = `${AUTH} && (${ADMIN} || key = "nco_timers" || key = "nco_tasks")`;
  app.save(new Collection({
    type: "base",
    name: "app_config",
    listRule: CFG_READ, viewRule: CFG_READ,
    createRule: `${AUTH} && (${ADMIN} || @request.body.key = "nco_timers" || @request.body.key = "nco_tasks")`,
    updateRule: CFG_WRITE,
    deleteRule: `${AUTH} && ${ADMIN}`,
    fields: [
      ID_FIELD,
      txt("key", { max: 255, required: true }),
      long("value"),
      ...AUDIT_FIELDS,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_app_config_key ON app_config (key)"],
  }));
}, (app) => {
  for (const n of [
    "bulletins", "event_documents", "participant_status_updates", "participants",
    "resource_requests", "event_logs", "assignments", "operators", "frequencies",
    "aide_stations", "app_config", "events", "ecs_login_attempts", "ecs_users",
  ]) {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) { /* already gone */ }
  }
});
