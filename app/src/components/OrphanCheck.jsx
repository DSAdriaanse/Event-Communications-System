import { useState } from "react";
import { adminRequest } from "@/api/ecs";
import { DatabaseZap } from "lucide-react";

// Admin-only: finds records whose links point at something that no longer exists (a station, frequency,
// operator, participant or log entry that was deleted), and repairs them. The server also does this
// every night; see pocketbase/pb_hooks/lib/orphans.js.
const WHAT = {
  "aide_stations.primary_frequency_id": "Stations whose primary frequency was deleted",
  "aide_stations.backup_frequency_id": "Stations whose backup frequency was deleted",
  "assignments.operator_id": "Assignments whose operator was deleted",
  "assignments.station_id": "Assignments whose station was deleted",
  "participants.current_location_station_id": "Participants whose last station was deleted",
  "participant_status_updates.participant_id": "Status updates whose participant was deleted",
  "participant_status_updates.aide_station_id": "Status updates whose station was deleted",
  "bulletins.event_log_id": "Bulletins whose log entry was deleted",
};

export default function OrphanCheck() {
  const [state, setState] = useState({ busy: false, report: null, done: null, error: "" });

  const run = async (fn) => {
    setState((s) => ({ ...s, busy: true, error: "", done: null }));
    try { await fn(); } catch (e) { setState((s) => ({ ...s, error: e.message })); }
    setState((s) => ({ ...s, busy: false }));
  };
  const check = () => run(async () => {
    const report = await adminRequest("GET", "orphans");
    setState((s) => ({ ...s, report }));
  });
  const repair = () => run(async () => {
    const r = await adminRequest("POST", "orphans/clean");
    const report = await adminRequest("GET", "orphans");
    setState((s) => ({ ...s, report, done: r }));
  });
  const { busy, report, done, error } = state;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <DatabaseZap className="w-4 h-4 text-cyan-400" />
        <h2 className="text-sm font-semibold text-white">Data check</h2>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Looks for records that point at something that was deleted. Repairing blanks the dead link and keeps the record
        (a status update whose participant is gone is removed). The server also repairs these every night.
      </p>
      <div className="flex items-center gap-3">
        <button onClick={check} disabled={busy} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white font-semibold rounded-lg text-sm">
          {busy && !report ? "Checking…" : "Check now"}
        </button>
        {report && report.total > 0 && (
          <button onClick={() => { if (confirm(`Repair ${report.total} record(s)?`)) repair(); }} disabled={busy}
            className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 text-gray-950 font-semibold rounded-lg text-sm">
            {busy ? "Repairing…" : "Repair"}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
      {done && <p className="text-xs text-emerald-400 mt-3">Repaired: {done.cleared} link(s) cleared, {done.deleted} record(s) removed.</p>}
      {report && report.total === 0 && <p className="text-xs text-emerald-400 mt-3">No orphaned records.</p>}
      {report && report.total > 0 && (
        <ul className="text-xs text-gray-300 mt-3 space-y-1">
          {report.orphans.map((o) => (
            <li key={o.collection + o.field}>{o.count} · {WHAT[`${o.collection}.${o.field}`] || `${o.collection}.${o.field}`}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
