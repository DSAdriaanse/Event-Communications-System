import { useEffect, useState } from "react";
import { db } from "@/api/ecs";
import { useEvent } from "@/components/EventContext";
import { Plus, Edit2, Trash2, X, Save, MapPin, Radio, GripVertical } from "lucide-react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { parseAsUTC } from "@/lib/eventTime";

const STATUS_COLORS = {
  Active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Standby: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Closed: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  Requested: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

const TYPE_COLORS = {
  "Net Control": "text-cyan-400",
  "Aide Station": "text-emerald-400",
  "Command Post": "text-violet-400",
  "Staging": "text-amber-400",
  "Water Point": "text-blue-400",
  "Finish Line": "text-pink-400",
  "Other": "text-gray-400",
};

const empty = { name: "", station_id: "", latitude: "", longitude: "", address: "", type: "Aide Station", status: "Standby", start_datetime: "", end_datetime: "", primary_frequency_id: "", backup_frequency_id: "", assets: [], notes: "", position_source: "None", tracking_identifier: "" };

export default function AideStations() {
  const [stations, setStations] = useState([]);
  const [frequencies, setFrequencies] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [assetInput, setAssetInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [copyTimes, setCopyTimes] = useState(false);
  const { activeEventId, activeEvent } = useEvent();
  const tz = activeEvent?.timezone || "America/Phoenix";

  // Convert a UTC ISO string to a datetime-local input value in the event's timezone
  const toEventLocalInput = (iso) => {
    if (!iso) return "";
    const d = parseAsUTC(iso);
    if (!d || isNaN(d.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(d);
    const get = (type) => parts.find(p => p.type === type)?.value || "00";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
  };

  // Convert a datetime-local value (event-local time) to a UTC ISO string for storage.
  const fromEventLocalInput = (val) => {
    if (!val) return "";
    const naiveMs = new Date(val + ":00Z").getTime();
    const probe = new Date(naiveMs);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).formatToParts(probe);
    const get = (t) => parseInt(parts.find(p => p.type === t)?.value || "0");
    const tzMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    const offsetMs = tzMs - naiveMs;
    return new Date(naiveMs - offsetMs).toISOString();
  };

  const load = async () => {
    setLoading(true);
    const [all, allFreqs] = await Promise.all([
      db.aideStations.list(),
      db.frequencies.list(),
    ]);
    const filtered = activeEventId ? all.filter(s => s.event_id === activeEventId) : all;
    filtered.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    setStations(filtered);
    setFrequencies(activeEventId ? allFreqs.filter(f => f.event_id === activeEventId) : allFreqs);
    setLoading(false);
  };
  useEffect(() => { load(); }, [activeEventId]);

  const onDragEnd = async (result) => {
    if (!result.destination) return;
    const reordered = Array.from(stations);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    setStations(reordered);
    await Promise.all(reordered.map((s, i) => db.aideStations.update(s.id, { sort_order: i })));
  };

  const openNew = () => { setForm(empty); setEditing(null); setShowForm(true); setAssetInput(""); setCopyTimes(false); };
  const openEdit = (s) => {
    setForm({ ...s, assets: s.assets || [], start_datetime: toEventLocalInput(s.start_datetime), end_datetime: toEventLocalInput(s.end_datetime) });
    setEditing(s.id); setShowForm(true); setAssetInput(""); setCopyTimes(false);
  };
  const del = async (id) => { if (confirm("Delete this station?")) { await db.aideStations.delete(id); load(); } };

  const save = async () => {
    const isNoneSource = !form.position_source || form.position_source === "None";
    const data = {
      ...form,
      latitude: isNoneSource ? null : (form.latitude ? parseFloat(form.latitude) : undefined),
      longitude: isNoneSource ? null : (form.longitude ? parseFloat(form.longitude) : undefined),
      event_id: activeEventId,
    };
    // Convert event-local datetime-local strings to UTC ISO strings for storage
    if (data.start_datetime) data.start_datetime = fromEventLocalInput(data.start_datetime);
    if (data.end_datetime) data.end_datetime = fromEventLocalInput(data.end_datetime);
    if (editing) await db.aideStations.update(editing, data);
    else await db.aideStations.create(data);
    if (copyTimes && (form.start_datetime || form.end_datetime)) {
      const others = stations.filter(s => s.id !== editing && s.status !== "Closed");
      await Promise.all(others.map(s => db.aideStations.update(s.id, {
        start_datetime: data.start_datetime || s.start_datetime,
        end_datetime: data.end_datetime || s.end_datetime,
      })));
    }
    setShowForm(false); load();
  };

  const addAsset = () => { if (assetInput.trim()) { setForm(f => ({ ...f, assets: [...(f.assets || []), assetInput.trim()] })); setAssetInput(""); } };
  const removeAsset = (i) => setForm(f => ({ ...f, assets: f.assets.filter((_, idx) => idx !== i) }));

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Positions</h1>
            <p className="text-gray-500 text-sm mt-1">{stations.length} positions configured{activeEvent ? ` · ${activeEvent.name}` : ""}</p>
          </div>
          <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-semibold rounded-lg text-sm transition-all">
            <Plus className="w-4 h-4" /> Add Position
          </button>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[24px_auto_1fr_1fr_1fr_auto] px-4 py-3 border-b border-gray-800 text-xs text-gray-500 font-medium uppercase tracking-wider gap-3">
            <span></span><span>ID</span><span>Name / Type</span><span>Frequencies</span><span>Status</span><span className="text-right">Actions</span>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-600">Loading...</div>
          ) : stations.length === 0 ? (
            <div className="p-12 text-center text-gray-600">No positions yet</div>
          ) : (
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="stations">
                {(provided) => (
                  <div ref={provided.innerRef} {...provided.droppableProps}>
                    {stations.map((st, index) => (
                      <Draggable key={st.id} draggableId={st.id} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            className={`grid grid-cols-[24px_auto_1fr_1fr_1fr_auto] px-4 py-3.5 border-b border-gray-800/50 items-center gap-3 transition-colors ${snapshot.isDragging ? "bg-gray-700" : "hover:bg-gray-800/40"}`}
                          >
                            <div {...provided.dragHandleProps} className="text-gray-600 hover:text-gray-400 cursor-grab active:cursor-grabbing">
                              <GripVertical className="w-4 h-4" />
                            </div>
                            <span className="text-xs font-bold font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded whitespace-nowrap">{st.station_id}</span>
                            <div>
                              <div className="text-white font-medium text-sm">{st.name}</div>
                              <div className={`text-xs ${TYPE_COLORS[st.type] || "text-gray-400"}`}>{st.type}</div>
                            </div>
                            <div className="text-xs text-gray-400">
                              {st.primary_frequency_id ? (() => {
                                const getFreqName = (id) => {
                                  if (!id) return null;
                                  const freq = frequencies.find(f => f.id === id);
                                  return freq ? freq.name : "Unknown";
                                };
                                return (
                                  <>
                                    <div className="flex items-center gap-1"><Radio className="w-3 h-3 text-cyan-500" /><span className="text-cyan-400 font-mono">{getFreqName(st.primary_frequency_id)}</span></div>
                                    {st.backup_frequency_id && <div className="text-gray-600 font-mono">{getFreqName(st.backup_frequency_id)}</div>}
                                  </>
                                );
                              })() : "—"}
                            </div>
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs border w-fit ${STATUS_COLORS[st.status]}`}>{st.status}</span>
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => openEdit(st)} className="p-1.5 text-gray-500 hover:text-cyan-400 transition-colors"><Edit2 className="w-4 h-4" /></button>
                              <button onClick={() => del(st.id)} className="p-1.5 text-gray-500 hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          )}
        </div>
      </div>

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h2 className="text-lg font-semibold text-white">{editing ? "Edit Position" : "New Position"}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Position Name *", key: "name", placeholder: "Mile 10 Aide Station" },
                  { label: "Position ID *", key: "station_id", placeholder: "AS-10" },
                ].map(({ label, key, placeholder }) => (
                  <div key={key}>
                    <label className="text-xs text-gray-400 mb-1 block">{label}</label>
                    <input value={form[key] || ""} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
                  </div>
                ))}
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

              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Primary Frequency", key: "primary_frequency_id" },
                  { label: "Backup Frequency", key: "backup_frequency_id" },
                ].map(({ label, key }) => (
                  <div key={key}>
                    <label className="text-xs text-gray-400 mb-1 block">{label}</label>
                    <select value={form[key] || ""} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50">
                      <option value="">— None —</option>
                      {frequencies.map(freq => (
                        <option key={freq.id} value={freq.id}>
                          {freq.name} ({Number(freq.frequency_mhz).toFixed(4)} MHz{freq.tone ? ` / ${freq.tone}` : ""})
                        </option>
                      ))}
                    </select>
                    {frequencies.length === 0 && (
                      <p className="text-xs text-gray-600 mt-1">No frequencies defined for this event</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Start Date/Time</label>
                  <input type="datetime-local" value={form.start_datetime || ""} onChange={e => setForm(f => ({ ...f, start_datetime: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">End Date/Time</label>
                  <input type="datetime-local" value={form.end_datetime || ""} onChange={e => setForm(f => ({ ...f, end_datetime: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none group">
                <input type="checkbox" checked={copyTimes} onChange={e => setCopyTimes(e.target.checked)}
                  className="w-4 h-4 rounded accent-cyan-500 cursor-pointer" />
                <span className="text-xs text-gray-400 group-hover:text-gray-200 transition-colors">Copy these times to all non-closed positions</span>
              </label>

              <div>
                <label className="text-xs text-gray-400 mb-1 block">Address</label>
                <input value={form.address || ""} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Main St"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Type</label>
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
                    {["Aide Station","Net Control","Command Post","Staging","Water Point","Start Line","Finish Line","Other"].map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Status</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
                    {["Active","Standby","Closed","Requested"].map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-400 mb-1 block">Assets / Equipment</label>
                <div className="flex gap-2 mb-2">
                  <input value={assetInput} onChange={e => setAssetInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addAsset()} placeholder="e.g. AED, Stretcher, Water"
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none" />
                  <button onClick={addAsset} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-white">Add</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(form.assets || []).map((a, i) => (
                    <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300">
                      {a}<button onClick={() => removeAsset(i)} className="hover:text-red-400"><X className="w-3 h-3" /></button>
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