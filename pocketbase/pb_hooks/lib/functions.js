// Backend "functions" for ECS (export/import, e-mail, APRS.fi, printable reports).
//
//   exportEventData         -> POST /api/functions/exportEventData
//   importEventData         -> POST /api/functions/importEventData
//   sendICSEmail            -> POST /api/functions/sendICSEmail      (SMTP instead of Brevo)
//   aprsFiTracker           -> POST /api/functions/aprsFiTracker  + cron every 5 minutes
//   generatePrintableReport -> GET  /api/functions/generatePrintableReport?eventId=&reportType=
//   nightlyCleanup          -> obsolete: events->children are now FK cascade deletes
//
// Every handler is plain synchronous goja code (no async/await, no fetch -> $http.send).

const tzlib = require(`${__hooks}/lib/tz.js`);

// ------------------------------------------------------------------ helpers

function isoDate(v) {
  // PocketBase "2026-04-04 16:02:22.597Z"  ->  "2026-04-04T16:02:22.597Z" (what the UI expects)
  if (typeof v !== "string" || !v) return v;
  return v.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:)/, "$1T$2");
}

/** PocketBase record -> plain object (ISO timestamps). */
function plain(rec) {
  const o = JSON.parse(JSON.stringify(rec));
  delete o.collectionId;
  delete o.collectionName;
  o.created_date = isoDate(o.created_date);
  o.updated_date = isoDate(o.updated_date);
  return o;
}

/** All records of a collection matching a filter, as plain objects. */
function fetchAll(collection, filter, sort, limit, params) {
  const recs = $app.findRecordsByFilter(collection, filter || "", sort || "", limit || 0, 0, params || {});
  return recs.map(plain);
}

function byEvent(collection, eventId, sort, limit) {
  return fetchAll(collection, "event_id = {:eid}", sort, limit, { eid: eventId });
}

/** The caller may touch `eventId` if they are admin or their session is bound to it. */
function canAccess(e, eventId) {
  const auth = e.auth;
  if (!auth || auth.collection().name !== "ecs_users") return false;
  return auth.getString("role") === "admin" || auth.getString("event_id") === eventId;
}

function authLabel(e) {
  return (e.auth && e.auth.getString("label")) || "";
}

function body(e) {
  return e.requestInfo().body || {};
}

function err(e, status, message) {
  return e.json(status, { error: message });
}

// -------------------------------------------------------------- exportEventData

const EXPORT_MAP = [
  // [payload key, collection]
  ["stations", "aide_stations"],
  ["operators", "operators"],
  ["assignments", "assignments"],
  ["frequencies", "frequencies"],
  ["logs", "event_logs"],
  ["resource_requests", "resource_requests"],
  ["participants", "participants"],
  ["participant_updates", "participant_status_updates"],
  ["documents", "event_documents"],
];

function strip(o) {
  const r = Object.assign({}, o);
  delete r.id; delete r.created_date; delete r.updated_date; delete r.created_by;
  return r;
}

function exportEventData(e) {
  const eventId = body(e).eventId;
  if (!eventId) return err(e, 400, "eventId is required");
  if (!canAccess(e, eventId)) return err(e, 403, "Forbidden");
  let ev;
  try { ev = plain($app.findRecordById("events", eventId)); } catch (_) { return err(e, 404, "Event not found"); }

  const payload = {
    _meta: {
      exported_at: new Date().toISOString(),
      exported_by: authLabel(e),
      ecs_version: "1.0",
      event_id: eventId,
      event_name: ev.name,
    },
    event: strip(ev),
  };
  EXPORT_MAP.forEach(([key, col]) => {
    payload[key] = byEvent(col, eventId).map(strip);
  });
  // `documents.file` (PocketBase file field) is not portable; file_url/name are kept.
  payload.documents = payload.documents.map((d) => { delete d.file; return d; });
  return e.json(200, payload);
}

// -------------------------------------------------------------- importEventData

