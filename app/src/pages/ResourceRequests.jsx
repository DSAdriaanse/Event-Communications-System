import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useEvent } from "@/components/EventContext";
import { Plus, Loader2, X } from "lucide-react";
import { formatEventDateTime } from "@/lib/eventTime";

const TYPE_COLORS = {
  SAG: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  Food: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  Water: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  Medical: "bg-red-500/20 text-red-300 border-red-500/30",
  Logistics: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  Personnel: "bg-green-500/20 text-green-300 border-green-500/30",
  Equipment: "bg-gray-500/20 text-gray-300 border-gray-500/30",
  Information: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  Other: "bg-slate-500/20 text-slate-300 border-slate-500/30",
};

const PRIORITY_COLORS = {
  Routine: "bg-gray-700 text-gray-300",
  Urgent: "bg-amber-500/20 text-amber-300",
  Emergency: "bg-red-500/20 text-red-400",
};

const STATUS_COLORS = {
  Pending: "text-yellow-400",
  Approved: "text-blue-400",
  "En Route": "text-cyan-400",
  Fulfilled: "text-green-400",
  Cancelled: "text-gray-500",
};

const STATUS_ICONS = {
  Pending: "⏳",
  Approved: "✅",
  "En Route": "🚗",
  Fulfilled: "✔️",
  Cancelled: "✖",
};

const EMPTY = {
  type: "SAG",
  item: "",
  quantity: "",
  unit: "",
  status: "Pending",
  priority: "Routine",
  requested_by: "",
  station_name: "",
  fulfilled_by: "",
  notes: "",
};

