// Shared ICS HTML template generators
// Used by both EventReport (print) and sendICSEmail (email)

import { getTzAbbr, parseAsUTC } from "@/lib/eventTime";

function nowStr(timezone) {
  const tz = timezone || "America/Phoenix";
  return new Date().toLocaleString("en-US", { timeZone: tz }) + " " + getTzAbbr(tz);
}

export const CSS = `
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
  .issued-by { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; font-size: 10pt; }
  @media print { body { margin: 10mm; padding: 0; } }
`;

function sortByOrder(arr) {
  return [...arr].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

function getFreqName(id, frequencies) {
  if (!id) return '—';
  const freq = frequencies.find(f => f.id === id);
  return freq ? freq.name : '—';
}

// ── ICS 201 ──────────────────────────────────────────────────────────────────
export function buildICS201Html({ event, stations, assignments, operators, frequencies, resourceRequests = [], participants = [], issuedBy = '' }) {
  const incidentName = event?.incident_name || event?.name || 'Unknown';
  const date = event?.date || new Date().toISOString().split('T')[0];
  const sortedStations = sortByOrder(stations);
  const sortedAssignments = [...assignments].sort((a, b) => a.operator_callsign.localeCompare(b.operator_callsign));
  const activeRequests = resourceRequests.filter(r => ['Pending', 'Approved', 'En Route'].includes(r.status));
  const sortedBibs = [...participants].sort((a, b) => {
    const an = parseInt(a.bib_number) || 0, bn = parseInt(b.bib_number) || 0;
    return an !== bn ? an - bn : a.bib_number.localeCompare(b.bib_number);
  });
  const bibStatusColor = { Active: '#16a34a', DNS: '#d97706', DNF: '#dc2626', Completed: '#0891b2', Withdrawn: '#6b7280' };
  const reqPriorityColor = { Emergency: '#dc2626', Urgent: '#d97706', Routine: '#374151' };

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ICS 201 — ${incidentName}</title>
<style>${CSS}</style></head><body>
<h2>ICS 201 — Operational Briefing</h2>
<div class="subtitle">SWCRS Event Communications Suite · ${event?.name || ''}</div>
${issuedBy}
<div class="section">
  <div class="section-title">1. Incident Information</div>
  <div class="meta-grid">
    <div class="field"><div class="label">Incident Name</div><div class="value">${incidentName}</div></div>
    <div class="field"><div class="label">Event Name</div><div class="value">${event?.name || ''}</div></div>
    <div class="field"><div class="label">Date / Time Issued</div><div class="value">${nowStr(event?.timezone)}</div></div>
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
  <div class="section-title">6. Bib Tracker Snapshot (${sortedBibs.length} participants)</div>
  ${sortedBibs.length === 0 ? '<p style="color:#aaa;font-style:italic">No participants tracked.</p>' :
    `<table><thead><tr><th>Bib #</th><th>Name</th><th>Status</th><th>Last Seen At</th><th>Last Update</th></tr></thead>
    <tbody>${sortedBibs.map(p => `<tr>
      <td><strong style="font-family:monospace">${p.bib_number}</strong></td><td>${p.runner_name}</td>
      <td style="color:${bibStatusColor[p.status] || '#111'};font-weight:bold">${p.status || 'Active'}</td>
      <td>${p.current_location_name || '—'}</td>
      <td>${p.last_update_date ? parseAsUTC(p.last_update_date).toLocaleString("en-US", { timeZone: event?.timezone || "America/Phoenix" }) + " " + getTzAbbr(event?.timezone) : '—'}</td>
    </tr>`).join('')}</tbody></table>`}
</div>
<div class="footer">SWCRS Event Communications Suite — ICS 201 Operational Briefing · Generated ${nowStr(event?.timezone)}</div>
</body></html>`;
}

// ── ICS 204 ──────────────────────────────────────────────────────────────────
export function buildICS204Html({ event, assignments, operators, issuedBy = '' }) {
  const incidentName = event?.incident_name || event?.name || 'Unknown';
  const date = event?.date || new Date().toISOString().split('T')[0];
  const sortedAssignments = [...assignments].sort((a, b) => a.operator_callsign.localeCompare(b.operator_callsign));

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ICS 204 — ${incidentName}</title>
<style>${CSS}</style></head><body>
<h2>ICS 204 — Assignment List</h2>
<div class="subtitle">SWCRS Event Communications Suite · ${event?.name || ''}</div>
${issuedBy}
<div class="section">
  <div class="meta-grid">
    <div class="field"><div class="label">Incident Name</div><div class="value">${incidentName}</div></div>
    <div class="field"><div class="label">Date / Time Issued</div><div class="value">${nowStr(event?.timezone)}</div></div>
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
        <td>${a.start_time ? parseAsUTC(a.start_time).toLocaleString("en-US", { timeZone: event?.timezone || "America/Phoenix" }) + " " + getTzAbbr(event?.timezone) : ''}</td>
        <td>${a.end_time ? parseAsUTC(a.end_time).toLocaleString("en-US", { timeZone: event?.timezone || "America/Phoenix" }) + " " + getTzAbbr(event?.timezone) : ''}</td>
        <td>${a.notes || ''}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>
</div>
<div class="footer">SWCRS Event Communications Suite — ICS 204 · Generated ${nowStr(event?.timezone)}</div>
</body></html>`;
}

// ── ICS 205A ─────────────────────────────────────────────────────────────────
export function buildICS205AHtml({ event, frequencies, operators, stations = [], issuedBy = '' }) {
  const incidentName = event?.incident_name || event?.name || 'Unknown';
  const date = event?.date || new Date().toISOString().split('T')[0];
  const sortedFreqs = sortByOrder(frequencies);
  const sortedOps = [...operators].sort((a, b) => a.callsign.localeCompare(b.callsign));
  const sortedStations = sortByOrder(stations);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ICS 205A — ${incidentName}</title>
<style>${CSS}</style></head><body>
<h2>ICS 205A — Communications List</h2>
<div class="subtitle">SWCRS Event Communications Suite · ${event?.name || ''}</div>
${issuedBy}
<div class="section">
  <div class="meta-grid">
    <div class="field"><div class="label">Incident Name</div><div class="value">${incidentName}</div></div>
    <div class="field"><div class="label">Date / Time Issued</div><div class="value">${nowStr(event?.timezone)}</div></div>
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
<div class="footer">SWCRS Event Communications Suite — ICS 205A · Generated ${nowStr(event?.timezone)}</div>
</body></html>`;
}