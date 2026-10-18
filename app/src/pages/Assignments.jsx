import { useEffect, useState } from "react";
import { db } from "@/api/ecs";
import { useEvent } from "@/components/EventContext";
import { Plus, Edit2, Trash2, X, Save, ChevronDown, ChevronRight, Radio, User } from "lucide-react";
import { formatEventTime, parseAsUTC } from "@/lib/eventTime";

const STATUS_COLORS = {
  Scheduled: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Completed: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  Cancelled: "bg-red-500/10 text-red-400 border-red-500/20",
};

const ROLE_COLORS = {
  "Net Control": "text-cyan-400",
  "Station Operator": "text-emerald-400",
  "Liaison": "text-violet-400",
  "Floater": "text-amber-400",
  "Backup": "text-gray-400",
};

const empty = { operator_callsign: "", station_name: "", role: "Station Operator", start_time: "", end_time: "", status: "Scheduled", notes: "" };

export default function Assignments() {
  const [assignments, setAssignments] = useState([]);
  const [operators, setOperators] = useState([]);
  const [stations, setStations] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("All");
  const [collapsed, setCollapsed] = useState({});
  const [groupBy, setGroupBy] = useState("station"); // "station" | "operator"
  const [copyTimes, setCopyTimes] = useState(false);
  const { activeEventId, activeEvent } = useEvent();

  const load = async () => {
    setLoading(true);
    const [a, o, s] = await Promise.all([
      db.assignments.list(),
      db.operators.list(),
      db.aideStations.list(),
    ]);
    setAssignments(activeEventId ? a.filter(x => x.event_id === activeEventId) : a);
    setOperators(activeEventId ? o.filter(x => x.event_id === activeEventId) : o);
    setStations(activeEventId ? s.filter(x => x.event_id === activeEventId) : s);
    setLoading(false);
  };
  useEffect(() => { load(); }, [activeEventId]);

  const tz = activeEvent?.timezone || "America/Phoenix";

  // Convert a UTC ISO string to a "YYYY-MM-DDTHH:MM" string in the event's timezone
  // so that datetime-local inputs show the correct local event time.
  const toEventLocalInput = (iso) => {
    if (!iso) return "";
    const d = parseAsUTC(iso);
    if (!d || isNaN(d.getTime())) return "";
    // Use Intl to get the date/time parts in the event timezone
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(d);
    const get = (type) => parts.find(p => p.type === type)?.value || "00";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
  };

  // Convert a datetime-local value (event-local time) to a UTC ISO string for storage.
  // val is "YYYY-MM-DDTHH:MM" representing a wall-clock time in `tz`.
  const fromEventLocalInput = (val) => {
    if (!val) return "";
    // Use Intl to get the UTC offset for the event timezone at this approximate moment.
    // We probe with a UTC date equal to the naive input, get what the tz wall clock shows,
    // then compute the delta and correct. Two iterations handles DST edge cases.
    const naiveMs = new Date(val + ":00Z").getTime();
    const probe = new Date(naiveMs);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).formatToParts(probe);
    const get = (t) => parseInt(parts.find(p => p.type === t)?.value || "0");
    // Reconstruct the tz wall-clock time as a UTC ms value so we can diff
    const tzMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    // offsetMs = how many ms ahead of UTC the tz wall clock is
    const offsetMs = tzMs - naiveMs;
    // Subtract the offset from the intended local time to get real UTC
    return new Date(naiveMs - offsetMs).toISOString();
  };

  const openNew = () => { setForm(empty); setEditing(null); setShowForm(true); setCopyTimes(false); };
  const openEdit = (a) => {
    setForm({ ...a, start_time: toEventLocalInput(a.start_time), end_time: toEventLocalInput(a.end_time) });
    setEditing(a.id);
    setShowForm(true);
    setCopyTimes(false);
  };
  const del = async (id) => { if (confirm("Delete assignment?")) { await db.assignments.delete(id); load(); } };

  const save = async () => {
    const data = {
      ...form,
      event_id: activeEventId,
      start_time: form.start_time ? fromEventLocalInput(form.start_time) : "",
      end_time: form.end_time ? fromEventLocalInput(form.end_time) : "",
    };
    if (editing) await db.assignments.update(editing, data);
    else await db.assignments.create(data);
    if (copyTimes && (data.start_time || data.end_time)) {
      const others = assignments.filter(a => a.id !== editing && a.event_id === activeEventId);
      await Promise.all(others.map(a => db.assignments.update(a.id, {
        start_time: data.start_time || a.start_time,
        end_time: data.end_time || a.end_time,
      })));
    }
    setShowForm(false); load();
  };

  const toggleCollapse = (stationName) => {
    setCollapsed(prev => ({ ...prev, [stationName]: !prev[stationName] }));
  };

  const filtered = assignments.filter(a => filterStatus === "All" || a.status === filterStatus);

  // ── By Station ───────────────────────────────────────────────────────────
  const stationOrder = [...stations].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const groupedByStation = {};
  stationOrder.forEach(s => { groupedByStation[s.name] = []; });
  const noStation = [];
  filtered.forEach(a => {
    if (groupedByStation[a.station_name] !== undefined) groupedByStation[a.station_name].push(a);
    else noStation.push(a);
  });
  const stationsToShow = stationOrder.filter(s => groupedByStation[s.name]?.length > 0);

  // ── By Operator ──────────────────────────────────────────────────────────
  const groupedByOperator = {};
  filtered.forEach(a => {
    const key = a.operator_callsign || "Unknown";
    if (!groupedByOperator[key]) groupedByOperator[key] = [];
    groupedByOperator[key].push(a);
  });
  // Sort each operator's assignments chronologically by start_time
  Object.values(groupedByOperator).forEach(arr => arr.sort((a, b) => {
    if (!a.start_time && !b.start_time) return 0;
    if (!a.start_time) return 1;
    if (!b.start_time) return -1;
    return new Date(a.start_time) - new Date(b.start_time);
  }));
  // Sort operators alphabetically by callsign
  const operatorGroups = Object.keys(groupedByOperator).sort().map(callsign => {
    const op = operators.find(o => o.callsign === callsign);
    return { callsign, fullName: op?.full_name || "", assignments: groupedByOperator[callsign] };
  });

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Assignments</h1>
            <p className="text-gray-500 text-sm mt-1">{assignments.length} total assignments{activeEvent ? ` · ${activeEvent.name}` : ""}</p>
          </div>
          <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-semibold rounded-lg text-sm">
            <Plus className="w-4 h-4" /> New Assignment
          </button>
        </div>

        {/* Filter + Group toggle */}
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div className="flex gap-2 flex-wrap">
            {["All", "Scheduled", "Active", "Completed", "Cancelled"].map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${filterStatus === s ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
                {s}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
            <button onClick={() => setGroupBy("station")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${groupBy === "station" ? "bg-cyan-500/20 text-cyan-400" : "text-gray-500 hover:text-white"}`}>
              <Radio className="w-3.5 h-3.5" /> By Station
            </button>
            <button onClick={() => setGroupBy("operator")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${groupBy === "operator" ? "bg-cyan-500/20 text-cyan-400" : "text-gray-500 hover:text-white"}`}>
              <User className="w-3.5 h-3.5" /> By Operator
            </button>
          </div>
        </div>

        {/* Grouped list */}
        {loading ? (
          <div className="p-8 text-center text-gray-600">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-600">No assignments found</div>
        ) : groupBy === "station" ? (
          <div className="space-y-3">
            {stationsToShow.map(station => {
              const stationAssignments = groupedByStation[station.name] || [];
              if (stationAssignments.length === 0) return null;
              const isOpen = !collapsed[station.name];
              return (
                <div key={station.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <button onClick={() => toggleCollapse(station.name)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800/50 transition-colors text-left">
                    {isOpen ? <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />}
                    <span className="text-cyan-400 font-bold font-mono text-sm">{station.station_id}</span>
                    <span className="text-white font-semibold text-sm">{station.name}</span>
                    <span className="text-gray-500 text-xs ml-1">— {station.type}</span>
                    <span className="ml-auto text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                      {stationAssignments.length} {stationAssignments.length === 1 ? "operator" : "operators"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-gray-800">
                      <div className="grid grid-cols-5 px-6 py-2 text-xs text-gray-600 font-medium uppercase tracking-wider bg-gray-950/40">
                        <span>Operator</span><span>Role</span><span>Status</span><span>Time</span><span className="text-right">Actions</span>
                      </div>
                      {stationAssignments.map(a => (
                        <div key={a.id} className="grid grid-cols-5 px-6 py-3 border-t border-gray-800/40 hover:bg-gray-800/30 transition-colors items-center">
                          <span className="text-cyan-400 font-bold font-mono text-sm">{a.operator_callsign}</span>
                          <span className={`text-sm font-medium ${ROLE_COLORS[a.role] || "text-gray-400"}`}>{a.role}</span>
                          <span><span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${STATUS_COLORS[a.status]}`}>{a.status}</span></span>
                          <span className="text-gray-500 text-xs">
                            {a.start_time ? formatEventTime(a.start_time, tz, false) : "—"}
                            {a.end_time ? ` → ${formatEventTime(a.end_time, tz, false)}` : ""}
                          </span>
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => openEdit(a)} className="p-1.5 text-gray-500 hover:text-cyan-400"><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => del(a.id)} className="p-1.5 text-gray-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {noStation.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <button onClick={() => toggleCollapse("__unmatched__")}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800/50 transition-colors text-left">
                  {!collapsed["__unmatched__"] ? <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />}
                  <span className="text-amber-400 font-semibold text-sm">Other / Unmatched Stations</span>
                  <span className="ml-auto text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">{noStation.length}</span>
                </button>
                {!collapsed["__unmatched__"] && (
                  <div className="border-t border-gray-800">
                    <div className="grid grid-cols-5 px-6 py-2 text-xs text-gray-600 font-medium uppercase tracking-wider bg-gray-950/40">
                      <span>Operator</span><span>Station</span><span>Role</span><span>Status</span><span className="text-right">Actions</span>
                    </div>
                    {noStation.map(a => (
                      <div key={a.id} className="grid grid-cols-5 px-6 py-3 border-t border-gray-800/40 hover:bg-gray-800/30 transition-colors items-center">
                        <span className="text-cyan-400 font-bold font-mono text-sm">{a.operator_callsign}</span>
                        <span className="text-white text-sm">{a.station_name || "—"}</span>
                        <span className={`text-sm font-medium ${ROLE_COLORS[a.role] || "text-gray-400"}`}>{a.role}</span>
                        <span><span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${STATUS_COLORS[a.status]}`}>{a.status}</span></span>
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => openEdit(a)} className="p-1.5 text-gray-500 hover:text-cyan-400"><Edit2 className="w-4 h-4" /></button>
                          <button onClick={() => del(a.id)} className="p-1.5 text-gray-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* ── By Operator ── */
          <div className="space-y-3">
            {operatorGroups.map(({ callsign, fullName, assignments: opAssignments }) => {
              const key = `op_${callsign}`;
              const isOpen = !collapsed[key];
              return (
                <div key={callsign} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <button onClick={() => toggleCollapse(key)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800/50 transition-colors text-left">
                    {isOpen ? <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />}
                    <span className="text-cyan-400 font-bold font-mono text-sm">{callsign}</span>
                    {fullName && <span className="text-white font-semibold text-sm">{fullName}</span>}
                    <span className="ml-auto text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                      {opAssignments.length} {opAssignments.length === 1 ? "assignment" : "assignments"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-gray-800">
                      <div className="grid grid-cols-5 px-6 py-2 text-xs text-gray-600 font-medium uppercase tracking-wider bg-gray-950/40">
                        <span>Station</span><span>Role</span><span>Status</span><span>Time</span><span className="text-right">Actions</span>
                      </div>
                      {opAssignments.map(a => (
                        <div key={a.id} className="grid grid-cols-5 px-6 py-3 border-t border-gray-800/40 hover:bg-gray-800/30 transition-colors items-center">
                          <span className="text-white text-sm font-medium">{a.station_name || "—"}</span>
                          <span className={`text-sm font-medium ${ROLE_COLORS[a.role] || "text-gray-400"}`}>{a.role}</span>
                          <span><span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${STATUS_COLORS[a.status]}`}>{a.status}</span></span>
                          <span className="text-gray-500 text-xs">
                            {a.start_time ? formatEventTime(a.start_time, tz, false) : "—"}
                            {a.end_time ? ` → ${formatEventTime(a.end_time, tz, false)}` : ""}
                          </span>
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => openEdit(a)} className="p-1.5 text-gray-500 hover:text-cyan-400"><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => del(a.id)} className="p-1.5 text-gray-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h2 className="text-lg font-semibold text-white">{editing ? "Edit Assignment" : "New Assignment"}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Operator Callsign *</label>
                <select value={form.operator_callsign} onChange={e => setForm(f => ({ ...f, operator_callsign: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
                  <option value="">— Select Operator —</option>
                  {operators.map(o => <option key={o.id} value={o.callsign}>{o.callsign} — {o.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Station *</label>
                <select value={form.station_name} onChange={e => setForm(f => ({ ...f, station_name: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
                  <option value="">— Select Station —</option>
                  {stations.map(s => <option key={s.id} value={s.name}>{s.station_id} — {s.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Role</label>
                  <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
                    {["Net Control","Station Operator","Liaison","Floater","Backup"].map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
                    {["Scheduled","Active","Completed","Cancelled"].map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Start Time</label>
                  <input type="datetime-local" value={form.start_time || ""} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">End Time</label>
                  <input type="datetime-local" value={form.end_time || ""} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none" />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none group">
                <input type="checkbox" checked={copyTimes} onChange={e => setCopyTimes(e.target.checked)}
                  className="w-4 h-4 rounded accent-cyan-500 cursor-pointer" />
                <span className="text-xs text-gray-400 group-hover:text-gray-200 transition-colors">Copy these times to all other assignments</span>
              </label>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Notes</label>
                <textarea value={form.notes || ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none resize-none" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
              <button onClick={save} className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-semibold rounded-lg text-sm">
                <Save className="w-4 h-4" /> Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}