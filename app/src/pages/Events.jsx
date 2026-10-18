import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useEvent } from "@/components/EventContext";
import { useAuth } from "@/components/PinGate";
import { Plus, Edit2, Trash2, X, Save, Radio, CheckCircle, Copy, ShieldCheck } from "lucide-react";
import { TIMEZONE_OPTIONS, formatEventDateTime, getTzAbbr } from "@/lib/eventTime";

const STATUS_COLORS = {
  Planning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Completed: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Archived: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

const empty = { name: "", incident_name: "", date: "", start_datetime: "", end_datetime: "", location: "", net_control_callsign: "", status: "Planning", timezone: "America/Phoenix", pin: "", notes: "" };

export default function Events() {
  const [events, setEvents] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [adminPin, setAdminPin] = useState("");
  const [adminPinRecord, setAdminPinRecord] = useState(null);
  const [savingPin, setSavingPin] = useState(false);
  const [pinSaved, setPinSaved] = useState(false);
  const { activeEventId, selectEvent, loadEvents } = useEvent() || {};
  const auth = useAuth();
  const isAdmin = auth?.isAdmin ?? false;

  const load = async () => {
    setLoading(true);
    const [data, cfgList] = await Promise.all([
      base44.entities.Event.list("-date"),
      base44.entities.AppConfig.list(),
    ]);
    setEvents(data);
    const rec = cfgList.find(c => c.key === "admin_pin");
    setAdminPinRecord(rec || null);
    setAdminPin(rec?.value || "");
    setLoading(false);
  };

  const saveAdminPin = async () => {
    setSavingPin(true);
    if (adminPinRecord) {
      await base44.entities.AppConfig.update(adminPinRecord.id, { value: adminPin });
    } else {
      const rec = await base44.entities.AppConfig.create({ key: "admin_pin", value: adminPin });
      setAdminPinRecord(rec);
    }
    setSavingPin(false);
    setPinSaved(true);
    setTimeout(() => setPinSaved(false), 2000);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(empty); setEditing(null); setShowForm(true); };
  const openEdit = (e) => { setForm({ ...e }); setEditing(e.id); setShowForm(true); };

  const save = async () => {
    const data = { ...form };
    // Convert datetime-local strings to ISO format with Z suffix
    if (data.start_datetime && !data.start_datetime.includes('Z')) {
      data.start_datetime = new Date(data.start_datetime).toISOString();
    }
    if (data.end_datetime && !data.end_datetime.includes('Z')) {
      data.end_datetime = new Date(data.end_datetime).toISOString();
    }
    if (editing) await base44.entities.Event.update(editing, data);
    else {
      const created = await base44.entities.Event.create(data);
      if (form.status === "Active") selectEvent(created.id);
    }
    setShowForm(false);
    load();
    loadEvents();
  };

  const del = async (id) => {
    if (confirm("Delete this event? This does not delete associated data.")) {
      await base44.entities.Event.delete(id);
      load();
      loadEvents();
    }
  };

  const activate = (id) => {
    selectEvent(id);
  };

  const duplicate = async (ev) => {
    if (!window.confirm(`Duplicate "${ev.name}"? All data except communications will be copied.`)) return;
    // Create new event (reset date and status to Planning)
    const newEvent = await base44.entities.Event.create({
      name: ev.name + " (Copy)",
      incident_name: ev.incident_name,
      location: ev.location,
      net_control_callsign: ev.net_control_callsign,
      status: "Planning",
      notes: ev.notes,
      discussion: ev.discussion,
      conops_comms: ev.conops_comms,
      documents_url: ev.documents_url,
    });
    const newId = newEvent.id;
    const strip = ({ id, created_date, updated_date, created_by, ...rest }) => rest;
    const [operators, stations, assignments, frequencies] = await Promise.all([
      base44.entities.Operator.filter({ event_id: ev.id }),
      base44.entities.AideStation.filter({ event_id: ev.id }),
      base44.entities.Assignment.filter({ event_id: ev.id }),
      base44.entities.Frequency.filter({ event_id: ev.id }),
    ]);
    // Create frequencies first and build an old-ID → new-ID map
    const freqIdMap = {};
    for (const f of frequencies) {
      const newFreq = await base44.entities.Frequency.create({ ...strip(f), event_id: newId });
      freqIdMap[f.id] = newFreq.id;
    }
    for (const o of operators) await base44.entities.Operator.create({ ...strip(o), event_id: newId });
    // Remap frequency IDs on stations so they reference the new event's frequencies
    for (const s of stations) {
      await base44.entities.AideStation.create({
        ...strip(s),
        event_id: newId,
        primary_frequency_id: freqIdMap[s.primary_frequency_id] || null,
        backup_frequency_id: freqIdMap[s.backup_frequency_id] || null,
      });
    }
    for (const a of assignments) await base44.entities.Assignment.create({ ...strip(a), event_id: newId, status: "Scheduled" });
    load();
    loadEvents();
  };

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Events</h1>
            <p className="text-gray-500 text-sm mt-1">{events.length} events · click to set active</p>
          </div>
          {isAdmin && (
            <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-semibold rounded-lg text-sm transition-all">
              <Plus className="w-4 h-4" /> New Event
            </button>
          )}
        </div>

        {isAdmin && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-semibold text-white">Admin PIN</h2>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={adminPin}
                onChange={e => setAdminPin(e.target.value)}
                placeholder="Set global admin PIN"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500/50"
              />
              <button
                onClick={saveAdminPin}
                disabled={savingPin}
                className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 text-gray-950 font-semibold rounded-lg text-sm transition-all flex-shrink-0"
              >
                {savingPin ? "Saving…" : pinSaved ? "Saved ✓" : "Save"}
              </button>
            </div>
            <p className="text-xs text-gray-600 mt-2">This PIN grants full admin access to all events.</p>
          </div>
        )}

        <div className="space-y-3">
          {loading ? (
            [0, 1].map(i => <div key={i} className="h-24 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />)
          ) : events.length === 0 ? (
            <div className="py-16 text-center text-gray-600">No events yet. Create your first event to get started.</div>
          ) : events.map(ev => {
            const isActive = ev.id === activeEventId;
            return (
              <div key={ev.id} className={`bg-gray-900 border rounded-xl p-5 transition-all cursor-pointer ${isActive ? "border-cyan-500/50 ring-1 ring-cyan-500/30" : "border-gray-800 hover:border-gray-700"}`}
                onClick={() => activate(ev.id)}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    {isActive && (
                      <div className="mt-0.5 w-5 h-5 rounded-full bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                        <CheckCircle className="w-3.5 h-3.5 text-cyan-400" />
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-white font-semibold">{ev.name}</h3>
                        {isActive && <span className="text-xs font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-full">ACTIVE</span>}
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${STATUS_COLORS[ev.status]}`}>{ev.status}</span>
                      </div>
                      <div className="flex flex-wrap gap-4 mt-2 text-xs text-gray-500">
                        {ev.incident_name && <span>Incident: <span className="text-gray-300">{ev.incident_name}</span></span>}
                        {ev.start_datetime && <span>Start: <span className="text-gray-300">{formatEventDateTime(ev.start_datetime, ev.timezone || "America/Phoenix")}</span></span>}
                        {ev.end_datetime && <span>End: <span className="text-gray-300">{formatEventDateTime(ev.end_datetime, ev.timezone || "America/Phoenix")}</span></span>}
                        {ev.location && <span>Location: <span className="text-gray-300">{ev.location}</span></span>}
                        {ev.timezone && <span>TZ: <span className="text-gray-300">{getTzAbbr(ev.timezone)}</span></span>}
                        {ev.net_control_callsign && <span>Net Control: <span className="text-cyan-400 font-mono font-bold">{ev.net_control_callsign}</span></span>}
                        {isAdmin && ev.pin && <span>PIN: <span className="text-amber-400 font-mono font-bold">{ev.pin}</span></span>}
                        {isAdmin && !ev.pin && <span className="text-gray-700 italic">No PIN</span>}

                      </div>
                      {ev.notes && <p className="text-xs text-gray-600 mt-1.5">{ev.notes}</p>}
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 flex-shrink-0 ml-4" onClick={e => e.stopPropagation()}>
                      <button onClick={() => openEdit(ev)} className="p-1.5 text-gray-500 hover:text-cyan-400 transition-colors"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => duplicate(ev)} className="p-1.5 text-gray-500 hover:text-violet-400 transition-colors" title="Duplicate event"><Copy className="w-4 h-4" /></button>
                      <button onClick={() => del(ev.id)} className="p-1.5 text-gray-500 hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h2 className="text-lg font-semibold text-white">{editing ? "Edit Event" : "New Event"}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Event Name *", key: "name", placeholder: "LA Marathon 2026" },
                  { label: "Incident Name", key: "incident_name", placeholder: "LAMA26" },
                  { label: "Start Date/Time", key: "start_datetime", type: "datetime-local" },
                  { label: "End Date/Time", key: "end_datetime", type: "datetime-local" },
                  { label: "Location", key: "location", placeholder: "Los Angeles, CA" },
                  { label: "Net Control", key: "net_control_callsign", placeholder: "W6NET" },
                ].map(({ label, key, placeholder, type: inputType }) => (
                  <div key={key}>
                    <label className="text-xs text-gray-400 mb-1 block">{label}</label>
                    <input
                      type={inputType || "text"}
                      value={form[key] ? (inputType === "datetime-local" && form[key].includes('T') ? form[key].split('Z')[0] : form[key]) : ""}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                      placeholder={placeholder}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
                    />
                  </div>
                ))}
                <div className="col-span-2">
                  <label className="text-xs text-gray-400 mb-1 block">Timezone</label>
                  <select value={form.timezone || "America/Phoenix"} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50">
                    {(TIMEZONE_OPTIONS || []).map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-gray-400 mb-1 block">Event PIN <span className="text-gray-600">(leave blank for open access)</span></label>
                  <input
                    type="text"
                    value={form.pin || ""}
                    onChange={e => setForm(f => ({ ...f, pin: e.target.value }))}
                    placeholder="e.g. 1234"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500/50"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Status</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
                  {["Planning","Active","Completed","Archived"].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Documents URL <span className="text-gray-600">(OneDrive, Google Drive, etc.)</span></label>
                <input
                  type="url"
                  value={form.documents_url || ""}
                  onChange={e => setForm(f => ({ ...f, documents_url: e.target.value }))}
                  placeholder="https://drive.google.com/..."
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
                />
              </div>
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