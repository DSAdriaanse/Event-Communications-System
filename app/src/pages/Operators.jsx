import { useEffect, useState } from "react";
import { db } from "@/api/ecs";
import { useEvent } from "@/components/EventContext";
import { Plus, Search, Edit2, Trash2, X, Save, ChevronUp, ChevronDown } from "lucide-react";

const STATUS_COLORS = {
  Available: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Assigned: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  "En Route": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "Off Duty": "bg-gray-500/10 text-gray-400 border-gray-500/20",
  Standby: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

const empty = { callsign: "", full_name: "", phone: "", email: "", license_class: "General", certifications: [], status: "Available", notes: "", position_source: "None", tracking_identifier: "", latitude: "", longitude: "" };

function SortIcon({ col, sortCol, sortDir }) {
  if (sortCol !== col) return <ChevronUp className="w-3 h-3 opacity-20" />;
  return sortDir === "asc" ? <ChevronUp className="w-3 h-3 text-cyan-400" /> : <ChevronDown className="w-3 h-3 text-cyan-400" />;
}

export default function Operators() {
  const [operators, setOperators] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [certInput, setCertInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sortCol, setSortCol] = useState("callsign");
  const [sortDir, setSortDir] = useState("asc");
  const [filterStatus, setFilterStatus] = useState("All");
  const { activeEventId, activeEvent } = useEvent();

  const load = async () => {
    setLoading(true);
    const [ops, asgn] = await Promise.all([
      db.operators.list(),
      db.assignments.list(),
    ]);
    setOperators(activeEventId ? ops.filter(o => o.event_id === activeEventId) : ops);
    setAssignments(activeEventId ? asgn.filter(a => a.event_id === activeEventId) : asgn);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeEventId]);

  const openNew = () => { setForm(empty); setEditing(null); setShowForm(true); setCertInput(""); };
  const openEdit = (op) => { setForm({ ...op, certifications: op.certifications || [] }); setEditing(op.id); setShowForm(true); setCertInput(""); };

  const save = async () => {
    const isNoneSource = !form.position_source || form.position_source === "None";
    const data = {
      ...form,
      event_id: activeEventId,
      latitude: isNoneSource ? null : (form.latitude ? parseFloat(form.latitude) : undefined),
      longitude: isNoneSource ? null : (form.longitude ? parseFloat(form.longitude) : undefined),
    };
    if (editing) await db.operators.update(editing, data);
    else await db.operators.create(data);
    setShowForm(false);
    load();
  };

  const del = async (id) => {
    if (confirm("Delete this operator?")) { await db.operators.delete(id); load(); }
  };

  const addCert = () => {
    if (certInput.trim()) { setForm(f => ({ ...f, certifications: [...(f.certifications || []), certInput.trim()] })); setCertInput(""); }
  };
  const removeCert = (i) => setForm(f => ({ ...f, certifications: f.certifications.filter((_, idx) => idx !== i) }));

  // Get assigned station name for an operator
  const getAssignedStation = (callsign) => {
    const active = assignments.find(a => a.operator_callsign === callsign && (a.status === "Active" || a.status === "Scheduled"));
    return active ? active.station_name : null;
  };

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  const sortFn = (a, b) => {
    let aVal, bVal;
    if (sortCol === "callsign") { aVal = a.callsign || ""; bVal = b.callsign || ""; }
    else if (sortCol === "full_name") { aVal = a.full_name || ""; bVal = b.full_name || ""; }
    else if (sortCol === "license_class") { aVal = a.license_class || ""; bVal = b.license_class || ""; }
    else if (sortCol === "status") { aVal = a.status || ""; bVal = b.status || ""; }
    else if (sortCol === "station") { aVal = getAssignedStation(a.callsign) || ""; bVal = getAssignedStation(b.callsign) || ""; }
    else { aVal = ""; bVal = ""; }
    if (typeof aVal === "number") return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
  };

  const filtered = operators
    .filter(o =>
      (o.callsign?.toLowerCase().includes(search.toLowerCase()) ||
      o.full_name?.toLowerCase().includes(search.toLowerCase())) &&
      (filterStatus === "All" || (filterStatus === "Active" ? o.status !== "Off Duty" : o.status === filterStatus))
    )
    .sort(sortFn);

  const SortHeader = ({ col, label, className = "" }) => (
    <button onClick={() => handleSort(col)}
      className={`flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-300 transition-colors ${className}`}>
      {label}
      <SortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
    </button>
  );

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Operator Roster</h1>
            <p className="text-gray-500 text-sm mt-1">{operators.length} operators registered{activeEvent ? ` · ${activeEvent.name}` : ""}</p>
          </div>
          <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-semibold rounded-lg text-sm transition-all">
            <Plus className="w-4 h-4" /> Add Operator
          </button>
        </div>

        {/* Status filters */}
        <div className="flex gap-2 flex-wrap">
          {[
            { label: "All", value: "All" },
            { label: "Hide Off Duty", value: "Active" },
            { label: "Available", value: "Available" },
            { label: "Assigned", value: "Assigned" },
            { label: "Standby", value: "Standby" },
            { label: "En Route", value: "En Route" },
            { label: "Off Duty", value: "Off Duty" },
          ].map(({ label, value }) => (
            <button key={value} onClick={() => setFilterStatus(value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${filterStatus === value ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by callsign or name..."
            className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50" />
        </div>

        {/* Table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="grid grid-cols-6 px-4 py-3 border-b border-gray-800">
            <SortHeader col="callsign" label="Callsign" />
            <SortHeader col="full_name" label="Name" className="col-span-1" />
            <SortHeader col="license_class" label="License" />
            <SortHeader col="status" label="Status" />
            <SortHeader col="station" label="Assigned To" />
            <span className="text-xs font-medium uppercase tracking-wider text-gray-500 text-right">Actions</span>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-600">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-gray-600">No operators found</div>
          ) : (
            filtered.map(op => {
              const assignedStation = getAssignedStation(op.callsign);
              return (
                <div key={op.id} className="grid grid-cols-6 px-4 py-3.5 border-b border-gray-800/50 hover:bg-gray-800/50 transition-colors items-center">
                  <span className="text-cyan-400 font-bold text-sm font-mono">{op.callsign}</span>
                  <span className="text-white text-sm">{op.full_name}</span>
                  <span className="text-gray-400 text-sm">{op.license_class}</span>
                  <span><span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${STATUS_COLORS[op.status] || "bg-gray-700 text-gray-300"}`}>{op.status}</span></span>
                  <span>
                    {assignedStation
                      ? <span className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">{assignedStation}</span>
                      : <span className="text-xs text-gray-600 italic">—</span>
                    }
                  </span>
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => openEdit(op)} className="p-1.5 text-gray-500 hover:text-cyan-400 transition-colors"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => del(op.id)} className="p-1.5 text-gray-500 hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h2 className="text-lg font-semibold text-white">{editing ? "Edit Operator" : "New Operator"}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Callsign *", key: "callsign", placeholder: "W1ABC" },
                  { label: "Full Name *", key: "full_name", placeholder: "John Smith" },
                  { label: "Phone", key: "phone", placeholder: "555-0100" },
                  { label: "Email", key: "email", placeholder: "op@example.com" },
                ].map(({ label, key, placeholder }) => (
                  <div key={key}>
                    <label className="text-xs text-gray-400 mb-1 block">{label}</label>
                    <input value={form[key] || ""} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">License Class</label>
                  <select value={form.license_class} onChange={e => setForm(f => ({ ...f, license_class: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
                    {["Technician","General","Amateur Extra","GMRS","Other"].map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
                    {["Available","Assigned","En Route","Off Duty","Standby"].map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
              </div>

              {/* Position Source */}
              <div className="space-y-3 bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Position Source</label>
                  <select value={form.position_source || "None"} onChange={e => setForm(f => ({ ...f, position_source: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50">
                    <option value="None">None</option>
                    <option value="Manual">Manual</option>
                    <option value="APRS.fi">APRS.fi</option>
                  </select>
                </div>
                {form.position_source === "APRS.fi" && (
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Tracking Identifier</label>
                    <input value={form.tracking_identifier || ""} onChange={e => setForm(f => ({ ...f, tracking_identifier: e.target.value }))} placeholder="e.g. W1ABC-9"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
                  </div>
                )}
                {(form.position_source === "Manual" || form.position_source === "APRS.fi") && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Latitude</label>
                      <input value={form.latitude || ""} onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))} placeholder="34.05223"
                        disabled={form.position_source === "APRS.fi"}
                        className={`w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50 ${form.position_source === "APRS.fi" ? "opacity-40 cursor-not-allowed" : ""}`} />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Longitude</label>
                      <input value={form.longitude || ""} onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))} placeholder="-118.24368"
                        disabled={form.position_source === "APRS.fi"}
                        className={`w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50 ${form.position_source === "APRS.fi" ? "opacity-40 cursor-not-allowed" : ""}`} />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs text-gray-400 mb-1 block">Certifications</label>
                <div className="flex gap-2 mb-2">
                  <input value={certInput} onChange={e => setCertInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addCert()} placeholder="e.g. ICS-100, ARRL EC-001"
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none" />
                  <button onClick={addCert} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-white">Add</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(form.certifications || []).map((c, i) => (
                    <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300">
                      {c}<button onClick={() => removeCert(i)} className="hover:text-red-400"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-400 mb-1 block">Notes</label>
                <textarea value={form.notes || ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none resize-none" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
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