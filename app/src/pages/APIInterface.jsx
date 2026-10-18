import { useState, useRef } from "react";
import { useEvent } from "@/components/EventContext";
import { callFunction } from "@/api/ecs";
import { Copy, Check, Terminal, BookOpen, ExternalLink, Download, Upload, FileJson, ChevronDown, ChevronRight } from "lucide-react";

const FUNCTION_BASE = `${window.location.origin}/api/functions/generatePrintableReport`;

const REPORTS = [
  { id: "1", label: "ICS 201 — Incident Briefing", desc: "Situational overview: stations, assignments, resource requests, and participants." },
  { id: "2", label: "ICS 204 — Assignment List", desc: "All operator-to-station assignments with roles and timing." },
  { id: "3", label: "ICS 205A — Communications List", desc: "Full frequency plan with tones, modes, and ConOps." },
  { id: "4", label: "ICS 213 — General Message Log", desc: "Chronological communications log with priority tiers." },
  { id: "5", label: "ICS 309 — Communications Log", desc: "Formatted net traffic log for ICS recordkeeping." },
  { id: "6", label: "Resource Requests (ICS 213RR)", desc: "All open and closed resource requests for the event." },
  { id: "7", label: "Bib Tracker Report", desc: "Participant list with status updates and station sightings." },
  { id: "8", label: "Offline Snapshot", desc: "Full self-contained HTML snapshot — stations, operators, frequencies, and recent messages." },
  { id: "9", label: "Full Event Report", desc: "Comprehensive summary of the entire event including all data entities." },
];

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="flex-shrink-0 p-1.5 rounded-md text-gray-500 hover:text-cyan-400 hover:bg-gray-700 transition-all"
      title="Copy URL"
    >
      {copied ? <Check className="w-4 h-4 text-cyan-400" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

function UrlBlock({ url }) {
  return (
    <div className="flex items-center gap-2 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 mt-2">
      <code className="flex-1 text-xs text-cyan-300 font-mono break-all">{url}</code>
      <CopyButton text={url} />
      <a href={url} target="_blank" rel="noopener noreferrer"
        className="flex-shrink-0 p-1.5 rounded-md text-gray-500 hover:text-cyan-400 hover:bg-gray-700 transition-all"
        title="Open in new tab">
        <ExternalLink className="w-4 h-4" />
      </a>
    </div>
  );
}

const SCHEMA_DOCS = [
  {
    key: "_meta",
    label: "_meta",
    desc: "Export metadata. Read-only — not imported.",
    fields: [
      { name: "exported_at", type: "string (ISO 8601)", desc: "Timestamp of export" },
      { name: "exported_by", type: "string", desc: "Email of the exporting user" },
      { name: "ecs_version", type: "string", desc: "ECS schema version, e.g. \"1.0\"" },
      { name: "event_id", type: "string", desc: "Source event ID" },
      { name: "event_name", type: "string", desc: "Human-readable event name" },
    ],
  },
  {
    key: "event",
    label: "event",
    desc: "Top-level event record (not re-imported; used for reference).",
    fields: [
      { name: "name", type: "string *", desc: "Event name" },
      { name: "incident_name", type: "string", desc: "ICS Incident Name" },
      { name: "date", type: "date", desc: "Event date (YYYY-MM-DD)" },
      { name: "start_datetime", type: "date-time", desc: "Event start" },
      { name: "end_datetime", type: "date-time", desc: "Event end" },
      { name: "location", type: "string", desc: "Physical location" },
      { name: "net_control_callsign", type: "string", desc: "NCS callsign" },
      { name: "status", type: "enum", desc: "Planning | Active | Completed | Archived" },
      { name: "pin", type: "string", desc: "Access PIN (omit to leave unprotected)" },
      { name: "notes", type: "string", desc: "Free-text notes" },
    ],
  },
  {
    key: "stations",
    label: "stations [ ]",
    desc: "AideStation records — array of objects.",
    fields: [
      { name: "event_id", type: "string", desc: "Auto-overwritten to target event on import" },
      { name: "name", type: "string *", desc: "Station display name" },
      { name: "station_id", type: "string *", desc: "Short ID e.g. AS-1" },
      { name: "type", type: "enum", desc: "Aide Station | Net Control | Command Post | Staging | Water Point | Start Line | Finish Line | Other" },
      { name: "status", type: "enum", desc: "Active | Standby | Closed | Requested" },
      { name: "latitude / longitude", type: "number", desc: "GPS coordinates" },
      { name: "address", type: "string", desc: "Street address" },
      { name: "start_datetime / end_datetime", type: "date-time", desc: "Station activation window" },
      { name: "assets", type: "string[]", desc: "Equipment list" },
      { name: "notes", type: "string", desc: "Free-text notes" },
      { name: "sort_order", type: "number", desc: "Display order (default 0)" },
    ],
  },
  {
    key: "operators",
    label: "operators [ ]",
    desc: "Operator roster records.",
    fields: [
      { name: "event_id", type: "string", desc: "Auto-overwritten to target event on import" },
      { name: "callsign", type: "string *", desc: "Ham radio callsign" },
      { name: "full_name", type: "string *", desc: "Operator full name" },
      { name: "phone / email", type: "string", desc: "Contact info" },
      { name: "license_class", type: "enum", desc: "Technician | General | Amateur Extra | GMRS | Other" },
      { name: "certifications", type: "string[]", desc: "e.g. ICS-100, ARRL EC-001" },
      { name: "status", type: "enum", desc: "Available | Assigned | En Route | Off Duty | Standby" },
      { name: "last_heard", type: "date-time", desc: "Last contact timestamp" },
      { name: "notes", type: "string", desc: "Free-text notes" },
    ],
  },
  {
    key: "assignments",
    label: "assignments [ ]",
    desc: "Operator-to-station assignment records.",
    fields: [
      { name: "event_id", type: "string", desc: "Auto-overwritten to target event on import" },
      { name: "operator_callsign", type: "string *", desc: "Callsign of assigned operator" },
      { name: "station_name", type: "string *", desc: "Name of assigned station" },
      { name: "operator_id", type: "string", desc: "Reference to Operator (loose — may differ after import)" },
      { name: "station_id", type: "string", desc: "Reference to AideStation (loose — may differ after import)" },
      { name: "role", type: "enum", desc: "Net Control | Station Operator | Liaison | Floater | Backup" },
      { name: "start_time / end_time", type: "date-time", desc: "Assignment window" },
      { name: "status", type: "enum", desc: "Scheduled | Active | Completed | Cancelled" },
      { name: "notes", type: "string", desc: "Free-text notes" },
    ],
  },
  {
    key: "frequencies",
    label: "frequencies [ ]",
    desc: "Frequency plan records.",
    fields: [
      { name: "event_id", type: "string", desc: "Auto-overwritten to target event on import" },
      { name: "name", type: "string *", desc: "Frequency label e.g. Primary Net" },
      { name: "frequency_mhz", type: "number *", desc: "Frequency in MHz" },
      { name: "tone", type: "string", desc: "CTCSS/DCS tone" },
      { name: "mode", type: "enum", desc: "FM | AM | SSB | DMR | P25 | FRS | GMRS | Other" },
      { name: "use", type: "enum", desc: "Primary Net | Tactical | Emergency | Simplex | Repeater | Interop | Other" },
      { name: "repeater_offset", type: "string", desc: "e.g. -0.600" },
      { name: "remarks / notes", type: "string", desc: "Additional info" },
      { name: "sort_order", type: "number", desc: "Display order (default 0)" },
    ],
  },
  {
    key: "logs",
    label: "logs [ ]",
    desc: "EventLog communications and notes.",
    fields: [
      { name: "event_id", type: "string", desc: "Auto-overwritten to target event on import" },
      { name: "type", type: "enum *", desc: "communication | task_completion | note | system_event" },
      { name: "content", type: "string *", desc: "Log entry text" },
      { name: "from_callsign", type: "string", desc: "Originating callsign" },
      { name: "from_station", type: "string", desc: "Originating station name" },
      { name: "to_station", type: "string", desc: "Destination station or ALL NET" },
      { name: "priority", type: "enum", desc: "Routine | Welfare | Priority | Emergency" },
      { name: "message_type", type: "enum", desc: "Net Check-in | Situation Report | Resource Request | Medical | General | Alert" },
      { name: "acknowledged", type: "boolean", desc: "Acknowledgement status" },
      { name: "acknowledged_by", type: "string", desc: "Who acknowledged" },
      { name: "task_id / task_label", type: "string", desc: "For task_completion entries" },
    ],
  },
  {
    key: "resource_requests",
    label: "resource_requests [ ]",
    desc: "ResourceRequest records.",
    fields: [
      { name: "event_id", type: "string", desc: "Auto-overwritten to target event on import" },
      { name: "type", type: "enum *", desc: "SAG | Food | Water | Medical | Logistics | Personnel | Equipment | Information | Other" },
      { name: "item", type: "string *", desc: "What is being requested" },
      { name: "status", type: "enum *", desc: "Pending | Approved | En Route | Fulfilled | Cancelled" },
      { name: "priority", type: "enum *", desc: "Routine | Urgent | Emergency" },
      { name: "quantity", type: "number", desc: "Amount requested" },
      { name: "unit", type: "string", desc: "Unit of measure" },
      { name: "requested_by", type: "string", desc: "Operator callsign or name" },
      { name: "station_name", type: "string", desc: "Originating station" },
      { name: "fulfilled_by", type: "string", desc: "Who fulfilled it" },
      { name: "notes", type: "string", desc: "Additional context" },
    ],
  },
  {
    key: "participants",
    label: "participants [ ]",
    desc: "Participant / bib tracker records.",
    fields: [
      { name: "event_id", type: "string", desc: "Auto-overwritten to target event on import" },
      { name: "bib_number", type: "string *", desc: "Unique bib number" },
      { name: "runner_name", type: "string *", desc: "Full name" },
      { name: "status", type: "enum", desc: "Active | DNS | DNF | Completed | Withdrawn" },
      { name: "current_location_station_id", type: "string", desc: "Last seen station ID (loose ref)" },
      { name: "current_location_name", type: "string", desc: "Last seen station name" },
      { name: "last_update_date", type: "date-time", desc: "Timestamp of last update" },
      { name: "notes", type: "string", desc: "Free-text notes" },
    ],
  },
  {
    key: "participant_updates",
    label: "participant_updates [ ]",
    desc: "ParticipantStatusUpdate audit trail.",
    fields: [
      { name: "event_id", type: "string", desc: "Auto-overwritten to target event on import" },
      { name: "participant_id", type: "string *", desc: "Reference to Participant (loose — may differ after import)" },
      { name: "bib_number", type: "string *", desc: "Bib number at time of update" },
      { name: "update_type", type: "enum *", desc: "Seen | DNS | DNF | Completed | Comment | Withdrawn" },
      { name: "timestamp", type: "date-time *", desc: "When the update occurred" },
      { name: "aide_station_id", type: "string", desc: "Station ID (loose ref)" },
      { name: "aide_station_name", type: "string", desc: "Station name" },
      { name: "comment", type: "string", desc: "Additional comments" },
      { name: "recorded_by", type: "string", desc: "Who recorded this update" },
    ],
  },
  {
    key: "documents",
    label: "documents [ ]",
    desc: "EventDocument file references.",
    fields: [
      { name: "event_id", type: "string", desc: "Auto-overwritten to target event on import" },
      { name: "name", type: "string *", desc: "Document display name" },
      { name: "file_url", type: "string *", desc: "URL to the uploaded file" },
      { name: "file_type", type: "string", desc: "MIME type or extension" },
      { name: "size_bytes", type: "number", desc: "File size in bytes" },
      { name: "description", type: "string", desc: "Notes about the document" },
    ],
  },
];

function SchemaSection({ doc }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-900 hover:bg-gray-800 transition-all text-left"
      >
        <div className="flex items-center gap-3">
          <FileJson className="w-4 h-4 text-cyan-400 flex-shrink-0" />
          <span className="text-sm font-mono font-semibold text-white">{doc.label}</span>
          <span className="text-xs text-gray-500">{doc.desc}</span>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
      </button>
      {open && (
        <div className="bg-gray-950 border-t border-gray-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-4 py-2 text-gray-600 font-semibold w-48">Field</th>
                <th className="text-left px-4 py-2 text-gray-600 font-semibold w-36">Type</th>
                <th className="text-left px-4 py-2 text-gray-600 font-semibold">Description</th>
              </tr>
            </thead>
            <tbody>
              {doc.fields.map(f => (
                <tr key={f.name} className="border-b border-gray-800/50 hover:bg-gray-900/50">
                  <td className="px-4 py-2 font-mono text-amber-300 whitespace-nowrap">{f.name}</td>
                  <td className="px-4 py-2 text-cyan-400/80 whitespace-nowrap">{f.type}</td>
                  <td className="px-4 py-2 text-gray-400">{f.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function APIInterface() {
  const { activeEvent } = useEvent();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const fileInputRef = useRef(null);

  const eventId = activeEvent?.id || "<EVENT_ID>";

  const buildUrl = (reportId) =>
    `${FUNCTION_BASE}?eventId=${eventId}&reportType=${reportId}`;

  const handleExport = async () => {
    if (!activeEvent) return;
    setExporting(true);
    const res = await callFunction('exportEventData', { eventId: activeEvent.id });
    const json = JSON.stringify(res.data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ecs-export-${activeEvent.name.replace(/\s+/g, '_')}-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExporting(false);
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !activeEvent) return;
    setImporting(true);
    setImportResult(null);
    const text = await file.text();
    const data = JSON.parse(text);
    const res = await callFunction('importEventData', { eventId: activeEvent.id, data });
    setImportResult(res.data);
    setImporting(false);
    e.target.value = '';
  };

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-4xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center flex-shrink-0 mt-1">
            <Terminal className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">API Interface</h1>
            <p className="text-gray-500 text-sm mt-1">
              Use these pre-formatted URLs to pull live HTML reports directly from the ECS backend — no authentication required.
            </p>
          </div>
        </div>

        {/* Active event info */}
        {activeEvent && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3">
            <BookOpen className="w-4 h-4 text-cyan-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500">Active Event</p>
              <p className="text-sm font-semibold text-white truncate">{activeEvent.name}</p>
            </div>
            <div className="flex items-center gap-2 bg-gray-950 border border-gray-700 rounded-lg px-3 py-1.5">
              <code className="text-xs text-amber-300 font-mono">{activeEvent.id}</code>
              <CopyButton text={activeEvent.id} />
            </div>
          </div>
        )}

        {/* How it works */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white">How It Works</h2>
          <p className="text-xs text-gray-400 leading-relaxed">
            All report URLs are simple <span className="text-cyan-400 font-mono">HTTP GET</span> requests to the <span className="text-cyan-400 font-mono">generatePrintableReport</span> backend function.
            The function returns a fully rendered <span className="text-cyan-400 font-mono">text/html</span> document you can open directly in a browser, embed in an iframe, or print.
          </p>
          <div className="bg-gray-950 border border-gray-700 rounded-lg p-3">
            <code className="text-xs text-gray-300 font-mono block">
              GET {FUNCTION_BASE}<br />
              &nbsp;&nbsp;?eventId=<span className="text-amber-300">{"<EVENT_ID>"}</span><br />
              &nbsp;&nbsp;&amp;reportType=<span className="text-green-400">{"<REPORT_ID>"}</span>
            </code>
          </div>
          <p className="text-xs text-gray-500">
            Both parameters are required. The response is an HTML document — open it directly in a browser tab or use it in automation pipelines.
          </p>
        </div>

        {/* Report URLs */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-white px-1">Report URLs</h2>
          {REPORTS.map(report => (
            <div key={report.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-600 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 font-mono">
                  {report.id}
                </span>
                <h3 className="text-sm font-semibold text-white">{report.label}</h3>
              </div>
              <p className="text-xs text-gray-500 pl-7">{report.desc}</p>
              <UrlBlock url={buildUrl(report.id)} />
            </div>
          ))}
        </div>

        {/* Notes */}
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 space-y-1">
          <p className="text-xs font-semibold text-amber-400">Notes</p>
          <ul className="text-xs text-amber-300/70 space-y-1 list-disc list-inside">
            <li>Reports are generated live from current database state — refresh the URL to get updated data.</li>
            <li>No API key is required. These endpoints are publicly accessible for any valid event ID.</li>
            <li>The Offline Snapshot (type 8) bundles all critical data into one printable file — ideal for field use without internet.</li>
          </ul>
        </div>

        {/* ── JSON Sync ──────────────────────────────────────────── */}
        <div className="border-t border-gray-800 pt-8 space-y-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-1">
              <FileJson className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">JSON Data Sync</h2>
              <p className="text-gray-500 text-sm mt-1">
                Export a full snapshot of all event data to a JSON file, or import new records from an offline-generated JSON file. Import is append-only — no existing records are modified or deleted.
              </p>
            </div>
          </div>

          {!activeEvent && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-sm text-amber-400">
              Select an active event to use export / import.
            </div>
          )}

          {activeEvent && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Export */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Download className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-white">Export Event Data</h3>
                </div>
                <p className="text-xs text-gray-500">Downloads a complete JSON snapshot of <span className="text-white font-medium">{activeEvent.name}</span> — all stations, operators, frequencies, logs, participants, and more.</p>
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-sm font-semibold rounded-lg transition-all disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  {exporting ? 'Exporting…' : 'Download JSON'}
                </button>
              </div>

              {/* Import */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Upload className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold text-white">Import Event Data</h3>
                </div>
                <p className="text-xs text-gray-500">Upload a JSON file to append new records into <span className="text-white font-medium">{activeEvent.name}</span>. Existing records are never overwritten.</p>
                <input type="file" accept="application/json" ref={fileInputRef} onChange={handleImportFile} className="hidden" />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-sm font-semibold rounded-lg transition-all disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  {importing ? 'Importing…' : 'Upload JSON'}
                </button>
                {importResult && (
                  <div className={`rounded-lg p-3 text-xs space-y-1 ${importResult.success ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                    <p className="font-semibold">{importResult.success ? '✓ Import complete' : '⚠ Import finished with errors'}</p>
                    {Object.entries(importResult.results || {}).map(([k, v]) => v.created > 0 && (
                      <p key={k} className="text-gray-400">{k}: <span className="text-white">{v.created} records added</span></p>
                    ))}
                    {importResult.errors?.map((e, i) => (
                      <p key={i} className="text-red-400">{e.entity}: {e.error}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── JSON Schema Docs ───────────────────────────────────── */}
        <div className="border-t border-gray-800 pt-8 space-y-4">
          <div>
            <h2 className="text-xl font-bold text-white">JSON Data Structure</h2>
            <p className="text-gray-500 text-sm mt-1">
              Reference for the exported JSON format. Each top-level key maps to an array of entity records (except <code className="text-cyan-400 font-mono text-xs">_meta</code> and <code className="text-cyan-400 font-mono text-xs">event</code>). Fields marked <span className="text-amber-400 font-mono text-xs">*</span> are required on import.
            </p>
            <p className="text-xs text-gray-600 mt-1">
              On import, <code className="font-mono text-cyan-400/70">id</code>, <code className="font-mono text-cyan-400/70">created_date</code>, <code className="font-mono text-cyan-400/70">updated_date</code>, and <code className="font-mono text-cyan-400/70">created_by</code> are stripped — new IDs are assigned automatically. <code className="font-mono text-cyan-400/70">event_id</code> is overwritten to the target event.
            </p>
          </div>

          <div className="space-y-2">
            {SCHEMA_DOCS.map(doc => (
              <SchemaSection key={doc.key} doc={doc} />
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}