// Printable HTML reports (ICS 201/204/205A/213/309, resource requests, bib report, snapshot,
// full event report). Ported verbatim from base44/functions/generatePrintableReport/entry.ts —
// only the timezone helpers moved to lib/tz.js (goja has no Intl).
//
// SECURITY: these templates interpolate stored data into HTML like the original did. The route in
// main.pb.js therefore serves them with a Content-Security-Policy that forbids scripts entirely.


const { fmtTz, fmtTimeTz, nowTz } = require(`${__hooks}/lib/tz.js`);

// ── Shared CSS ────────────────────────────────────────────────────────────────
const CSS = `
  body { font-family: Arial, sans-serif; font-size: 11pt; color: #111; max-width: 960px; margin: 0 auto; padding: 20px; }
  h2 { margin: 0 0 4px; font-size: 16pt; color: #0891b2; }
  .subtitle { font-size: 10pt; color: #444; margin-bottom: 16px; }
  .section { margin-bottom: 20px; }
  .section-title { font-weight: bold; font-size: 11pt; border-bottom: 2px solid #1a1a2e; padding-bottom: 4px; margin-bottom: 8px; color: #1a1a2e; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 16px; }
  .field { border: 1px solid #ccc; padding: 4px 8px; border-radius: 3px; }
  .field .label { font-size: 8pt; color: #888; }
  .field .value { font-size: 11pt; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th { background: #1a1a2e; color: #fff; padding: 6px 8px; text-align: left; border: 1px solid #333; }
  td { padding: 5px 8px; border: 1px solid #bbb; vertical-align: top; }
  tr:nth-child(even) td { background: #f5f5f5; }
  .footer { margin-top: 20px; font-size: 9pt; color: #666; border-top: 1px solid #ddd; padding-top: 8px; }
  @media print { body { margin: 10mm; padding: 0; } }
`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function sortByOrder(arr) {
  return [...arr].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

function getFreqName(id, frequencies) {
  if (!id) return '—';
  const freq = frequencies.find(f => f.id === id);
  return freq ? freq.name : '—';
}

function sortBibs(arr) {
  return [...arr].sort((a, b) => {
    const an = parseInt(a.bib_number) || 0, bn = parseInt(b.bib_number) || 0;
    return an !== bn ? an - bn : a.bib_number.localeCompare(b.bib_number);
  });
}

// ── ICS 201 ───────────────────────────────────────────────────────────────────
function buildICS201Html({ event, stations, assignments, operators, frequencies, resourceRequests = [], participants = [] }) {
  const incidentName = event?.incident_name || event?.name || 'Unknown';
  const date = event?.date || new Date().toISOString().split('T')[0];
  const tz = event?.timezone || 'UTC';
  const sortedStations = sortByOrder(stations);
  const sortedAssignments = [...assignments].sort((a, b) => a.operator_callsign.localeCompare(b.operator_callsign));
  const activeRequests = resourceRequests.filter(r => ['Pending', 'Approved', 'En Route'].includes(r.status));
  const sortedBibsList = sortBibs(participants);
  const bibStatusColor = { Active: '#16a34a', DNS: '#d97706', DNF: '#dc2626', Completed: '#0891b2', Withdrawn: '#6b7280' };
  const reqPriorityColor = { Emergency: '#dc2626', Urgent: '#d97706', Routine: '#374151' };

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ICS 201 — ${incidentName}</title>
<style>${CSS}</style></head><body>
<h2>ICS 201 — Operational Briefing</h2>
<div class="subtitle">SWCRS Event Communications Suite · ${event?.name || ''}</div>
<div class="section">
  <div class="section-title">1. Incident Information</div>
  <div class="meta-grid">
    <div class="field"><div class="label">Incident Name</div><div class="value">${incidentName}</div></div>
    <div class="field"><div class="label">Event Name</div><div class="value">${event?.name || ''}</div></div>
    <div class="field"><div class="label">Date</div><div class="value">${date}</div></div>
    <div class="field"><div class="label">Location</div><div class="value">${event?.location || ''}</div></div>
    <div class="field"><div class="label">Net Control</div><div class="value">${event?.net_control_callsign || ''}</div></div>
    <div class="field"><div class="label">Status</div><div class="value">${event?.status || ''}</div></div>
  </div>
</div>
<div class="section">
  <div class="section-title">2. Situational Awareness &amp; Briefing</div>
  <div style="border:1px solid #ccc;min-height:40px;padding:8px 12px;border-radius:3px;font-size:10pt;line-height:1.6;">
    ${event?.discussion || '<em style="color:#aaa">No briefing content recorded.</em>'}
  </div>
</div>
<div class="section">
  <div class="section-title">3. Current Situation — Stations</div>
  <table>
    <thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Status</th><th>Primary Freq</th><th>Secondary Freq</th></tr></thead>
    <tbody>${sortedStations.map(s => {
      const closed = s.status === 'Closed';
      return `<tr style="${closed ? 'color:#aaa' : ''}">
        <td>${s.station_id}</td><td>${s.name}${closed ? ' <em style="font-size:8pt">(closed)</em>' : ''}</td><td>${s.type}</td>
        <td style="color:${closed ? '#aaa' : s.status === 'Active' ? '#16a34a' : s.status === 'Standby' ? '#d97706' : '#374151'};font-weight:bold">${s.status}</td>
        <td>${getFreqName(s.primary_frequency_id, frequencies)}</td>
        <td>${getFreqName(s.backup_frequency_id, frequencies)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>
</div>
<div class="section">
  <div class="section-title">4. Initial Assignments</div>
  <table>
    <thead><tr><th>Callsign</th><th>Name</th><th>Station</th><th>Role</th><th>Status</th></tr></thead>
    <tbody>${sortedAssignments.map(a => {
      const op = operators.find(o => o.callsign === a.operator_callsign);
      const done = a.status === 'Completed' || a.status === 'Cancelled';
      return `<tr style="${done ? 'color:#aaa' : ''}"><td><strong>${a.operator_callsign}</strong></td><td>${op?.full_name || ''}</td><td>${a.station_name}</td><td>${a.role}</td><td>${a.status}</td></tr>`;
    }).join('')}</tbody>
  </table>
</div>
<div class="section">
  <div class="section-title">5. Active Resource Requests (${activeRequests.length})</div>
  ${activeRequests.length === 0 ? '<p style="color:#aaa;font-style:italic">No active resource requests.</p>' :
    `<table><thead><tr><th>Station</th><th>Type</th><th>Item</th><th>Qty</th><th>Priority</th><th>Status</th><th>Requested By</th></tr></thead>
    <tbody>${activeRequests.map(r => `<tr>
      <td>${r.station_name || '—'}</td><td>${r.type}</td><td>${r.item}</td>
      <td>${r.quantity ? r.quantity + (r.unit ? ' ' + r.unit : '') : '—'}</td>
      <td style="color:${reqPriorityColor[r.priority] || '#374151'};font-weight:bold">${r.priority}</td>
      <td>${r.status}</td><td>${r.requested_by || '—'}</td>
    </tr>`).join('')}</tbody></table>`}
</div>
<div class="section">
  <div class="section-title">6. Bib Tracker Snapshot (${sortedBibsList.length} participants)</div>
  ${sortedBibsList.length === 0 ? '<p style="color:#aaa;font-style:italic">No participants tracked.</p>' :
    `<table><thead><tr><th>Bib #</th><th>Name</th><th>Status</th><th>Last Seen At</th><th>Last Update</th></tr></thead>
    <tbody>${sortedBibsList.map(p => `<tr>
      <td><strong style="font-family:monospace">${p.bib_number}</strong></td><td>${p.runner_name}</td>
      <td style="color:${bibStatusColor[p.status] || '#111'};font-weight:bold">${p.status || 'Active'}</td>
      <td>${p.current_location_name || '—'}</td>
      <td>${fmtTz(p.last_update_date, tz)}</td>
    </tr>`).join('')}</tbody></table>`}
</div>
<div class="footer">SWCRS Event Communications Suite — ICS 201 Operational Briefing · Generated ${nowTz(tz)}</div>
</body></html>`;
}

// ── ICS 204 ───────────────────────────────────────────────────────────────────
function buildICS204Html({ event, assignments, operators }) {
  const incidentName = event?.incident_name || event?.name || 'Unknown';
  const date = event?.date || new Date().toISOString().split('T')[0];
  const tz = event?.timezone || 'UTC';
  const sortedAssignments = [...assignments].sort((a, b) => a.operator_callsign.localeCompare(b.operator_callsign));

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ICS 204 — ${incidentName}</title>
<style>${CSS}</style></head><body>
<h2>ICS 204 — Assignment List</h2>
<div class="subtitle">SWCRS Event Communications Suite · ${event?.name || ''}</div>
<div class="section">
  <div class="meta-grid">
    <div class="field"><div class="label">Incident Name</div><div class="value">${incidentName}</div></div>
    <div class="field"><div class="label">Date</div><div class="value">${date}</div></div>
    <div class="field"><div class="label">Net Control</div><div class="value">${event?.net_control_callsign || ''}</div></div>
  </div>
</div>
<div class="section">
  <table>
    <thead><tr><th>Callsign</th><th>Full Name</th><th>License</th><th>Station</th><th>Role</th><th>Status</th><th>Start</th><th>End</th><th>Notes</th></tr></thead>
    <tbody>${sortedAssignments.map(a => {
      const op = operators.find(o => o.callsign === a.operator_callsign);
      return `<tr>
        <td><strong>${a.operator_callsign}</strong></td><td>${op?.full_name || ''}</td>
        <td>${op?.license_class || ''}</td><td>${a.station_name}</td><td>${a.role}</td><td>${a.status}</td>
        <td>${fmtTz(a.start_time, tz)}</td>
        <td>${fmtTz(a.end_time, tz)}</td>
        <td>${a.notes || ''}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>
</div>
<div class="footer">SWCRS Event Communications Suite — ICS 204 · Generated ${nowTz(tz)}</div>
</body></html>`;
}

// ── ICS 205A ──────────────────────────────────────────────────────────────────
function buildICS205AHtml({ event, frequencies, operators, stations = [] }) {
  const incidentName = event?.incident_name || event?.name || 'Unknown';
  const date = event?.date || new Date().toISOString().split('T')[0];
  const tz = event?.timezone || 'UTC';
  const sortedFreqs = sortByOrder(frequencies);
  const sortedOps = [...operators].sort((a, b) => a.callsign.localeCompare(b.callsign));
  const sortedStations = sortByOrder(stations);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ICS 205A — ${incidentName}</title>
<style>${CSS}</style></head><body>
<h2>ICS 205A — Communications List</h2>
<div class="subtitle">SWCRS Event Communications Suite · ${event?.name || ''}</div>
<div class="section">
  <div class="meta-grid">
    <div class="field"><div class="label">Incident Name</div><div class="value">${incidentName}</div></div>
    <div class="field"><div class="label">Date Prepared</div><div class="value">${date}</div></div>
    <div class="field"><div class="label">Net Control (NCS)</div><div class="value">${event?.net_control_callsign || ''}</div></div>
  </div>
</div>
<div class="section">
  <div class="section-title">Section 1 — Frequency Plan</div>
  <table>
    <thead><tr><th>#</th><th>Function/Channel</th><th>Freq (MHz)</th><th>Tone</th><th>Offset</th><th>Mode</th><th>Use</th><th>Remarks</th></tr></thead>
    <tbody>${sortedFreqs.map((f, i) => `<tr>
      <td>${i + 1}</td><td>${f.name}</td>
      <td style="font-family:monospace">${Number(f.frequency_mhz).toFixed(4)}</td>
      <td>${f.tone || ''}</td><td>${f.repeater_offset || 'Simplex'}</td>
      <td>${f.mode}</td><td>${f.use}</td><td>${f.remarks || f.notes || ''}</td>
    </tr>`).join('')}</tbody>
  </table>
</div>
<div class="section">
  <div class="section-title">Section 2 — Station Channel Assignments</div>
  <table>
    <thead><tr><th>ID</th><th>Station Name</th><th>Primary Channel</th><th>Secondary Channel</th></tr></thead>
    <tbody>${sortedStations.length ? sortedStations.map(s => `<tr>
      <td style="font-family:monospace;font-weight:bold">${s.station_id}</td>
      <td>${s.name}</td>
      <td>${getFreqName(s.primary_frequency_id, frequencies)}</td>
      <td>${getFreqName(s.backup_frequency_id, frequencies)}</td>
    </tr>`).join('') : '<tr><td colspan="4" style="color:#aaa;font-style:italic">No stations configured.</td></tr>'}</tbody>
  </table>
</div>
<div class="section">
  <div class="section-title">Section 3 — Operator Roster / Personnel Contact List</div>
  <table>
    <thead><tr><th>#</th><th>Callsign</th><th>Full Name</th><th>License Class</th><th>Phone</th><th>Email</th><th>Certifications</th></tr></thead>
    <tbody>${sortedOps.map((o, i) => `<tr>
      <td>${i + 1}</td><td><strong style="font-family:monospace">${o.callsign}</strong></td><td>${o.full_name}</td>
      <td>${o.license_class || ''}</td><td>${o.phone || '—'}</td><td>${o.email || '—'}</td>
      <td style="font-size:8.5pt">${(o.certifications || []).join(', ') || '—'}</td>
    </tr>`).join('')}</tbody>
  </table>
</div>
<div class="section">
  <div class="section-title">Section 4 — Communications Operations (ConOps)</div>
  <div style="border:1px solid #ccc;min-height:50px;padding:8px 12px;border-radius:3px;font-size:10pt;line-height:1.6;">
    ${event?.conops_comms || '<em style="color:#aaa">No communications ConOps recorded.</em>'}
  </div>
</div>
<div class="footer">SWCRS Event Communications Suite — ICS 205A · Generated ${nowTz(tz)}</div>
</body></html>`;
}

// ── ICS 213 ───────────────────────────────────────────────────────────────────
function buildICS213Html({ event, messages }) {
  const incidentName = event?.incident_name || event?.name || 'Unknown';
  const tz = event?.timezone || 'UTC';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ICS 213 — ${incidentName}</title>
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
    <span><span class="label">FROM</span>${m.from_callsign}${m.from_station ? ' / ' + m.from_station : ''}</span>
    <span><span class="label">TO</span>${m.to_station}</span>
    <span><span class="label">PRIORITY</span>${m.priority}</span>
    <span><span class="label">DATE/TIME</span>${fmtTz(m.created_date, tz)}</span>
  </div>
  <div class="message-body">${m.content}</div>
  <div class="message-footer">
    <span>Type: ${m.message_type}</span>
    <span>${m.acknowledged ? '✓ Acknowledged by: ' + (m.acknowledged_by || '—') : 'Not acknowledged'}</span>
  </div>
</div>`).join('')}
<div style="margin-top:20px;font-size:9pt;color:#999;text-align:right;border-top:1px solid #ddd;padding-top:8px;">SWCRS Event Comms Suite — ICS 213 · Generated ${nowTz(tz)}</div>
</body></html>`;
}

// ── ICS 309 ───────────────────────────────────────────────────────────────────
function buildICS309Html({ event, messages }) {
  const incidentName = event?.incident_name || event?.name || 'Unknown';
  const date = event?.date || new Date().toISOString().split('T')[0];
  const tz = event?.timezone || 'UTC';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ICS 309 — ${incidentName}</title>
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
  <span><strong>Net Control:</strong> ${event?.net_control_callsign || ''}</span>
</div>
<table>
  <thead><tr><th>Time</th><th>From</th><th>From Station</th><th>To</th><th>Priority</th><th>Type</th><th>ACK</th><th>Message</th></tr></thead>
  <tbody>
    ${[...messages].sort((a,b) => new Date(a.created_date) - new Date(b.created_date)).map(m => `<tr>
      <td style="white-space:nowrap">${fmtTimeTz(m.created_date, tz)}</td>
      <td><strong>${m.from_callsign}</strong></td>
      <td>${m.from_station || ''}</td>
      <td>${m.to_station}</td>
      <td>${m.priority}</td>
      <td>${m.message_type}</td>
      <td>${m.acknowledged ? '✓' : ''}</td>
      <td>${m.content}</td>
    </tr>`).join('')}
  </tbody>
</table>
<div class="footer">Total messages: ${messages.length} · Generated by SWCRS Event Comms Suite — ICS 309 · ${nowTz(tz)}</div>
</body></html>`;
}

// ── ICS 213RR — Resource Requests ─────────────────────────────────────────────
function buildResourceRequestsHtml({ event, resourceRequests }) {
  const incidentName = event?.incident_name || event?.name || 'Unknown';
  const tz = event?.timezone || 'UTC';
  const open = [...resourceRequests]
    .filter(r => !['Fulfilled', 'Cancelled'].includes(r.status))
    .sort((a, b) => (a.station_name || '').localeCompare(b.station_name || ''));
  const priorityBorder = { Emergency: '#dc2626', Urgent: '#d97706', Routine: '#374151' };

  const cards = open.length ? open.map((r, i) => `
  <div class="card" style="border-left: 5px solid ${priorityBorder[r.priority] || '#374151'};">
    <div class="card-header">
      <div class="card-num">Request #${i + 1}</div>
      <div class="card-station">${r.station_name || 'Unknown Station'}</div>
      <div class="card-priority priority-${r.priority}">${r.priority}</div>
      <div class="card-status">${r.status}</div>
    </div>
    <div class="card-body">
      <div class="field-row">
        <div class="field"><span class="label">Incident Name</span><span class="value">${incidentName}</span></div>
        <div class="field"><span class="label">Date/Time Opened</span><span class="value">${fmtTz(r.created_date, tz)}</span></div>
        <div class="field"><span class="label">Requested By</span><span class="value">${r.requested_by || '—'}</span></div>
      </div>
      <div class="field-row">
        <div class="field wide"><span class="label">Resource Type</span><span class="value">${r.type}</span></div>
        <div class="field wide"><span class="label">Item / Description</span><span class="value">${r.item}</span></div>
        <div class="field narrow"><span class="label">Quantity</span><span class="value">${r.quantity ? r.quantity + (r.unit ? ' ' + r.unit : '') : '—'}</span></div>
      </div>
      <div class="field-row">
        <div class="field wide"><span class="label">Delivery Location</span><span class="value">${r.station_name || '—'}</span></div>
        <div class="field wide"><span class="label">Notes</span><span class="value">${r.notes || '—'}</span></div>
      </div>
    </div>
  </div>`).join('') : '<p style="color:#888;font-style:italic;text-align:center;padding:40px">No open resource requests.</p>';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ICS 213RR — ${incidentName}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; background: #fff; padding: 15mm; }
  .page-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #1e293b; padding-bottom: 8px; margin-bottom: 16px; }
  .form-id { font-size: 22pt; font-weight: bold; color: #1e293b; }
  .card { border: 1px solid #cbd5e1; border-radius: 6px; margin-bottom: 16px; page-break-inside: avoid; overflow: hidden; }
  .card-header { background: #1e293b; color: #fff; display: flex; align-items: center; gap: 12px; padding: 7px 12px; font-size: 9.5pt; }
  .card-num { font-weight: bold; min-width: 80px; }
  .card-station { flex: 1; font-weight: bold; font-size: 11pt; }
  .card-priority { padding: 2px 10px; border-radius: 999px; font-size: 8.5pt; font-weight: bold; }
  .priority-Emergency { background: #dc2626; color: #fff; }
  .priority-Urgent { background: #d97706; color: #fff; }
  .priority-Routine { background: #64748b; color: #fff; }
  .card-body { padding: 10px 12px; }
  .field-row { display: flex; gap: 12px; margin-bottom: 8px; }
  .field { display: flex; flex-direction: column; flex: 1; border: 1px solid #e2e8f0; border-radius: 3px; padding: 5px 8px; }
  .field.wide { flex: 2; }
  .field.narrow { flex: 0.5; }
  .label { font-size: 7.5pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 3px; }
  .value { font-size: 10pt; color: #1e293b; font-weight: 500; min-height: 18px; }
  .footer { text-align: center; font-size: 8pt; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 10px; margin-top: 20px; }
  @media print { body { padding: 10mm; } }
</style></head><body>
<div class="page-header">
  <div>
    <div class="form-id">ICS 213RR</div>
    <div style="font-size:13pt;font-weight:bold">Resource Request</div>
    <div style="font-size:9pt;color:#555">SWCRS Event Communications Suite</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:11pt;font-weight:bold">${incidentName}</div>
    <div style="font-size:9pt;color:#555">${event?.name || ''}${event?.date ? ' · ' + event.date : ''}</div>
    <div style="font-size:9pt;color:#888">Generated: ${nowTz(tz)}</div>
  </div>
</div>
${cards}
<div class="footer">ICS 213RR · Resource Request · SWCRS Event Comms Suite · ${nowTz(tz)}</div>
</body></html>`;
}

// ── Bib Tracker Report ────────────────────────────────────────────────────────
function buildBibReportHtml({ event, participants, bibUpdates }) {
  const incidentName = event?.incident_name || event?.name || 'Unknown';
  const date = event?.date || new Date().toISOString().split('T')[0];
  const tz = event?.timezone || 'UTC';
  const statusColor = { Active: '#16a34a', DNS: '#d97706', DNF: '#dc2626', Completed: '#0891b2', Withdrawn: '#6b7280' };
  const sortedBibsList = sortBibs(participants);

  const bibListRows = sortedBibsList.map(p => `<tr>
    <td><strong>${p.bib_number}</strong></td>
    <td>${p.runner_name}</td>
    <td style="color:${statusColor[p.status] || '#111'};font-weight:bold">${p.status || 'Active'}</td>
    <td>${p.current_location_name || '—'}</td>
    <td>${fmtTz(p.last_update_date, tz)}</td>
    <td>${p.notes || ''}</td>
  </tr>`).join('');

  const detailSections = sortedBibsList.map(p => {
    const updates = [...bibUpdates.filter(u => u.participant_id === p.id)]
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const updateRows = updates.length
      ? updates.map(u => `<tr>
          <td style="white-space:nowrap">${fmtTz(u.timestamp, tz)}</td>
          <td style="font-weight:bold">${u.update_type}</td>
          <td>${u.aide_station_name || '—'}</td>
          <td>${u.comment || ''}</td>
          <td>${u.recorded_by || ''}</td>
        </tr>`).join('')
      : `<tr><td colspan="5" style="color:#aaa;font-style:italic">No updates recorded</td></tr>`;
    return `<div style="margin-bottom:20px;page-break-inside:avoid">
      <div style="display:flex;align-items:center;gap:12px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:8px 12px;margin-bottom:6px;">
        <span style="font-family:monospace;font-size:14pt;font-weight:bold;color:#0891b2;min-width:56px">#${p.bib_number}</span>
        <span style="font-size:12pt;font-weight:bold;flex:1">${p.runner_name}</span>
        <span style="font-size:10pt;font-weight:bold;color:${statusColor[p.status] || '#111'}">${p.status || 'Active'}</span>
        ${p.notes ? `<span style="font-size:9pt;color:#d97706;font-style:italic">${p.notes}</span>` : ''}
      </div>
      <table><thead><tr><th>Timestamp</th><th>Update</th><th>Station</th><th>Comment</th><th>Recorded By</th></tr></thead>
      <tbody>${updateRows}</tbody></table>
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bib Report — ${incidentName}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11pt; margin: 20mm; color: #000; }
  h2 { text-align: center; margin: 0 0 4px; font-size: 16pt; color: #0891b2; }
  .subtitle { text-align: center; font-size: 10pt; color: #444; margin-bottom: 6px; }
  .meta { text-align: center; font-size: 10pt; color: #666; margin-bottom: 20px; }
  .section-title { font-weight: bold; font-size: 13pt; border-bottom: 2px solid #0891b2; padding-bottom: 4px; margin: 24px 0 12px; color: #0891b2; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-bottom: 16px; }
  th { background: #1e293b; color: #fff; padding: 6px 8px; text-align: left; border: 1px solid #333; font-size: 9pt; text-transform: uppercase; }
  td { padding: 5px 8px; border: 1px solid #ddd; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  .stats { display: flex; gap: 16px; justify-content: center; margin-bottom: 20px; flex-wrap: wrap; }
  .stat { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 8px 16px; text-align: center; }
  .stat .n { font-size: 20pt; font-weight: bold; color: #0891b2; }
  .stat .l { font-size: 9pt; color: #555; }
  .footer { margin-top: 20px; font-size: 9pt; color: #999; text-align: right; border-top: 1px solid #ddd; padding-top: 8px; }
  @media print { body { margin: 10mm; } }
</style></head><body>
<h2>Bib Tracker Report</h2>
<div class="subtitle">SWCRS Event Communications Suite</div>
<div class="meta">${incidentName} · ${event?.name || ''} · ${date}</div>
<div class="stats">
  <div class="stat"><div class="n">${participants.length}</div><div class="l">Total</div></div>
  <div class="stat"><div class="n" style="color:#16a34a">${participants.filter(p => p.status === 'Active').length}</div><div class="l">Active</div></div>
  <div class="stat"><div class="n" style="color:#0891b2">${participants.filter(p => p.status === 'Completed').length}</div><div class="l">Finished</div></div>
  <div class="stat"><div class="n" style="color:#dc2626">${participants.filter(p => p.status === 'DNF').length}</div><div class="l">DNF</div></div>
  <div class="stat"><div class="n" style="color:#d97706">${participants.filter(p => p.status === 'DNS').length}</div><div class="l">DNS</div></div>
</div>
<div class="section-title">Section 1 — Participant List (${participants.length} bibs)</div>
<table>
  <thead><tr><th>Bib #</th><th>Name</th><th>Status</th><th>Last Location</th><th>Last Update</th><th>Notes</th></tr></thead>
  <tbody>${bibListRows || `<tr><td colspan="6" style="color:#aaa;font-style:italic">No participants</td></tr>`}</tbody>
</table>
<div class="section-title">Section 2 — Activity Log by Bib Number</div>
${detailSections || '<p style="color:#aaa;font-style:italic">No participants.</p>'}
<div class="footer">Generated by SWCRS Event Comms Suite · ${nowTz(tz)} · ${bibUpdates.length} total update entries</div>
</body></html>`;
}

// ── Offline Snapshot ──────────────────────────────────────────────────────────
function buildOfflineSnapshotHtml({ event, messages, stations, assignments, frequencies, operators }) {
  const tz = event?.timezone || 'UTC';
  const snapshotTime = nowTz(tz);
  const incidentName = event?.incident_name || event?.name || 'Unknown';

  const getFreqDisplayName = (val) => {
    if (!val) return '—';
    const freq = frequencies.find(f => f.id === val);
    return freq ? freq.name : '—';
  };

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline Snapshot — ${incidentName}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111; background: #fff; padding: 16px; max-width: 900px; margin: 0 auto; }
  .banner { background: #1e293b; color: #fff; border-radius: 10px; padding: 16px 20px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
  .banner h1 { font-size: 18px; font-weight: bold; color: #22d3ee; }
  .banner .meta { font-size: 11px; color: #94a3b8; }
  .offline-badge { background: #f59e0b; color: #000; font-size: 10px; font-weight: bold; padding: 3px 8px; border-radius: 999px; }
  .section { margin-bottom: 24px; }
  .section-title { font-size: 13px; font-weight: bold; color: #0891b2; border-bottom: 2px solid #0891b2; padding-bottom: 4px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #1e293b; color: white; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; }
  td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  .footer { text-align: center; font-size: 10px; color: #94a3b8; border-top: 1px solid #e5e7eb; padding-top: 12px; margin-top: 24px; }
  @media print { body { padding: 0; } }
</style></head><body>
<div class="banner">
  <div>
    <div class="meta">SWCRS Event Comms System</div>
    <h1>${incidentName}</h1>
    <div class="meta">${event?.name || ''}${event?.date ? ' · ' + event.date : ''}${event?.location ? ' · ' + event.location : ''}</div>
    ${event?.net_control_callsign ? `<div class="meta">Net Control: ${event.net_control_callsign}</div>` : ''}
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
    <thead><tr><th>#</th><th>Name</th><th>Freq (MHz)</th><th>Tone</th><th>Offset</th><th>Mode</th><th>Use</th><th>Remarks</th></tr></thead>
    <tbody>${frequencies.length ? sortByOrder(frequencies).map((f, i) => `<tr>
      <td>${i + 1}</td><td>${f.name}</td>
      <td style="font-family:monospace;font-weight:bold;color:#0891b2">${Number(f.frequency_mhz).toFixed(4)}</td>
      <td>${f.tone || '—'}</td><td>${f.repeater_offset || 'Simplex'}</td>
      <td>${f.mode}</td><td>${f.use}</td><td>${f.remarks || f.notes || ''}</td>
    </tr>`).join('') : `<tr><td colspan="8" style="color:#aaa;font-style:italic">No frequencies</td></tr>`}
    </tbody>
  </table>
</div>
<div class="section">
  <div class="section-title">🗺️ Stations</div>
  <table>
    <thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Status</th><th>Primary Freq</th><th>Backup Freq</th><th>Address</th><th>Notes</th></tr></thead>
    <tbody>${stations.length ? sortByOrder(stations).map(s => `<tr>
      <td><strong>${s.station_id}</strong></td><td>${s.name}</td><td>${s.type}</td>
      <td style="color:${s.status === 'Active' ? '#16a34a' : s.status === 'Standby' ? '#d97706' : '#6b7280'};font-weight:bold">${s.status}</td>
      <td style="font-family:monospace">${getFreqDisplayName(s.primary_frequency_id)}</td>
      <td style="font-family:monospace">${getFreqDisplayName(s.backup_frequency_id)}</td>
      <td>${s.address || '—'}</td><td>${s.notes || ''}</td>
    </tr>`).join('') : `<tr><td colspan="8" style="color:#aaa;font-style:italic">No stations</td></tr>`}
    </tbody>
  </table>
</div>
<div class="section">
  <div class="section-title">👥 Operators</div>
  <table>
    <thead><tr><th>Callsign</th><th>Name</th><th>License</th><th>Phone</th><th>Email</th><th>Status</th><th>Certifications</th></tr></thead>
    <tbody>${operators.length ? [...operators].sort((a,b) => a.callsign.localeCompare(b.callsign)).map(o => `<tr>
      <td><strong>${o.callsign}</strong></td><td>${o.full_name}</td>
      <td>${o.license_class || ''}</td><td>${o.phone || '—'}</td><td>${o.email || '—'}</td>
      <td>${o.status || ''}</td><td>${(o.certifications || []).join(', ') || '—'}</td>
    </tr>`).join('') : `<tr><td colspan="7" style="color:#aaa;font-style:italic">No operators</td></tr>`}
    </tbody>
  </table>
</div>
<div class="section">
  <div class="section-title">📋 Assignments</div>
  <table>
    <thead><tr><th>Callsign</th><th>Name</th><th>Station</th><th>Role</th><th>Status</th><th>Start</th><th>End</th></tr></thead>
    <tbody>${assignments.length ? assignments.map(a => {
      const op = operators.find(o => o.callsign === a.operator_callsign);
      return `<tr>
        <td><strong>${a.operator_callsign}</strong></td><td>${op?.full_name || ''}</td>
        <td>${a.station_name}</td><td>${a.role}</td><td>${a.status}</td>
        <td>${fmtTz(a.start_time, tz)}</td>
        <td>${fmtTz(a.end_time, tz)}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="7" style="color:#aaa;font-style:italic">No assignments</td></tr>`}
    </tbody>
  </table>
</div>
<div class="section">
  <div class="section-title">💬 Recent Messages (last 100)</div>
  <table>
    <thead><tr><th>Time</th><th>From</th><th>To</th><th>Priority</th><th>Type</th><th>ACK</th><th>Message</th></tr></thead>
    <tbody>${messages.length ? [...messages].sort((a,b) => new Date(b.created_date) - new Date(a.created_date)).slice(0,100).map(m => `<tr>
      <td style="white-space:nowrap">${fmtTimeTz(m.created_date, tz)}</td>
      <td><strong>${m.from_callsign}</strong>${m.from_station ? `<br><span style="color:#888;font-size:10px">${m.from_station}</span>` : ''}</td>
      <td>${m.to_station}</td>
      <td>${m.priority}</td>
      <td>${m.message_type}</td>
      <td>${m.acknowledged ? '✓' : ''}</td>
      <td>${m.content}</td>
    </tr>`).join('') : `<tr><td colspan="7" style="color:#aaa;font-style:italic">No messages</td></tr>`}
    </tbody>
  </table>
</div>
<div class="footer">
  SWCRS Event Comms System — Offline Snapshot<br>
  Captured ${snapshotTime} · This document is a point-in-time snapshot and may not reflect current live data.
</div>
</body></html>`;
}

// ── Full Event Report ─────────────────────────────────────────────────────────
function buildFullReportHtml({ event, messages, allLogs, stations, assignments, frequencies, operators, resourceRequests, participants, bibUpdates }) {
  const tz = event?.timezone || 'UTC';
  const priorityColors = { Emergency: '#ef4444', Priority: '#f59e0b', Welfare: '#3b82f6', Routine: '#6b7280' };
  const statusColors = { Active: '#22c55e', Standby: '#f59e0b', Closed: '#6b7280', Requested: '#3b82f6' };
  const typeLabels = { communication: 'Comms', task_completion: 'Task', note: 'Note', system_event: 'System' };
  const typeColors = { communication: '#22d3ee', task_completion: '#22c55e', note: '#a78bfa', system_event: '#94a3b8' };
  const reqPriorityColor = { Emergency: '#ef4444', Urgent: '#f59e0b', Routine: '#6b7280' };
  const reqStatusColor = { Pending: '#f59e0b', Approved: '#3b82f6', 'En Route': '#8b5cf6', Fulfilled: '#22c55e', Cancelled: '#6b7280' };
  const bibStatusColor = { Active: '#16a34a', DNS: '#d97706', DNF: '#dc2626', Completed: '#0891b2', Withdrawn: '#6b7280' };
  const sortedBibsList = sortBibs(participants);

  const msgRows = [...allLogs].sort((a,b) => new Date(a.created_date) - new Date(b.created_date)).map(m => `<tr>
    <td style="white-space:nowrap">${fmtTimeTz(m.created_date, tz)}</td>
    <td style="color:${typeColors[m.type]};font-weight:bold">${typeLabels[m.type] || m.type}</td>
    <td><strong>${m.from_callsign || ''}</strong>${m.from_station ? ' / ' + m.from_station : ''}</td>
    <td>${m.to_station || ''}</td>
    <td style="color:${priorityColors[m.priority] || '#6b7280'}">${m.priority || ''}</td>
    <td>${m.acknowledged ? '✓' : ''}</td>
    <td>${m.content}</td>
  </tr>`).join('');

  const stationRows = sortByOrder(stations).map(s => {
    const ops = assignments.filter(a => a.station_name === s.name).map(a => `${a.operator_callsign} (${a.role})`).join(', ');
    return `<tr>
      <td>${s.station_id}</td><td>${s.name}</td><td>${s.type}</td>
      <td style="color:${statusColors[s.status]}">${s.status}</td>
      <td>${getFreqName(s.primary_frequency_id, frequencies)}</td>
      <td>${getFreqName(s.backup_frequency_id, frequencies)}</td>
      <td>${ops || '—'}</td>
    </tr>`;
  }).join('');

  const freqRows = sortByOrder(frequencies).map((f, i) => `<tr>
    <td>${i + 1}</td><td>${f.name}</td>
    <td><strong>${Number(f.frequency_mhz).toFixed(4)}</strong></td>
    <td>${f.tone || ''}</td><td>${f.repeater_offset || 'Simplex'}</td>
    <td>${f.mode}</td><td>${f.use}</td><td>${f.remarks || f.notes || ''}</td>
  </tr>`).join('');

  const assignRows = assignments.map(a => {
    const op = operators.find(o => o.callsign === a.operator_callsign);
    return `<tr>
      <td><strong>${a.operator_callsign}</strong></td><td>${op?.full_name || ''}</td>
      <td>${a.station_name}</td><td>${a.role}</td><td>${a.status}</td>
      <td>${fmtTz(a.start_time, tz)}</td>
      <td>${fmtTz(a.end_time, tz)}</td>
    </tr>`;
  }).join('');

  const resourceRows = resourceRequests.map(r => {
    const opened = r.created_date ? new Date(r.created_date) : null;
    const closed = r.updated_date && ['Fulfilled','Cancelled'].includes(r.status) ? new Date(r.updated_date) : null;
    const durationMs = opened && closed ? closed - opened : null;
    const durationStr = durationMs !== null ? (() => { const m = Math.floor(durationMs/60000); return m < 60 ? `${m}m` : `${Math.floor(m/60)}h ${m%60}m`; })() : '—';
    return `<tr>
      <td style="white-space:nowrap">${opened ? fmtTz(r.created_date, tz) : '—'}</td>
      <td style="white-space:nowrap">${closed ? fmtTz(r.updated_date, tz) : '—'}</td>
      <td>${durationStr}</td><td>${r.station_name || '—'}</td><td>${r.type}</td><td>${r.item}</td>
      <td>${r.quantity ? r.quantity + (r.unit ? ' ' + r.unit : '') : '—'}</td>
      <td style="color:${reqPriorityColor[r.priority] || '#6b7280'};font-weight:bold">${r.priority}</td>
      <td style="color:${reqStatusColor[r.status] || '#6b7280'};font-weight:bold">${r.status}</td>
      <td>${r.requested_by || '—'}</td><td>${r.fulfilled_by || '—'}</td><td>${r.notes || ''}</td>
    </tr>`;
  }).join('');

  const bibListRows = sortedBibsList.map(p => `<tr>
    <td><strong>${p.bib_number}</strong></td><td>${p.runner_name}</td>
    <td style="color:${bibStatusColor[p.status] || '#111'};font-weight:bold">${p.status || 'Active'}</td>
    <td>${p.current_location_name || '—'}</td>
    <td>${fmtTz(p.last_update_date, tz)}</td>
    <td>${p.notes || ''}</td>
  </tr>`).join('');

  const bibDetailSections = sortedBibsList.map(p => {
    const updates = [...bibUpdates.filter(u => u.participant_id === p.id)].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
    const updateRows = updates.length
      ? updates.map(u => `<tr>
          <td style="white-space:nowrap">${fmtTz(u.timestamp, tz)}</td>
          <td style="font-weight:bold">${u.update_type}</td>
          <td>${u.aide_station_name || '—'}</td>
          <td>${u.comment || ''}</td>
          <td>${u.recorded_by || ''}</td>
        </tr>`).join('')
      : `<tr><td colspan="5" style="color:#aaa;font-style:italic">No updates recorded</td></tr>`;
    return `<div style="margin-bottom:16px;page-break-inside:avoid">
      <div style="display:flex;align-items:center;gap:10px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:7px 10px;margin-bottom:5px;">
        <span style="font-family:monospace;font-size:14px;font-weight:bold;color:#0891b2;min-width:52px">#${p.bib_number}</span>
        <span style="font-size:11px;font-weight:bold;flex:1">${p.runner_name}</span>
        <span style="font-size:10px;font-weight:bold;color:${bibStatusColor[p.status] || '#111'}">${p.status || 'Active'}</span>
        ${p.notes ? `<span style="font-size:9px;color:#d97706;font-style:italic">${p.notes}</span>` : ''}
      </div>
      <table><thead><tr><th>Timestamp</th><th>Update</th><th>Station</th><th>Comment</th><th>Recorded By</th></tr></thead>
      <tbody>${updateRows}</tbody></table>
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html><head><title>Event Report — ${event?.name || ''}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; background: #fff; padding: 20px; }
  .cover { text-align: center; padding: 60px 0 40px; border-bottom: 3px solid #0891b2; margin-bottom: 30px; }
  .cover h1 { font-size: 28px; color: #0891b2; font-weight: bold; }
  .cover h2 { font-size: 18px; color: #333; margin-top: 8px; }
  .cover p { color: #555; margin-top: 6px; font-size: 13px; }
  .section { margin-bottom: 30px; }
  .section-title { font-size: 14px; font-weight: bold; color: #0891b2; border-bottom: 2px solid #0891b2; padding-bottom: 5px; margin-bottom: 12px; }
  .stats-row { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
  .stat-box { flex: 1; min-width: 80px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 12px; text-align: center; }
  .stat-box .num { font-size: 24px; font-weight: bold; color: #0891b2; }
  .stat-box .lbl { font-size: 10px; color: #555; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th { background: #1e293b; color: white; text-align: left; padding: 6px 8px; font-size: 9px; text-transform: uppercase; }
  td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  tr:nth-child(even) td { background: #f9fafb; }
  .footer { text-align: center; font-size: 9px; color: #999; border-top: 1px solid #e5e7eb; padding-top: 12px; margin-top: 30px; }
  @media print { body { padding: 10px; } }
</style></head><body>
<div class="cover">
  <h1>📻 SWCRS ECS EVENT REPORT</h1>
  <h2>${event?.incident_name || event?.name || ''}</h2>
  <p>${event?.name || ''}${event?.date ? ' · ' + event.date : ''}${event?.location ? ' · ' + event.location : ''}</p>
  ${event?.net_control_callsign ? `<p>Net Control: ${event.net_control_callsign}</p>` : ''}
  <p style="margin-top:16px;color:#aaa;font-size:11px;">Report generated: ${nowTz(tz)}</p>
</div>
<div class="stats-row">
  <div class="stat-box"><div class="num">${allLogs.length}</div><div class="lbl">Total Log Entries</div></div>
  <div class="stat-box"><div class="num">${messages.length}</div><div class="lbl">Comms</div></div>
  <div class="stat-box"><div class="num">${allLogs.filter(m => m.type === 'task_completion').length}</div><div class="lbl">Tasks Completed</div></div>
  <div class="stat-box"><div class="num">${stations.length}</div><div class="lbl">Stations</div></div>
  <div class="stat-box"><div class="num">${messages.filter(m => m.priority === 'Emergency').length}</div><div class="lbl">Emergency Msgs</div></div>
  <div class="stat-box"><div class="num">${messages.filter(m => m.acknowledged).length}</div><div class="lbl">ACK'd</div></div>
  <div class="stat-box"><div class="num">${participants.length}</div><div class="lbl">Bibs Tracked</div></div>
</div>
<div class="section"><div class="section-title">📡 ICS-205A — Frequency List</div>
  <table><thead><tr><th>#</th><th>Name</th><th>Freq (MHz)</th><th>Tone</th><th>Offset</th><th>Mode</th><th>Use</th><th>Remarks</th></tr></thead>
  <tbody>${freqRows || "<tr><td colspan='8'>No frequencies</td></tr>"}</tbody></table>
</div>
<div class="section"><div class="section-title">🗺️ Aide Stations</div>
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
  <table><thead><tr><th>Opened</th><th>Closed</th><th>Duration</th><th>Station</th><th>Type</th><th>Item</th><th>Qty</th><th>Priority</th><th>Status</th><th>Req By</th><th>Fulfilled By</th><th>Notes</th></tr></thead>
  <tbody>${resourceRows || "<tr><td colspan='12' style='color:#aaa;font-style:italic'>No resource requests</td></tr>"}</tbody></table>
</div>
<div class="section"><div class="section-title">🏃 Bib Tracker — Participant List (${participants.length} bibs)</div>
  <table><thead><tr><th>Bib #</th><th>Name</th><th>Status</th><th>Last Location</th><th>Last Update</th><th>Notes</th></tr></thead>
  <tbody>${bibListRows || "<tr><td colspan='6' style='color:#aaa;font-style:italic'>No participants</td></tr>"}</tbody></table>
</div>
<div class="section"><div class="section-title">🏃 Bib Tracker — Activity Log</div>
  ${bibDetailSections || "<p style='color:#aaa;font-style:italic'>No participants.</p>"}
</div>
<div class="footer">SWCRS Event Communications Suite · Generated ${nowTz(tz)} · ${event?.name || ''}</div>
</body></html>`;
}


module.exports = {
  buildICS201Html, buildICS204Html, buildICS205AHtml, buildICS213Html, buildICS309Html,
  buildResourceRequestsHtml, buildBibReportHtml, buildOfflineSnapshotHtml, buildFullReportHtml,
};