function importEventData(e) {
  const b = body(e);
  const eventId = b.eventId;
  const data = b.data;
  if (!eventId) return err(e, 400, "eventId is required");
  if (!data || typeof data !== "object") return err(e, 400, "data payload is required");
  if (!canAccess(e, eventId)) return err(e, 403, "Forbidden");
  try { $app.findRecordById("events", eventId); } catch (_) { return err(e, 404, "Event not found"); }

  const results = {};
  const errors = [];
  EXPORT_MAP.forEach(([key, name]) => {
    const records = data[key];
    if (!Array.isArray(records) || records.length === 0) { results[key] = { created: 0 }; return; }
    try {
      $app.runInTransaction((tx) => {
        const col = tx.findCollectionByNameOrId(name);
        const known = col.fields.fieldNames();
        records.forEach((src) => {
          const rec = new Record(col);
          Object.keys(src).forEach((k) => {
            if (["id", "created_date", "updated_date", "created_by", "event_id", "file"].indexOf(k) !== -1) return;
            if (known.indexOf(k) === -1) return;
            if (src[k] === null || src[k] === undefined) return;
            rec.set(k, src[k]);
          });
          rec.set("event_id", eventId);
          rec.set("created_by", authLabel(e));
          tx.save(rec);
        });
      });
      results[key] = { created: records.length };
    } catch (ex) {
      errors.push({ entity: key, error: String(ex) });
      results[key] = { created: 0, error: String(ex) };
    }
  });
  return e.json(200, { success: errors.length === 0, event_id: eventId, results, errors });
}

// ------------------------------------------------------------------ aprsFiTracker

const APRS_COOLDOWN_MS = 5 * 60 * 1000;

function aprsFiTracker() {
  const key = $os.getenv("APRS_FI_API_KEY");
  if (!key) return { status: 200, body: { skipped: true, reason: "APRS_FI_API_KEY not configured" } };

  // 1. cooldown — only one real APRS.fi call per 5 minutes, no matter how many browsers ask
  let lastRun = null;
  try { lastRun = $app.findFirstRecordByData("app_config", "key", "aprs_last_run"); } catch (_) { /* first run */ }
  const now = Date.now();
  if (lastRun) {
    const prev = parseInt(lastRun.getString("value"), 10);
    if (!isNaN(prev) && now - prev < APRS_COOLDOWN_MS) {
      return { status: 200, body: { message: "Skipping — cooldown active", next_run_in_s: Math.ceil((prev + APRS_COOLDOWN_MS - now) / 1000) } };
    }
  }
  // 2. stamp immediately so concurrent callers skip
  if (lastRun) {
    lastRun.set("value", String(now));
    $app.save(lastRun);
  } else {
    const r = new Record($app.findCollectionByNameOrId("app_config"));
    r.set("key", "aprs_last_run");
    r.set("value", String(now));
    $app.save(r);
  }

  // 3. planning/active events only
  const events = $app.findRecordsByFilter("events", "status = 'Planning' || status = 'Active'", "", 0, 0);
  if (events.length === 0) return { status: 200, body: { message: "No active or planning events found." } };
  const ids = events.map((x) => x.id);

  // 4. tracked stations + operators
  const tracked = [];
  [["aide_stations", "AideStation"], ["operators", "Operator"]].forEach(([col, type]) => {
    $app.findRecordsByFilter(col, "position_source = 'APRS.fi' && tracking_identifier != ''", "", 0, 0).forEach((r) => {
      if (ids.indexOf(r.getString("event_id")) === -1) return;
      tracked.push({ rec: r, type, identifier: r.getString("tracking_identifier").trim().toUpperCase() });
    });
  });
  const unique = tracked.map((t) => t.identifier).filter((v, i, a) => v && a.indexOf(v) === i);
  if (unique.length === 0) return { status: 200, body: { message: "No entities configured for APRS.fi tracking." } };

  // 5. query APRS.fi
  const res = $http.send({
    url: `https://api.aprs.fi/api/get?name=${encodeURIComponent(unique.join(","))}&what=loc&apikey=${encodeURIComponent(key)}&format=json`,
    method: "GET",
    timeout: 20,
    headers: { "User-Agent": "ECS-PocketBase/1.0 (+https://github.com/DSAdriaanse/event_communications_system)" },
  });
  const data = res.json || {};
  if (data.result !== "ok") {
    console.log("[ecs] APRS.fi error:", data.description || data.result);
    return { status: 500, body: { error: `APRS.fi error: ${data.description || data.result}` } };
  }

  // 6/7. update positions
  const pos = {};
  (data.entries || []).forEach((en) => {
    if (en.name && en.lat && en.lng) pos[String(en.name).toUpperCase()] = { lat: parseFloat(en.lat), lng: parseFloat(en.lng) };
  });
  let updated = 0;
  tracked.forEach((t) => {
    const p = pos[t.identifier];
    if (!p) return;
    t.rec.set("latitude", p.lat);
    t.rec.set("longitude", p.lng);
    $app.save(t.rec);
    updated++;
  });
  console.log(`[ecs] APRS.fi update complete: ${updated} entities updated.`);
  return { status: 200, body: { message: "APRS.fi tracking update complete", queried: unique.length, found: data.found, updated } };
}

// ------------------------------------------------------------------ sendICSEmail

const SENDER_NAME = "SWCRS";