function RequestRow({ req, openEdit, deleteReq, updateStatus, showStation, tz }) {
  return (
    <div className={`bg-gray-900 border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 transition-all ${req.priority === "Emergency" ? "border-red-500/40" : req.priority === "Urgent" ? "border-amber-500/30" : "border-gray-800"}`}>
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <span className={`mt-0.5 px-2 py-0.5 rounded border text-xs font-bold ${TYPE_COLORS[req.type] || TYPE_COLORS.Other}`}>{req.type}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-semibold text-sm">{req.item}</span>
            {req.quantity && <span className="text-gray-400 text-xs">{req.quantity} {req.unit}</span>}
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${PRIORITY_COLORS[req.priority]}`}>{req.priority}</span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-500">
            {showStation && req.station_name && <span>📍 {req.station_name}</span>}
            {req.requested_by && <span>👤 {req.requested_by}</span>}
            {req.fulfilled_by && <span>✔ Fulfilled by: {req.fulfilled_by}</span>}
            <span>{formatEventDateTime(req.created_date, tz)}</span>
          </div>
          {req.notes && <p className="text-xs text-gray-500 mt-1 italic">{req.notes}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`text-xs font-semibold ${STATUS_COLORS[req.status]}`}>{STATUS_ICONS[req.status]} {req.status}</span>
        <select value={req.status} onChange={e => updateStatus(req, e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-cyan-500/50">
          {["Pending", "Approved", "En Route", "Fulfilled", "Cancelled"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => openEdit(req)} className="text-gray-600 hover:text-cyan-400 transition-colors text-xs px-2 py-1 bg-gray-800 rounded">Edit</button>
        <button onClick={() => deleteReq(req.id)} className="text-gray-600 hover:text-red-400 transition-colors"><X className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

export default function ResourceRequests() {
  const { activeEvent, activeEventId } = useEvent();
  const tz = activeEvent?.timezone || "America/Phoenix";
  const [requests, setRequests] = useState([]);
  const [stations, setStations] = useState([]);
  const [operators, setOperators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterType, setFilterType] = useState("All");
  const [sortBy, setSortBy] = useState("chronological"); // "chronological" | "station"
  const [myStationOnly, setMyStationOnly] = useState(false);
  // Always a dropdown; defaults to login station if set, else ""
  const [stationFilter, setStationFilter] = useState(() => localStorage.getItem("ecs_station_name") || "");

  const load = async () => {
    if (!activeEventId) { setLoading(false); return; }
    setLoading(true);
    const [reqs, sts, ops] = await Promise.all([
      base44.entities.ResourceRequest.filter({ event_id: activeEventId }, "-created_date"),
      base44.entities.AideStation.filter({ event_id: activeEventId }),
      base44.entities.Operator.filter({ event_id: activeEventId }),
    ]);
    setRequests(reqs);
    setStations(sts);
    setOperators(ops);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeEventId]);

  const openNew = () => {
    setEditing(null);
    setForm({
      ...EMPTY,
      event_id: activeEventId,
      station_name: localStorage.getItem("ecs_station_name") || "",
      requested_by: localStorage.getItem("ecs_callsign") || "",
    });
    setShowForm(true);
  };

  const openEdit = (r) => {
    setEditing(r);
    setForm({ ...r });
    setShowForm(true);
  };

  const logEvent = (content, priority = "Routine") => {
    base44.entities.EventLog.create({
      event_id: activeEventId,
      type: "note",
      content,
      priority,
      message_type: "Resource Request",
    });
  };

  const save = async () => {
    const payload = { ...form, event_id: activeEventId, quantity: form.quantity !== "" ? Number(form.quantity) : undefined };
    if (editing) {
      await base44.entities.ResourceRequest.update(editing.id, payload);
      const parts = [`[Resource Request] UPDATED: ${payload.type} — ${payload.item}`];
      if (payload.station_name) parts.push(`Station: ${payload.station_name}`);
      if (payload.requested_by) parts.push(`Requested by: ${payload.requested_by}`);
      if (payload.status) parts.push(`Status: ${payload.status}`);
      logEvent(parts.join(" | "), payload.priority === "Emergency" ? "Emergency" : payload.priority === "Urgent" ? "Priority" : "Routine");
    } else {
      await base44.entities.ResourceRequest.create(payload);
      const parts = [`[Resource Request] NEW: ${payload.type} — ${payload.item}`];
      if (payload.quantity) parts.push(`Qty: ${payload.quantity} ${payload.unit || ""}`.trim());
      if (payload.station_name) parts.push(`Station: ${payload.station_name}`);
      if (payload.requested_by) parts.push(`Requested by: ${payload.requested_by}`);
      logEvent(parts.join(" | "), payload.priority === "Emergency" ? "Emergency" : payload.priority === "Urgent" ? "Priority" : "Routine");
    }
    setShowForm(false);
    load();
  };

  const updateStatus = async (req, status) => {
    await base44.entities.ResourceRequest.update(req.id, { status });
    setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status } : r));
    logEvent(`[Resource Request] STATUS: ${req.type} — ${req.item} → ${status}${req.station_name ? ` | Station: ${req.station_name}` : ""}`);
  };

  const deleteReq = async (id) => {
    await base44.entities.ResourceRequest.delete(id);
    setRequests(prev => prev.filter(r => r.id !== id));
  };

  const filtered = requests
    .filter(r =>
      (filterStatus === "All" || r.status === filterStatus) &&
      (filterType === "All" || r.type === filterType) &&
      (!myStationOnly || !stationFilter || r.station_name === stationFilter)
    )
    .sort((a, b) => {
      if (sortBy === "station") {
        return (a.station_name || "zzz").localeCompare(b.station_name || "zzz");
      }
      return new Date(b.created_date) - new Date(a.created_date);
    });

  // Group by station name when sorting by station
  const groupedByStation = sortBy === "station"
    ? filtered.reduce((acc, r) => {
        const key = r.station_name || "(No Station)";
        if (!acc[key]) acc[key] = [];
        acc[key].push(r);
        return acc;
      }, {})
    : null;

  const openCount = requests.filter(r => !["Fulfilled", "Cancelled"].includes(r.status)).length;
  const emergencyCount = requests.filter(r => r.priority === "Emergency" && !["Fulfilled", "Cancelled"].includes(r.status)).length;

  if (!activeEventId) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-500 text-sm">Select an active event to manage resource requests.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Resource Requests</h1>
            <p className="text-gray-500 text-sm mt-0.5">{activeEvent?.name}</p>
          </div>
          <button onClick={openNew}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-semibold rounded-lg text-sm transition-all">
            <Plus className="w-4 h-4" /> New Request
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total", value: requests.length, color: "text-white" },
            { label: "Open", value: openCount, color: "text-yellow-400" },
            { label: "Emergency", value: emergencyCount, color: "text-red-400" },
            { label: "Fulfilled", value: requests.filter(r => r.status === "Fulfilled").length, color: "text-green-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
              <div className={`text-2xl font-bold ${color}`}>{value}</div>
              <div className="text-xs text-gray-500 mt-1">{label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Status:</span>
            {["All", "Pending", "Approved", "En Route", "Fulfilled", "Cancelled"].map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${filterStatus === s ? "bg-cyan-500 text-gray-950" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                {s}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Type:</span>
            {["All", "SAG", "Food", "Water", "Medical", "Logistics", "Personnel", "Equipment", "Information", "Other"].map(t => (
              <button key={t} onClick={() => setFilterType(t)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${filterType === t ? "bg-cyan-500 text-gray-950" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Sort & Station Filter */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">Sort:</span>
          <button onClick={() => setSortBy("chronological")}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${sortBy === "chronological" ? "bg-cyan-500 text-gray-950" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
            Chronological
          </button>
          <button onClick={() => setSortBy("station")}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${sortBy === "station" ? "bg-cyan-500 text-gray-950" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
            By Aide Station
          </button>

          <div className="w-px h-4 bg-gray-700 mx-1" />

          <button
            onClick={() => setMyStationOnly(v => !v)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${myStationOnly ? "bg-amber-500 text-gray-950" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
            📍 My Aide Station
          </button>

          {myStationOnly && (
            <select
              value={stationFilter}
              onChange={e => setStationFilter(e.target.value)}
              className="bg-gray-800 border border-amber-500/40 rounded-lg px-3 py-1 text-xs text-white focus:outline-none focus:border-cyan-500/50"
            >
              <option value="">— All Stations —</option>
              {stations.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          )}
        </div>

        {/* List */}
        {loading ? (
          <div className="text-center py-16 text-gray-600">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-cyan-500" />
            Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-600 text-sm">No requests found.</div>
        ) : groupedByStation ? (
          <div className="space-y-6">
            {Object.entries(groupedByStation).map(([stationName, reqs]) => (
              <div key={stationName}>
                <div className="flex items-center gap-3 mb-2">
                  <div className="text-sm font-bold text-cyan-400 flex items-center gap-2">
                    <span>📍</span> {stationName}
                  </div>
                  <div className="flex-1 h-px bg-gray-800" />
                  <span className="text-xs text-gray-600">{reqs.length} request{reqs.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="space-y-2">
                  {reqs.map(req => <RequestRow key={req.id} req={req} openEdit={openEdit} deleteReq={deleteReq} updateStatus={updateStatus} showStation={false} tz={tz} />)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(req => <RequestRow key={req.id} req={req} openEdit={openEdit} deleteReq={deleteReq} updateStatus={updateStatus} showStation={true} tz={tz} />)}
          </div>
        )}
      </div>

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-white font-semibold">{editing ? "Edit Request" : "New Resource Request"}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-gray-500 mb-1 block">Item / Description *</label>
                <input value={form.item} onChange={e => setForm(p => ({...p, item: e.target.value}))}
                  placeholder="e.g. Runner down at Mile 14"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Type</label>
                <select value={form.type} onChange={e => setForm(p => ({...p, type: e.target.value}))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50">
                  {["SAG", "Food", "Water", "Medical", "Logistics", "Personnel", "Equipment", "Information", "Other"].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Priority</label>
                <select value={form.priority} onChange={e => setForm(p => ({...p, priority: e.target.value}))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50">
                  {["Routine", "Urgent", "Emergency"].map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Quantity</label>
                <input type="number" value={form.quantity} onChange={e => setForm(p => ({...p, quantity: e.target.value}))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Unit</label>
                <input value={form.unit} onChange={e => setForm(p => ({...p, unit: e.target.value}))}
                  placeholder="e.g. gallons, cases, people"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Station</label>
                <select value={form.station_name} onChange={e => setForm(p => ({...p, station_name: e.target.value}))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50">
                  <option value="">— None —</option>
                  {stations.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Requested By</label>
                <select value={form.requested_by} onChange={e => setForm(p => ({...p, requested_by: e.target.value}))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50">
                  <option value="">— None —</option>
                  {operators.map(o => <option key={o.id} value={o.callsign}>{o.callsign} — {o.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Status</label>
                <select value={form.status} onChange={e => setForm(p => ({...p, status: e.target.value}))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50">
                  {["Pending", "Approved", "En Route", "Fulfilled", "Cancelled"].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Fulfilled By</label>
                <select value={form.fulfilled_by} onChange={e => setForm(p => ({...p, fulfilled_by: e.target.value}))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50">
                  <option value="">— None —</option>
                  {operators.map(o => <option key={o.id} value={o.callsign}>{o.callsign} — {o.full_name}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500 mb-1 block">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(p => ({...p, notes: e.target.value}))}
                  rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50 resize-none" />
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 rounded-lg transition-all">Cancel</button>
              <button onClick={save} className="px-4 py-2 text-sm font-semibold bg-cyan-500 hover:bg-cyan-400 text-gray-950 rounded-lg transition-all">
                {editing ? "Save Changes" : "Create Request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}