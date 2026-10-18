import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useEvent } from "@/components/EventContext";
import { FileText, Download, Loader2, WifiOff, Send } from "lucide-react";
import { buildICS201Html, buildICS204Html, buildICS205AHtml } from "@/lib/icsTemplates";
import { formatEventDateTime, formatEventTime, getTzAbbr } from "@/lib/eventTime";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatFreqStr(val) {
  if (!val) return "—";
  const n = parseFloat(val);
  return isNaN(n) ? val : n.toFixed(4) + " MHz";
}

// ── ICS form generators (open print window) ──────────────────────────────────

function openPrint(html) {
  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
}

function exportICS205A(freqs, operators, event, stations = []) {
  openPrint(buildICS205AHtml({ event, frequencies: freqs, operators, stations }) + `<script>window.onload=()=>{window.print();}<\/script>`);
}

function exportICS204(assignments, operators, stations, event) {
  openPrint(buildICS204Html({ event, assignments, operators }) + `<script>window.onload=()=>{window.print();}<\/script>`);
}

function exportICS213(messages, event) {
  const incidentName = event?.incident_name || event?.name || "Unknown";
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>ICS 213 - ${incidentName}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11pt; margin: 15mm; color: #000; }
  h2 { text-align: center; margin: 0 0 4px; font-size: 14pt; }
  .subtitle { text-align: center; font-size: 10pt; color: #444; margin-bottom: 16px; }
  .message-card { border: 1px solid #aaa; border-radius: 4px; margin-bottom: 20px; page-break-inside: avoid; }
  .message-header { background: #1a1a2e; color: #fff; padding: 6px 12px; display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; font-size: 9pt; }
  .message-header span { display: block; }
  .message-header .label { font-size: 8pt; opacity: 0.7; }
  .message-body { padding: 10px 12px; font-size: 10pt; min-height: 60px; }
  .message-footer { border-top: 1px solid #ddd; padding: 6px 12px; font-size: 9pt; color: #666; display: flex; justify-content: space-between; }
  .priority-Emergency { border-left: 4px solid #ef4444; }
  .priority-Priority { border-left: 4px solid #f59e0b; }
  .priority-Welfare { border-left: 4px solid #3b82f6; }
  .priority-Routine { border-left: 4px solid #6b7280; }
  @media print { body { margin: 10mm; } }
</style></head><body>
<h2>ICS 213 — Message Form</h2>
<div class="subtitle">${incidentName} · ${messages.length} messages</div>
${messages.map(m => `
<div class="message-card priority-${m.priority}">
  <div class="message-header">
    <span><span class="label">FROM</span>${m.from_callsign}${m.from_station ? " / " + m.from_station : ""}</span>
    <span><span class="label">TO</span>${m.to_station}</span>
    <span><span class="label">PRIORITY</span>${m.priority}</span>
    <span><span class="label">DATE/TIME</span>${formatEventDateTime(m.created_date, event?.timezone)}</span>
  </div>
  <div class="message-body">${m.content}</div>
  <div class="message-footer">
    <span>Type: ${m.message_type}</span>
    <span>${m.acknowledged ? "✓ Acknowledged by: " + (m.acknowledged_by || "—") : "Not acknowledged"}</span>
  </div>
</div>`).join("")}
<script>window.onload = () => { window.print(); }<\/script>
</body></html>`;
  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
}

function exportICS309(messages, event) {
  const incidentName = event?.incident_name || event?.name || "Unknown";
  const date = event?.date || new Date().toISOString().split("T")[0];
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>ICS 309 - ${incidentName}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11pt; margin: 20mm; color: #000; }
  h2 { text-align: center; margin: 0 0 4px; font-size: 14pt; }
  .subtitle { text-align: center; font-size: 10pt; color: #444; margin-bottom: 16px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 16px; font-size: 10pt; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  th { background: #1a1a2e; color: #fff; padding: 6px 8px; text-align: left; border: 1px solid #333; }
  td { padding: 5px 8px; border: 1px solid #bbb; vertical-align: top; }
  tr:nth-child(even) td { background: #f5f5f5; }
  .footer { margin-top: 12px; font-size: 9pt; color: #666; text-align: right; }
  @media print { body { margin: 10mm; } }
</style></head><body>
<h2>ICS 309 — Communications Log</h2>
<div class="subtitle">SWCRS Event Communications Suite</div>
<div class="meta">
  <span><strong>Incident Name:</strong> ${incidentName}</span>
  <span><strong>Date:</strong> ${date}</span>
  <span><strong>Net Control:</strong> ${event?.net_control_callsign || ""}</span>
</div>
<table>
  <thead><tr><th>Time</th><th>From</th><th>From Station</th><th>To</th><th>Priority</th><th>Type</th><th>ACK</th><th>Message</th></tr></thead>
  <tbody>
    ${[...messages].sort((a,b) => new Date(a.created_date) - new Date(b.created_date)).map(m => `<tr>
      <td style="white-space:nowrap">${formatEventTime(m.created_date, event?.timezone)}</td>
      <td><strong>${m.from_callsign}</strong></td>
      <td>${m.from_station || ""}</td>
      <td>${m.to_station}</td>
      <td>${m.priority}</td>
      <td>${m.message_type}</td>
      <td>${m.acknowledged ? "✓" : ""}</td>
      <td>${m.content}</td>
    </tr>`).join("")}
  </tbody>
</table>
<div class="footer">Total messages: ${messages.length} · Generated ${new Date().toLocaleString("en-US", { timeZone: event?.timezone || "America/Phoenix" })} ${getTzAbbr(event?.timezone)} · SWCRS Event Comms Suite — ICS 309</div>
<script>window.onload = () => { window.print(); }<\/script>
</body></html>`;
  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
}

function exportICS201(event, stations, assignments, operators, frequencies, resourceRequests = [], participants = []) {
  openPrint(buildICS201Html({ event, stations, assignments, operators, frequencies, resourceRequests, participants }) + `<script>window.onload=()=>{window.print();}<\/script>`);
}

function downloadOfflineSnapshot(event, data) {
  const { messages, stations, assignments, frequencies, operators } = data;
  const tz = event?.timezone || "America/Phoenix";
  const snapshotTime = new Date().toLocaleString("en-US", { timeZone: tz }) + " " + getTzAbbr(tz);
  const incidentName = event?.incident_name || event?.name || "Unknown";
  const getFreqName = (val) => {
    if (!val) return "—";
    const freq = frequencies.find(f => f.frequency_mhz === parseFloat(val) || f.frequency_mhz.toString() === val);
    return freq ? freq.name : formatFreqStr(val);
  };

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline Snapshot — ${incidentName}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111; background: #fff; padding: 16px; max-width: 900px; margin: 0 auto; }
  .banner { background: #1e293b; color: #fff; border-radius: 10px; padding: 16px 20px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
  .banner h1 { font-size: 18px; font-weight: bold; color: #22d3ee; }
  .banner .meta { font-size: 11px; color: #94a3b8; }
  .offline-badge { background: #f59e0b; color: #000; font-size: 10px; font-weight: bold; padding: 3px 8px; border-radius: 999px; letter-spacing: 0.05em; }
  .section { margin-bottom: 24px; }
  .section-title { font-size: 13px; font-weight: bold; color: #0891b2; border-bottom: 2px solid #0891b2; padding-bottom: 4px; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #1e293b; color: white; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
  td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; word-break: break-word; }
  tr:nth-child(even) td { background: #f8fafc; }
  .status-Active { color: #16a34a; font-weight: bold; }
  .status-Standby { color: #d97706; }
  .status-Closed { color: #6b7280; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 999px; font-size: 10px; font-weight: bold; }
  .pri-Emergency { background: #fee2e2; color: #dc2626; }
  .pri-Priority { background: #fef3c7; color: #d97706; }
  .pri-Welfare { background: #dbeafe; color: #2563eb; }
  .pri-Routine { background: #f1f5f9; color: #64748b; }
  .freq-block { font-family: monospace; font-weight: bold; color: #0891b2; }
  .footer { text-align: center; font-size: 10px; color: #94a3b8; border-top: 1px solid #e5e7eb; padding-top: 12px; margin-top: 24px; }
  @media (max-width: 600px) { table { font-size: 11px; } th, td { padding: 4px 6px; } }
</style></head><body>

<div class="banner">
  <div>
    <div class="meta">SWCRS Event Comms System</div>
    <h1>${incidentName}</h1>
    <div class="meta">${event?.name || ""}${event?.start_datetime ? " · " + formatEventDateTime(event.start_datetime, event.timezone) : (event?.date ? " · " + event.date : "")}${event?.location ? " · " + event.location : ""}</div>
    ${event?.net_control_callsign ? `<div class="meta">Net Control: ${event.net_control_callsign}</div>` : ""}
  </div>
  <div style="text-align:right">
    <div class="offline-badge">📴 OFFLINE SNAPSHOT</div>
    <div class="meta" style="margin-top:6px">Captured: ${snapshotTime}</div>
    <div class="meta">${stations.length} stations · ${operators.length} operators · ${frequencies.length} freqs</div>
  </div>
</div>

<div class="section">
  <div class="section-title">📡 Frequencies</div>
  <table>
    <thead><tr><th>#</th><th>Name / Channel</th><th>Freq (MHz)</th><th>Tone</th><th>Offset</th><th>Mode</th><th>Use</th><th>Remarks</th></tr></thead>
    <tbody>
      ${frequencies.length ? frequencies.map((f, i) => `<tr>
        <td>${i + 1}</td>
        <td>${f.name}</td>
        <td class="freq-block">${Number(f.frequency_mhz).toFixed(4)}</td>
        <td>${f.tone || "—"}</td>
        <td>${f.repeater_offset || "Simplex"}</td>
        <td>${f.mode}</td>
        <td>${f.use}</td>
        <td>${f.remarks || f.notes || ""}</td>
      </tr>`).join("") : `<tr><td colspan="8" style="color:#aaa;font-style:italic">No frequencies</td></tr>`}
    </tbody>
  </table>
</div>

<div class="section">
  <div class="section-title">🗺️ Stations</div>
  <table>
    <thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Status</th><th>Primary Freq</th><th>Backup Freq</th><th>Address</th><th>Notes</th></tr></thead>
    <tbody>
      ${stations.length ? stations.map(s => `<tr>
         <td><strong>${s.station_id}</strong></td>
         <td>${s.name}</td>
         <td>${s.type}</td>
         <td class="status-${s.status}">${s.status}</td>
         <td class="freq-block">${getFreqName(s.primary_frequency_id)}</td>
         <td class="freq-block">${getFreqName(s.backup_frequency_id)}</td>
         <td>${s.address || "—"}</td>
         <td>${s.notes || ""}</td>
       </tr>`).join("") : `<tr><td colspan="8" style="color:#aaa;font-style:italic">No stations</td></tr>`}
    </tbody>
  </table>
</div>

<div class="section">
  <div class="section-title">👥 Operators</div>
  <table>
    <thead><tr><th>Callsign</th><th>Name</th><th>License</th><th>Phone</th><th>Email</th><th>Status</th><th>Certifications</th><th>Notes</th></tr></thead>
    <tbody>
      ${operators.length ? operators.map(o => `<tr>
        <td><strong>${o.callsign}</strong></td>
        <td>${o.full_name}</td>
        <td>${o.license_class || ""}</td>
        <td>${o.phone || "—"}</td>
        <td>${o.email || "—"}</td>
        <td>${o.status || ""}</td>
        <td>${(o.certifications || []).join(", ") || "—"}</td>
        <td>${o.notes || ""}</td>
      </tr>`).join("") : `<tr><td colspan="8" style="color:#aaa;font-style:italic">No operators</td></tr>`}
    </tbody>
  </table>
</div>

<div class="section">
  <div class="section-title">📋 Assignments</div>
  <table>
    <thead><tr><th>Callsign</th><th>Name</th><th>Station</th><th>Role</th><th>Status</th><th>Start</th><th>End</th><th>Notes</th></tr></thead>
    <tbody>
      ${assignments.length ? assignments.map(a => {
        const op = operators.find(o => o.callsign === a.operator_callsign);
        return `<tr>
          <td><strong>${a.operator_callsign}</strong></td>
          <td>${op?.full_name || ""}</td>
          <td>${a.station_name}</td>
          <td>${a.role}</td>
          <td>${a.status}</td>
          <td>${formatEventDateTime(a.start_time, event?.timezone)}</td>
          <td>${formatEventDateTime(a.end_time, event?.timezone)}</td>
          <td>${a.notes || ""}</td>
        </tr>`;
      }).join("") : `<tr><td colspan="8" style="color:#aaa;font-style:italic">No assignments</td></tr>`}
    </tbody>
  </table>
</div>

<div class="section">
  <div class="section-title">💬 Recent Messages (last 100)</div>
  <table>
    <thead><tr><th>Time</th><th>From</th><th>To</th><th>Priority</th><th>Type</th><th>ACK</th><th>Message</th></tr></thead>
    <tbody>
      ${messages.length ? [...messages].sort((a,b) => new Date(b.created_date) - new Date(a.created_date)).slice(0, 100).map(m => `<tr>
        <td style="white-space:nowrap">${formatEventTime(m.created_date, event?.timezone)}</td>
        <td><strong>${m.from_callsign}</strong>${m.from_station ? `<br><span style="color:#888;font-size:10px">${m.from_station}</span>` : ""}</td>
        <td>${m.to_station}</td>
        <td><span class="badge pri-${m.priority}">${m.priority}</span></td>
        <td>${m.message_type}</td>
        <td>${m.acknowledged ? "✓" : ""}</td>
        <td>${m.content}</td>
      </tr>`).join("") : `<tr><td colspan="7" style="color:#aaa;font-style:italic">No messages</td></tr>`}
    </tbody>
  </table>
</div>

<div class="footer">
  SWCRS Event Comms System — Offline Snapshot<br>
  Captured ${snapshotTime} · This document is a point-in-time snapshot and may not reflect current live data.
</div>
</body></html>`;

  // Download as HTML file
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeName = (event?.name || "event").replace(/[^a-z0-9]/gi, "_").toLowerCase();
  a.href = url;
  a.download = `offline_snapshot_${safeName}_${new Date().toISOString().split("T")[0]}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportOpenResourceRequests(resourceRequests, event) {
  const incidentName = event?.incident_name || event?.name || "Unknown";
  const open = [...(resourceRequests || [])]
    .filter(r => !["Fulfilled", "Cancelled"].includes(r.status))
    .sort((a, b) => (a.station_name || "").localeCompare(b.station_name || ""));

  const priorityBorder = { Emergency: "#dc2626", Urgent: "#d97706", Routine: "#374151" };

  const cards = open.length ? open.map((r, i) => `
  <div class="card" style="border-left: 5px solid ${priorityBorder[r.priority] || "#374151"};">
    <div class="card-header">
      <div class="card-num">Request #${i + 1}</div>
      <div class="card-station">${r.station_name || "Unknown Station"}</div>
      <div class="card-priority priority-${r.priority}">${r.priority}</div>
      <div class="card-status status-${(r.status || "").replace(" ", "")}">${r.status}</div>
    </div>
    <div class="card-body">
      <div class="field-row">
        <div class="field"><span class="label">1. Incident Name</span><span class="value">${incidentName}</span></div>
        <div class="field"><span class="label">2. Date/Time Opened</span><span class="value">${formatEventDateTime(r.created_date, event?.timezone)}</span></div>
        <div class="field"><span class="label">3. Requested By</span><span class="value">${r.requested_by || "—"}</span></div>
      </div>
      <div class="field-row">
        <div class="field wide"><span class="label">4. Resource Type / Category</span><span class="value">${r.type}</span></div>
        <div class="field wide"><span class="label">5. Item / Description</span><span class="value">${r.item}</span></div>
        <div class="field narrow"><span class="label">6. Quantity</span><span class="value">${r.quantity ? r.quantity + (r.unit ? " " + r.unit : "") : "—"}</span></div>
      </div>
      <div class="field-row">
        <div class="field wide"><span class="label">7. Delivery Location / Aide Station</span><span class="value">${r.station_name || "—"}</span></div>
        <div class="field wide"><span class="label">8. Additional Notes / Special Instructions</span><span class="value">${r.notes || "—"}</span></div>
      </div>
      <div class="field-row">
        <div class="field"><span class="label">9. Fulfilled By</span><span class="value">${r.fulfilled_by || "—"}</span></div>
        <div class="field"><span class="label">10. Current Status</span><span class="value">${r.status}</span></div>
      </div>
    </div>
  </div>`).join("") : `<p style="color:#888;font-style:italic;text-align:center;padding:40px">No open resource requests.</p>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>ICS 213RR — Resource Request — ${incidentName}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; background: #fff; padding: 15mm; }
  .page-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #1e293b; padding-bottom: 8px; margin-bottom: 6px; }
  .form-id { font-size: 22pt; font-weight: bold; color: #1e293b; letter-spacing: -0.5px; }
  .form-title { font-size: 13pt; font-weight: bold; color: #1e293b; }
  .form-subtitle { font-size: 9pt; color: #555; }
  .incident-bar { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px 12px; margin-bottom: 16px; display: flex; gap: 24px; font-size: 9pt; }
  .incident-bar strong { color: #1e293b; }
  .card { border: 1px solid #cbd5e1; border-radius: 6px; margin-bottom: 16px; page-break-inside: avoid; overflow: hidden; }
  .card-header { background: #1e293b; color: #fff; display: flex; align-items: center; gap: 12px; padding: 7px 12px; font-size: 9.5pt; }
  .card-num { font-weight: bold; min-width: 80px; }
  .card-station { flex: 1; font-weight: bold; font-size: 11pt; }
  .card-priority, .card-status { padding: 2px 10px; border-radius: 999px; font-size: 8.5pt; font-weight: bold; }
  .priority-Emergency { background: #dc2626; color: #fff; }
  .priority-Urgent { background: #d97706; color: #fff; }
  .priority-Routine { background: #64748b; color: #fff; }
  .status-Pending { background: #fef3c7; color: #92400e; }
  .status-Approved { background: #dbeafe; color: #1e40af; }
  .status-EnRoute { background: #ede9fe; color: #5b21b6; }
  .card-body { padding: 10px 12px; }
  .field-row { display: flex; gap: 12px; margin-bottom: 8px; }
  .field { display: flex; flex-direction: column; flex: 1; border: 1px solid #e2e8f0; border-radius: 3px; padding: 5px 8px; background: #fafafa; }
  .field.wide { flex: 2; }
  .field.narrow { flex: 0.5; }
  .label { font-size: 7.5pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 3px; }
  .value { font-size: 10pt; color: #1e293b; font-weight: 500; min-height: 18px; }
  .footer { text-align: center; font-size: 8pt; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 10px; margin-top: 20px; }
  @media print { body { padding: 10mm; } .card { page-break-inside: avoid; } }
</style></head><body>

<div class="page-header">
  <div>
    <div class="form-id">ICS 213RR</div>
    <div class="form-title">Resource Request</div>
    <div class="form-subtitle">SWCRS Event Communications Suite</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:11pt;font-weight:bold;color:#1e293b">${incidentName}</div>
    <div style="font-size:9pt;color:#555">${event?.name || ""}${event?.start_datetime ? " · " + formatEventDateTime(event.start_datetime, event?.timezone) : (event?.date ? " · " + event.date : "")}</div>
    <div style="font-size:9pt;color:#888">Generated: ${new Date().toLocaleString("en-US", { timeZone: event?.timezone || "America/Phoenix" })} ${getTzAbbr(event?.timezone)}</div>
  </div>
</div>

<div class="incident-bar">
  <span><strong>Incident:</strong> ${incidentName}</span>
  ${event?.net_control_callsign ? `<span><strong>Net Control:</strong> ${event.net_control_callsign}</span>` : ""}
  <span><strong>Open Requests:</strong> ${open.length}</span>
  <span><strong>Sorted by:</strong> Aide Station</span>
</div>

${cards}

<div class="footer">ICS 213RR · Resource Request Form · SWCRS Event Comms Suite · ${new Date().toLocaleString("en-US", { timeZone: event?.timezone || "America/Phoenix" })} ${getTzAbbr(event?.timezone)}</div>
<script>window.onload = () => { window.print(); }<\/script>
</body></html>`;

  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
}

function exportBibReport(participants, bibUpdates, event) {
  const incidentName = event?.incident_name || event?.name || "Unknown";
  const date = event?.date || new Date().toISOString().split("T")[0];

  const statusColor = { Active: "#16a34a", DNS: "#d97706", DNF: "#dc2626", Completed: "#0891b2", Withdrawn: "#6b7280" };

  const sortedBibs = [...participants].sort((a, b) => {
    const an = parseInt(a.bib_number) || 0;
    const bn = parseInt(b.bib_number) || 0;
    return an !== bn ? an - bn : a.bib_number.localeCompare(b.bib_number);
  });

  const bibListRows = sortedBibs.map(p => `<tr>
    <td><strong>${p.bib_number}</strong></td>
    <td>${p.runner_name}</td>
    <td style="color:${statusColor[p.status] || '#111'};font-weight:bold">${p.status || "Active"}</td>
    <td>${p.current_location_name || "—"}</td>
    <td>${formatEventDateTime(p.last_update_date, event?.timezone)}</td>
    <td>${p.notes || ""}</td>
  </tr>`).join("");

  const detailSections = sortedBibs.map(p => {
    const updates = [...bibUpdates.filter(u => u.participant_id === p.id)]
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const updateRows = updates.length
      ? updates.map(u => `<tr>
          <td style="white-space:nowrap">${formatEventDateTime(u.timestamp, event?.timezone)}</td>
          <td style="font-weight:bold">${u.update_type}</td>
          <td>${u.aide_station_name || "—"}</td>
          <td>${u.comment || ""}</td>
          <td>${u.recorded_by || ""}</td>
        </tr>`).join("")
      : `<tr><td colspan="5" style="color:#aaa;font-style:italic">No updates recorded</td></tr>`;
    return `
      <div class="bib-section">
        <div class="bib-header">
          <span class="bib-num">#${p.bib_number}</span>
          <span class="bib-name">${p.runner_name}</span>
          <span class="bib-status" style="color:${statusColor[p.status] || '#111'}">${p.status || "Active"}</span>
          ${p.notes ? `<span class="bib-note">${p.notes}</span>` : ""}
        </div>
        <table>
          <thead><tr><th>Timestamp</th><th>Update</th><th>Station</th><th>Comment</th><th>Recorded By</th></tr></thead>
          <tbody>${updateRows}</tbody>
        </table>
      </div>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Bib Report — ${incidentName}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11pt; margin: 20mm; color: #000; }
  h2 { text-align: center; margin: 0 0 4px; font-size: 16pt; color: #0891b2; }
  .subtitle { text-align: center; font-size: 10pt; color: #444; margin-bottom: 6px; }
  .meta { text-align: center; font-size: 10pt; color: #666; margin-bottom: 20px; }
  .section-title { font-weight: bold; font-size: 13pt; border-bottom: 2px solid #0891b2; padding-bottom: 4px; margin: 24px 0 12px; color: #0891b2; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-bottom: 16px; }
  th { background: #1e293b; color: #fff; padding: 6px 8px; text-align: left; border: 1px solid #333; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.04em; }
  td { padding: 5px 8px; border: 1px solid #ddd; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  .bib-section { margin-bottom: 20px; page-break-inside: avoid; }
  .bib-header { display: flex; align-items: center; gap: 12px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 8px 12px; margin-bottom: 6px; }
  .bib-num { font-family: monospace; font-size: 16pt; font-weight: bold; color: #0891b2; min-width: 56px; }
  .bib-name { font-size: 12pt; font-weight: bold; flex: 1; }
  .bib-status { font-size: 10pt; font-weight: bold; }
  .bib-note { font-size: 9pt; color: #d97706; font-style: italic; }
  .footer { margin-top: 20px; font-size: 9pt; color: #999; text-align: right; border-top: 1px solid #ddd; padding-top: 8px; }
  .stats { display: flex; gap: 16px; justify-content: center; margin-bottom: 20px; flex-wrap: wrap; }
  .stat { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 8px 16px; text-align: center; }
  .stat .n { font-size: 20pt; font-weight: bold; color: #0891b2; }
  .stat .l { font-size: 9pt; color: #555; }
  @media print { body { margin: 10mm; } .bib-section { page-break-inside: avoid; } }
</style></head><body>
<h2>Bib Tracker Report</h2>
<div class="subtitle">SWCRS Event Communications Suite</div>
<div class="meta">${incidentName} · ${event?.name || ""} · ${date}</div>

<div class="stats">
  <div class="stat"><div class="n">${participants.length}</div><div class="l">Total</div></div>
  <div class="stat"><div class="n" style="color:#16a34a">${participants.filter(p => p.status === "Active").length}</div><div class="l">Active</div></div>
  <div class="stat"><div class="n" style="color:#0891b2">${participants.filter(p => p.status === "Completed").length}</div><div class="l">Finished</div></div>
  <div class="stat"><div class="n" style="color:#dc2626">${participants.filter(p => p.status === "DNF").length}</div><div class="l">DNF</div></div>
  <div class="stat"><div class="n" style="color:#d97706">${participants.filter(p => p.status === "DNS").length}</div><div class="l">DNS</div></div>
</div>

<div class="section-title">Section 1 — Participant List (${participants.length} bibs)</div>
<table>
  <thead><tr><th>Bib #</th><th>Name</th><th>Status</th><th>Last Location</th><th>Last Update</th><th>Notes</th></tr></thead>
  <tbody>${bibListRows || `<tr><td colspan="6" style="color:#aaa;font-style:italic">No participants</td></tr>`}</tbody>
</table>

<div class="section-title">Section 2 — Detailed Activity Log (by bib number)</div>
${detailSections || `<p style="color:#aaa;font-style:italic">No participants.</p>`}

<div class="footer">Generated by SWCRS Event Comms Suite · ${new Date().toLocaleString("en-US", { timeZone: event?.timezone || "America/Phoenix" })} ${getTzAbbr(event?.timezone)} · ${bibUpdates.length} total update entries</div>
<script>window.onload = () => { window.print(); }<\/script>
</body></html>`;

  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function EventReport() {
  const { activeEvent, activeEventId } = useEvent();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [issuing, setIssuing] = useState(null);

  const issueForm = async (form_type) => {
    setIssuing(form_type);
    const res = await base44.functions.invoke("sendICSEmail", { event_id: activeEventId, form_type });
    setIssuing(null);
    alert(`${form_type} issued to ${res.data.sent} operator(s): ${res.data.recipients.join(", ")}`);
  };

  const loadData = async () => {
    if (!activeEventId) return;
    setLoading(true);
    const [eventLogs, stations, assignments, frequencies, operators, participants, bibUpdates, resourceRequests, bulletins] = await Promise.all([
      base44.entities.EventLog.filter({ event_id: activeEventId }, "-created_date", 500),
      base44.entities.AideStation.list(),
      base44.entities.Assignment.list(),
      base44.entities.Frequency.list(),
      base44.entities.Operator.list(),
      base44.entities.Participant.filter({ event_id: activeEventId }),
      base44.entities.ParticipantStatusUpdate.filter({ event_id: activeEventId }),
      base44.entities.ResourceRequest.filter({ event_id: activeEventId }),
      base44.entities.Bulletin.filter({ event_id: activeEventId }, "-created_date"),
    ]);
    const sortByOrder = (arr) => [...arr].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const sortBibs = (arr) => [...arr].sort((a, b) => {
      const an = parseInt(a.bib_number) || 0;
      const bn = parseInt(b.bib_number) || 0;
      return an !== bn ? an - bn : a.bib_number.localeCompare(b.bib_number);
    });
    const messages = eventLogs.filter(m => m.type === "communication");
    setData({
      messages,
      allLogs: eventLogs,
      stations: sortByOrder(stations.filter(s => s.event_id === activeEventId)),
      assignments: assignments.filter(a => a.event_id === activeEventId),
      frequencies: sortByOrder(frequencies.filter(f => f.event_id === activeEventId)),
      operators: operators.filter(o => o.event_id === activeEventId),
      participants: sortBibs(participants),
      bibUpdates,
      resourceRequests,
      bulletins,
    });
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [activeEventId]);

  const generateReport = () => {
    if (!data || !activeEvent) return;
    setGenerating(true);
    const { messages, allLogs, stations, assignments, frequencies, operators, participants = [], bibUpdates = [] } = data;
    const priorityColors = { Emergency: "#ef4444", Priority: "#f59e0b", Welfare: "#3b82f6", Routine: "#6b7280" };
    const statusColors = { Active: "#22c55e", Standby: "#f59e0b", Closed: "#6b7280", Requested: "#3b82f6" };

    const typeLabels = { communication: "Comms", task_completion: "Task", note: "Note", system_event: "System" };
    const typeColors = { communication: "#22d3ee", task_completion: "#22c55e", note: "#a78bfa", system_event: "#94a3b8" };
    const msgRows = [...allLogs].sort((a,b) => new Date(a.created_date) - new Date(b.created_date)).map(m => `<tr>
      <td style="white-space:nowrap">${formatEventTime(m.created_date, activeEvent.timezone)}</td>
      <td style="color:${typeColors[m.type]};font-weight:bold">${typeLabels[m.type] || m.type}</td>
      <td><strong>${m.from_callsign || ""}</strong>${m.from_station ? " / " + m.from_station : ""}</td>
      <td>${m.to_station || ""}</td>
      <td style="color:${priorityColors[m.priority] || "#6b7280"}">${m.priority || ""}</td>
      <td>${m.acknowledged ? "✓" : ""}</td>
      <td>${m.content}</td>
    </tr>`).join("");

    const stationRows = stations.map(s => {
      const ops = assignments.filter(a => a.station_name === s.name).map(a => `${a.operator_callsign} (${a.role})`).join(", ");
      return `<tr>
        <td>${s.station_id}</td><td>${s.name}</td><td>${s.type}</td>
        <td style="color:${statusColors[s.status]}">${s.status}</td>
        <td>${frequencies.find(f => f.id === s.primary_frequency_id)?.name || '—'}</td>
        <td>${frequencies.find(f => f.id === s.backup_frequency_id)?.name || '—'}</td>
        <td>${ops || "—"}</td>
      </tr>`;
    }).join("");

    const freqRows = frequencies.map((f, i) => `<tr>
      <td>${i + 1}</td><td>${f.name}</td>
      <td><strong>${Number(f.frequency_mhz).toFixed(4)}</strong></td>
      <td>${f.tone || ""}</td><td>${f.repeater_offset || "Simplex"}</td>
      <td>${f.mode}</td><td>${f.use}</td><td>${f.remarks || f.notes || ""}</td>
    </tr>`).join("");

    const assignRows = assignments.map(a => {
      const op = operators.find(o => o.callsign === a.operator_callsign);
      return `<tr>
        <td><strong>${a.operator_callsign}</strong></td><td>${op?.full_name || ""}</td>
        <td>${a.station_name}</td><td>${a.role}</td><td>${a.status}</td>
        <td>${formatEventDateTime(a.start_time, activeEvent.timezone)}</td>
        <td>${formatEventDateTime(a.end_time, activeEvent.timezone)}</td>
      </tr>`;
    }).join("");

    const { resourceRequests = [] } = data;
    const reqPriorityColor = { Emergency: "#ef4444", Urgent: "#f59e0b", Routine: "#6b7280" };
    const reqStatusColor = { Pending: "#f59e0b", Approved: "#3b82f6", "En Route": "#8b5cf6", Fulfilled: "#22c55e", Cancelled: "#6b7280" };
    const resourceRows = resourceRequests.map(r => {
      const opened = r.created_date ? new Date(r.created_date) : null;
      const closed = r.updated_date && (r.status === "Fulfilled" || r.status === "Cancelled") ? new Date(r.updated_date) : null;
      const durationMs = opened && closed ? closed - opened : null;
      const durationStr = durationMs !== null
        ? (() => { const m = Math.floor(durationMs / 60000); return m < 60 ? `${m}m` : `${Math.floor(m/60)}h ${m%60}m`; })()
        : "—";
      return `<tr>
        <td style="white-space:nowrap">${formatEventDateTime(r.created_date, activeEvent.timezone)}</td>
        <td style="white-space:nowrap">${closed ? formatEventDateTime(r.updated_date, activeEvent.timezone) : "—"}</td>
        <td>${durationStr}</td>
        <td>${r.station_name || "—"}</td>
        <td>${r.type}</td>
        <td>${r.item}</td>
        <td>${r.quantity ? r.quantity + (r.unit ? " " + r.unit : "") : "—"}</td>
        <td style="color:${reqPriorityColor[r.priority] || "#6b7280"};font-weight:bold">${r.priority}</td>
        <td style="color:${reqStatusColor[r.status] || "#6b7280"};font-weight:bold">${r.status}</td>
        <td>${r.requested_by || "—"}</td>
        <td>${r.fulfilled_by || "—"}</td>
        <td>${r.notes || ""}</td>
      </tr>`;
    }).join("");

    const bibStatusColor = { Active: "#16a34a", DNS: "#d97706", DNF: "#dc2626", Completed: "#0891b2", Withdrawn: "#6b7280" };
    const sortedBibsForReport = [...participants].sort((a, b) => {
      const an = parseInt(a.bib_number) || 0; const bn = parseInt(b.bib_number) || 0;
      return an !== bn ? an - bn : a.bib_number.localeCompare(b.bib_number);
    });
    const bibListRows = sortedBibsForReport.map(p => `<tr>
      <td><strong>${p.bib_number}</strong></td><td>${p.runner_name}</td>
      <td style="color:${bibStatusColor[p.status] || '#111'};font-weight:bold">${p.status || "Active"}</td>
      <td>${p.current_location_name || "—"}</td>
      <td>${formatEventDateTime(p.last_update_date, activeEvent.timezone)}</td>
      <td>${p.notes || ""}</td>
    </tr>`).join("");
    const bibDetailSections = sortedBibsForReport.map(p => {
      const updates = [...bibUpdates.filter(u => u.participant_id === p.id)].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
      const updateRows = updates.length
        ? updates.map(u => `<tr>
          <td style="white-space:nowrap">${formatEventDateTime(u.timestamp, activeEvent.timezone)}</td>
            <td style="font-weight:bold">${u.update_type}</td>
            <td>${u.aide_station_name || "—"}</td>
            <td>${u.comment || ""}</td>
            <td>${u.recorded_by || ""}</td>
          </tr>`).join("")
        : `<tr><td colspan="5" style="color:#aaa;font-style:italic">No updates recorded</td></tr>`;
      return `<div style="margin-bottom:16px;page-break-inside:avoid">
        <div style="display:flex;align-items:center;gap:10px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:7px 10px;margin-bottom:5px;">
          <span style="font-family:monospace;font-size:14px;font-weight:bold;color:#0891b2;min-width:52px">#${p.bib_number}</span>
          <span style="font-size:11px;font-weight:bold;flex:1">${p.runner_name}</span>
          <span style="font-size:10px;font-weight:bold;color:${bibStatusColor[p.status] || '#111'}">${p.status || "Active"}</span>
          ${p.notes ? `<span style="font-size:9px;color:#d97706;font-style:italic">${p.notes}</span>` : ""}
        </div>
        <table><thead><tr><th>Timestamp</th><th>Update</th><th>Station</th><th>Comment</th><th>Recorded By</th></tr></thead>
        <tbody>${updateRows}</tbody></table>
      </div>`;
    }).join("");

    const html = `<!DOCTYPE html><html><head><title>Event Report - ${activeEvent.name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; background: #fff; padding: 20px; }
  .cover { text-align: center; padding: 60px 0 40px; border-bottom: 3px solid #0891b2; margin-bottom: 30px; }
  .cover h1 { font-size: 28px; color: #0891b2; font-weight: bold; }
  .cover h2 { font-size: 18px; color: #333; margin-top: 8px; }
  .cover p { color: #555; margin-top: 6px; font-size: 13px; }
  .section { margin-bottom: 30px; }
  .section-title { font-size: 14px; font-weight: bold; color: #0891b2; border-bottom: 2px solid #0891b2; padding-bottom: 5px; margin-bottom: 12px; }
  .stats-row { display: flex; gap: 12px; margin-bottom: 20px; }
  .stat-box { flex: 1; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 12px; text-align: center; }
  .stat-box .num { font-size: 24px; font-weight: bold; color: #0891b2; }
  .stat-box .lbl { font-size: 10px; color: #555; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th { background: #1e293b; color: white; text-align: left; padding: 6px 8px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; }
  td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  tr:nth-child(even) td { background: #f9fafb; }
  .footer { text-align: center; font-size: 9px; color: #999; border-top: 1px solid #e5e7eb; padding-top: 12px; margin-top: 30px; }
  @media print { body { padding: 10px; } }
</style></head><body>
<div class="cover">
  <h1>📻 SWCRS ECS EVENT REPORT</h1>
  <h2>${activeEvent.incident_name || activeEvent.name}</h2>
  <p>${activeEvent.name}${activeEvent.date ? " · " + activeEvent.date : ""}${activeEvent.location ? " · " + activeEvent.location : ""}</p>
  ${activeEvent.net_control_callsign ? `<p>Net Control: ${activeEvent.net_control_callsign}</p>` : ""}
  <p style="margin-top:16px;color:#aaa;font-size:11px;">Report generated: ${new Date().toLocaleString("en-US", { timeZone: activeEvent.timezone || "America/Phoenix" })} ${getTzAbbr(activeEvent.timezone || "America/Phoenix")}</p>
</div>
<div class="stats-row">
  <div class="stat-box"><div class="num">${allLogs.length}</div><div class="lbl">Total Log Entries</div></div>
  <div class="stat-box"><div class="num">${messages.length}</div><div class="lbl">Comms</div></div>
  <div class="stat-box"><div class="num">${allLogs.filter(m => m.type === "task_completion").length}</div><div class="lbl">Tasks Completed</div></div>
  <div class="stat-box"><div class="num">${stations.length}</div><div class="lbl">Stations</div></div>
  <div class="stat-box"><div class="num">${messages.filter(m => m.priority === "Emergency").length}</div><div class="lbl">Emergency Msgs</div></div>
  <div class="stat-box"><div class="num">${messages.filter(m => m.acknowledged).length}</div><div class="lbl">ACK'd Msgs</div></div>
  <div class="stat-box"><div class="num">${data.participants?.length || 0}</div><div class="lbl">Bibs Tracked</div></div>
</div>
<div class="section"><div class="section-title">📡 ICS-205A — Frequency List</div>
  <table><thead><tr><th>#</th><th>Name/Function</th><th>Freq (MHz)</th><th>Tone</th><th>Offset</th><th>Mode</th><th>Use</th><th>Remarks</th></tr></thead>
  <tbody>${freqRows || "<tr><td colspan='8'>No frequencies</td></tr>"}</tbody></table>
</div>
<div class="section"><div class="section-title">🗺️ Aide Station / Asset List</div>
  <table><thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Status</th><th>Primary Freq</th><th>Secondary Freq</th><th>Operators</th></tr></thead>
  <tbody>${stationRows || "<tr><td colspan='7'>No stations</td></tr>"}</tbody></table>
</div>
<div class="section"><div class="section-title">👥 Operator Assignments</div>
  <table><thead><tr><th>Callsign</th><th>Name</th><th>Station</th><th>Role</th><th>Status</th><th>Start</th><th>End</th></tr></thead>
  <tbody>${assignRows || "<tr><td colspan='7'>No assignments</td></tr>"}</tbody></table>
</div>
<div class="section"><div class="section-title">📋 Full Event Log</div>
  <table><thead><tr><th>Time</th><th>Type</th><th>From</th><th>To</th><th>Priority</th><th>ACK</th><th>Content</th></tr></thead>
  <tbody>${msgRows || "<tr><td colspan='7'>No log entries</td></tr>"}</tbody></table>
</div>
<div class="section"><div class="section-title">📦 Resource Requests (${resourceRequests.length})</div>
  <table><thead><tr><th>Opened</th><th>Closed</th><th>Duration</th><th>Station</th><th>Type</th><th>Item</th><th>Qty</th><th>Priority</th><th>Status</th><th>Requested By</th><th>Fulfilled By</th><th>Notes</th></tr></thead>
  <tbody>${resourceRows || "<tr><td colspan='12' style='color:#aaa;font-style:italic'>No resource requests</td></tr>"}</tbody></table>
</div>
<div class="section"><div class="section-title">🏃 Bib Tracker — Participant List (${participants.length} bibs)</div>
  <table><thead><tr><th>Bib #</th><th>Name</th><th>Status</th><th>Last Location</th><th>Last Update</th><th>Notes</th></tr></thead>
  <tbody>${bibListRows || "<tr><td colspan='6' style='color:#aaa;font-style:italic'>No participants</td></tr>"}</tbody></table>
</div>
<div class="section"><div class="section-title">🏃 Bib Tracker — Activity Log by Bib Number</div>
  ${bibDetailSections || "<p style='color:#aaa;font-style:italic'>No participants.</p>"}
</div>
<div class="footer">SWCRS Event Communications Suite · Generated ${new Date().toLocaleString("en-US", { timeZone: activeEvent.timezone || "America/Phoenix" })} ${getTzAbbr(activeEvent.timezone || "America/Phoenix")} · ${activeEvent.name}</div>
<script>window.onload = () => { window.print(); }<\/script>
</body></html>`;

    try {
      const win = window.open("", "_blank");
      if (!win) {
        alert("Popup blocked! Please allow popups for this site and try again.");
        return;
      }
      win.document.write(html);
      win.document.close();
    } finally {
      setGenerating(false);
    }
  };

  if (!activeEventId) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Select an active event from the sidebar to generate a report.</p>
        </div>
      </div>
    );
  }

  const icsButtons = data ? [
    {
      label: "ICS 201 — Operational Briefing",
      desc: "Snapshot of incident info, stations & initial assignments",
      onClick: () => exportICS201(activeEvent, data.stations, data.assignments, data.operators, data.frequencies, data.resourceRequests, data.participants),
      issueKey: "ICS201",
      reportId: 1,
    },
    {
      label: "ICS 204 — Assignment List",
      desc: "Full operator assignments with roles, times & contact info",
      onClick: () => exportICS204(data.assignments, data.operators, data.stations, activeEvent),
      issueKey: "ICS204",
      reportId: 2,
    },
    {
      label: "ICS 205A — Communications List",
      desc: "Frequency plan with tones, modes & channel assignments + operator roster with contact info",
      onClick: () => exportICS205A(data.frequencies, data.operators, activeEvent, data.stations),
      issueKey: "ICS205A",
      reportId: 3,
    },
    {
      label: "ICS 213RR — Open Resource Requests",
      desc: "Open resource requests sorted by aide station",
      onClick: () => exportOpenResourceRequests(data.resourceRequests, activeEvent),
      reportId: 6,
    },
    {
      label: "ICS 309 — Communications Log",
      desc: "Chronological log of all net traffic",
      onClick: () => exportICS309(data.messages, activeEvent),
      reportId: 5,
    },
  ] : [];

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Event Report</h1>
          <p className="text-gray-500 text-sm mt-1">{activeEvent?.name}</p>
        </div>

        {loading ? (
          <div className="text-center text-gray-600 py-16">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-cyan-500" />
            Loading event data...
          </div>
        ) : data && (
          <>
            {/* Summary stats */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-6">
              <h2 className="text-white font-semibold">Report Preview</h2>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: "Total Log Entries", value: data.allLogs.length },
                  { label: "Comms", value: data.messages.length },
                  { label: "Tasks Completed", value: data.allLogs.filter(m => m.type === "task_completion").length },
                  { label: "Stations", value: data.stations.length },
                  { label: "Emergency Msgs", value: data.messages.filter(m => m.priority === "Emergency").length },
                  { label: "ACK'd", value: data.messages.filter(m => m.acknowledged).length },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-gray-800 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-cyan-400">{value}</div>
                    <div className="text-xs text-gray-500 mt-1">{label}</div>
                  </div>
                ))}
              </div>

              <button onClick={generateReport} disabled={generating}
                className="w-full flex items-center justify-between gap-2 px-6 py-3 bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 text-gray-950 font-bold rounded-xl text-sm transition-all">
                <div className="flex items-center gap-2">
                  {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  Generate &amp; Print Full Event Report
                </div>
                <span className="w-5 h-5 rounded bg-black/20 text-gray-950 text-xs font-bold flex items-center justify-center">9</span>
              </button>
              <p className="text-xs text-gray-600 text-center">Opens a print dialog — save as PDF from your browser</p>

              <div className="border-t border-gray-700 pt-4 space-y-3">
                <button onClick={() => exportBibReport(data.participants, data.bibUpdates, activeEvent)}
                  className="w-full flex items-center justify-between gap-2 px-6 py-3 bg-gray-700 hover:bg-gray-600 border border-gray-600 hover:border-cyan-500/50 text-white font-semibold rounded-xl text-sm transition-all">
                  <div className="flex items-center gap-2">
                    <Download className="w-4 h-4 text-cyan-400" />
                    Generate Bib Tracker Report
                  </div>
                  <span className="w-5 h-5 rounded bg-gray-600 text-gray-300 text-xs font-bold flex items-center justify-center">7</span>
                </button>
                <p className="text-xs text-gray-600 text-center">Participant list + full activity log per bib ({data.participants?.length || 0} bibs, {data.bibUpdates?.length || 0} updates)</p>
                <button onClick={() => downloadOfflineSnapshot(activeEvent, data)}
                  className="w-full flex items-center justify-between gap-2 px-6 py-3 bg-gray-700 hover:bg-gray-600 border border-gray-600 hover:border-amber-500/50 text-white font-semibold rounded-xl text-sm transition-all group">
                  <div className="flex items-center gap-2">
                    <WifiOff className="w-4 h-4 text-amber-400" />
                    Download Offline Snapshot
                  </div>
                  <span className="w-5 h-5 rounded bg-gray-600 text-gray-300 text-xs font-bold flex items-center justify-center">8</span>
                </button>
                <p className="text-xs text-gray-600 text-center">Downloads an HTML file — open on any device without internet. Includes all stations, operators, frequencies, assignments &amp; recent messages.</p>
              </div>
            </div>

            {/* Email Distribution */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-3">
              <div>
                <h2 className="text-white font-semibold">Email Distribution List</h2>
                <p className="text-gray-500 text-xs mt-1">Copy and paste into your mail client — {data.operators.filter(o => o.email).length} operator(s) with email addresses</p>
              </div>
              {data.operators.filter(o => o.email).length === 0 ? (
                <p className="text-gray-600 text-sm italic">No operators with email addresses found.</p>
              ) : (
                <div className="relative">
                  <textarea
                    readOnly
                    value={data.operators.filter(o => o.email).map(o => o.email).join("; ")}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-200 font-mono resize-none focus:outline-none focus:border-cyan-500/50"
                    rows={3}
                    onClick={e => e.target.select()}
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(data.operators.filter(o => o.email).map(o => o.email).join("; "))}
                    className="absolute top-2 right-2 px-2 py-1 bg-gray-700 hover:bg-cyan-500 hover:text-gray-950 text-gray-400 text-xs font-semibold rounded transition-all"
                  >
                    Copy
                  </button>
                </div>
              )}
            </div>

            {/* Bulletins */}
            {data.bulletins?.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
                <div>
                  <h2 className="text-white font-semibold">Issued Bulletins</h2>
                  <p className="text-gray-500 text-xs mt-1">{data.bulletins.length} bulletin(s) issued for this event — click to view</p>
                </div>
                <div className="space-y-2">
                  {data.bulletins.map(b => {
                    const priColor = { Emergency: "border-red-600/50 text-red-400", Priority: "border-amber-600/50 text-amber-400", Welfare: "border-blue-600/50 text-blue-400", Routine: "border-gray-700 text-gray-400" };
                    return (
                      <div key={b.id}
                        onClick={() => window.open(`/BulletinView/${b.id}`, "_blank")}
                        className={`flex items-center justify-between gap-3 px-4 py-3 bg-gray-800 hover:bg-gray-700 border ${priColor[b.priority] || priColor.Routine} hover:border-cyan-500/30 rounded-lg cursor-pointer transition-all group`}>
                        <div className="flex items-center gap-3 min-w-0">
                          <FileText className="w-4 h-4 text-violet-400 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-white group-hover:text-cyan-300 truncate">{b.subject}</div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              {b.message_number ? `#${b.message_number} · ` : ''}{b.from_name || 'NCO'}{b.sent_count != null ? ` · ${b.sent_count} sent` : ''}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`text-xs font-semibold ${priColor[b.priority]?.split(' ').pop() || ''}`}>{b.priority}</span>
                          <Download className="w-4 h-4 text-gray-500 group-hover:text-cyan-400" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ICS Forms section */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
              <div>
                <h2 className="text-white font-semibold">ICS Forms</h2>
                <p className="text-gray-500 text-xs mt-1">Download individual standardized ICS forms for this event</p>
              </div>
              <div className="space-y-2">
                {icsButtons.map(({ label, desc, onClick, issueKey, reportId }) => (
                  <div key={label} className="flex items-stretch gap-2">
                    <button onClick={onClick}
                      className="flex-1 flex items-center justify-between gap-3 px-4 py-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-cyan-500/30 rounded-lg text-left transition-all group">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded bg-gray-700 group-hover:bg-cyan-500/20 text-gray-400 group-hover:text-cyan-400 text-xs font-bold flex items-center justify-center transition-colors">{reportId}</span>
                        <div>
                          <div className="text-sm font-medium text-white group-hover:text-cyan-300 transition-colors">{label}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{desc}</div>
                        </div>
                      </div>
                      <Download className="w-4 h-4 text-gray-500 group-hover:text-cyan-400 flex-shrink-0 transition-colors" />
                    </button>
                    {issueKey && (
                      <button
                        onClick={() => issueForm(issueKey)}
                        disabled={issuing === issueKey}
                        title={`Email ${label} to all operators`}
                        className="flex items-center gap-1.5 px-3 py-2 bg-violet-700 hover:bg-violet-600 disabled:bg-gray-700 text-white text-xs font-semibold rounded-lg transition-all flex-shrink-0"
                      >
                        {issuing === issueKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        Issue
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}