function sender() {
  const meta = $app.settings().meta;
  return {
    name: $os.getenv("ECS_MAIL_FROM_NAME") || meta.senderName || SENDER_NAME,
    address: $os.getenv("ECS_MAIL_FROM_ADDRESS") || meta.senderAddress || "no-reply@localhost",
  };
}

/** Send one HTML mail per recipient (no address leakage between operators). */
function sendToAll(recipients, subject, html) {
  if (!$app.settings().smtp.enabled) {
    const msg = "Email is not configured: enable SMTP in the PocketBase admin (Settings > Mail settings).";
    return { sent: 0, recipients: recipients.map((o) => o.email), errors: [{ error: msg }], success: false, error: msg };
  }
  const from = sender();
  const mailer = $app.newMailClient();
  const sentTo = [];
  const errors = [];
  recipients.forEach((op) => {
    try {
      mailer.send(new MailerMessage({
        from: { address: from.address, name: from.name },
        to: [{ address: op.email, name: op.full_name || op.callsign }],
        subject,
        html,
      }));
      sentTo.push(op.email);
    } catch (ex) {
      errors.push({ email: op.email, error: String(ex) });
    }
  });
  return { sent: sentTo.length, recipients: recipients.map((o) => o.email), errors, success: errors.length === 0 };
}

function bulletinHtml(event, b, issuer, tz) {
  const forms = require(`${__hooks}/lib/emailForms.js`);
  const issued = `<div class="issued-by">\u{1F4E2} <strong>Issued by:</strong> ${SENDER_NAME} · ${tzlib.fmtFull(new Date(), tz)}</div>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ICS 213 — ${b.subject || ""}</title>
<style>${forms.CSS}
.header-block{border:2px solid #1a1a2e;border-radius:4px;margin-bottom:16px;overflow:hidden}
.header-title{background:#1a1a2e;color:#fff;padding:6px 12px;font-size:12pt;font-weight:bold}
.field-row{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #ccc}
.field{padding:6px 10px;border-right:1px solid #ccc}
.field:last-child{border-right:none}
.field .label{font-size:8pt;color:#888;margin-bottom:2px}
.field .value{font-size:11pt;font-weight:bold;min-height:18px}
.message-box{border:2px solid #1a1a2e;border-radius:4px;padding:12px;min-height:80px;font-size:11pt;line-height:1.6;white-space:pre-wrap;margin-bottom:16px}
</style></head><body>
<h2>ICS 213 — General Message (Bulletin)</h2>
<div class="subtitle">SWCRS Event Communications Suite · ${event.name || ""}</div>
${issued}
<div class="header-block">
  <div class="header-title">ICS 213 — GENERAL MESSAGE</div>
  <div class="field-row">
    <div class="field"><div class="label">1. To</div><div class="value">${b.to || "All Operators"}</div></div>
    <div class="field"><div class="label">2. From</div><div class="value">${b.from_name || issuer || ""}</div></div>
  </div>
  <div class="field-row">
    <div class="field"><div class="label">3. Subject</div><div class="value">${b.subject || ""}</div></div>
    <div class="field"><div class="label">4. Date / Time</div><div class="value">${b.date || ""} ${b.time || ""}</div></div>
  </div>
  <div class="field-row">
    <div class="field"><div class="label">5. Message Number</div><div class="value">${b.message_number || "—"}</div></div>
    <div class="field"><div class="label">6. Priority</div><div class="value">${b.priority || "Routine"}</div></div>
  </div>
</div>
<div class="message-box">${(b.message || "").replace(/\n/g, "<br>")}</div>
${b.approved_by ? `<div style="border:1px solid #ccc;border-radius:4px;padding:8px 12px;margin-bottom:16px"><div style="font-size:8pt;color:#888">Approved By / Signature</div><div style="font-size:11pt;font-weight:bold">${b.approved_by}</div></div>` : ""}
<div class="footer">SWCRS Event Communications Suite — ICS 213 General Message · Generated ${tzlib.fmtFull(new Date(), tz)}</div>
</body></html>`;
}

function sendICSEmail(e) {
  const b = body(e);
  const eventId = b.event_id;
  const formType = b.form_type;
  if (!eventId || !formType) return err(e, 400, "Missing event_id or form_type");
  if (!canAccess(e, eventId)) return err(e, 403, "Forbidden");

  let event;
  try { event = plain($app.findRecordById("events", eventId)); } catch (_) { return err(e, 404, "Event not found"); }

  const operators = byEvent("operators", eventId);
  const recipients = operators.filter((o) => o.email);
  const incidentName = event.incident_name || event.name || "Unknown";
  const tz = event.timezone || "America/Phoenix";
  const empty = { success: true, sent: 0, recipients: [], errors: [] };

  if (formType === "BULLETIN") {
    if (recipients.length === 0) return e.json(200, empty);
    const html = bulletinHtml(event, b, authLabel(e), tz);
    return e.json(200, sendToAll(recipients, `${incidentName}: [BULLETIN] ${b.subject || "General Message"}`, html));
  }

  const forms = require(`${__hooks}/lib/emailForms.js`);
  const issuedBy = `<div class="issued-by">\u{1F4E2} <strong>Issued by:</strong> ${SENDER_NAME} · ${tzlib.fmtFull(new Date(), tz)}</div>`;
  const stations = byEvent("aide_stations", eventId);
  const assignments = byEvent("assignments", eventId);
  const frequencies = byEvent("frequencies", eventId);
  let subject; let html;
  if (formType === "ICS201") {
    subject = `${incidentName}: ICS 201 — Operational Briefing`;
    html = forms.buildICS201Html({
      event, stations, assignments, operators, frequencies,
      resourceRequests: byEvent("resource_requests", eventId),
      participants: byEvent("participants", eventId), issuedBy,
    });
  } else if (formType === "ICS204") {
    subject = `${incidentName}: ICS 204 — Assignment List`;
    html = forms.buildICS204Html({ event, assignments, operators, issuedBy });
  } else if (formType === "ICS205A") {
    subject = `${incidentName}: ICS 205A — Communications List`;
    html = forms.buildICS205AHtml({ event, frequencies, operators, stations, issuedBy });
  } else {
    return err(e, 400, "Unknown form_type");
  }
  if (recipients.length === 0) return e.json(200, empty);
  return e.json(200, sendToAll(recipients, subject, html));
}

// ------------------------------------------------------------ generatePrintableReport

const REPORT_TYPES = "1=ICS201, 2=ICS204, 3=ICS205A, 4=ICS213, 5=ICS309, 6=ResourceRequests, 7=BibReport, 8=OfflineSnapshot, 9=FullEventReport";

function generatePrintableReport(e) {
  let eventId; let reportType;
  if (e.request.method === "GET") {
    const q = e.request.url.query();
    eventId = q.get("eventId") || q.get("eventid");
    reportType = q.get("reportType") || q.get("reportid");
  } else {
    const b = body(e);
    eventId = b.eventId; reportType = b.reportType;
  }
  if (!eventId || !reportType) return err(e, 400, "Missing required fields: eventId and reportType");

  let event;
  try { event = plain($app.findRecordById("events", eventId)); } catch (_) { return err(e, 404, "Event not found"); }

  const R = require(`${__hooks}/lib/reports.js`);
  const allLogs = byEvent("event_logs", eventId, "-created_date", 500);
  const stations = byEvent("aide_stations", eventId);
  const assignments = byEvent("assignments", eventId);
  const frequencies = byEvent("frequencies", eventId);
  const operators = byEvent("operators", eventId);
  const participants = byEvent("participants", eventId);
  const bibUpdates = byEvent("participant_status_updates", eventId);
  const resourceRequests = byEvent("resource_requests", eventId);
  const messages = allLogs.filter((m) => m.type === "communication");

  let html;
  switch (String(reportType)) {
    case "1": html = R.buildICS201Html({ event, stations, assignments, operators, frequencies, resourceRequests, participants }); break;
    case "2": html = R.buildICS204Html({ event, assignments, operators }); break;
    case "3": html = R.buildICS205AHtml({ event, frequencies, operators, stations }); break;
    case "4": html = R.buildICS213Html({ event, messages }); break;
    case "5": html = R.buildICS309Html({ event, messages }); break;
    case "6": html = R.buildResourceRequestsHtml({ event, resourceRequests }); break;
    case "7": html = R.buildBibReportHtml({ event, participants, bibUpdates }); break;
    case "8": html = R.buildOfflineSnapshotHtml({ event, messages, stations, assignments, frequencies, operators }); break;
    case "9": html = R.buildFullReportHtml({ event, messages, allLogs, stations, assignments, frequencies, operators, resourceRequests, participants, bibUpdates }); break;
    default: return err(e, 400, `Unknown reportType: "${reportType}". Valid options: ${REPORT_TYPES}`);
  }
  // Reports interpolate stored text — forbid scripts outright (defence in depth).
  e.response.header().set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; font-src data:");
  e.response.header().set("X-Content-Type-Options", "nosniff");
  e.response.header().set("Cache-Control", "no-store");
  return e.html(200, html);
}

module.exports = {
  exportEventData, importEventData, sendICSEmail, aprsFiTracker, generatePrintableReport,
  canAccess, plain,
};
