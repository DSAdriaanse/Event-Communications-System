import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useEvent } from "@/components/EventContext";
import { Plus, Edit2, Trash2, X, Save, Zap, Download, GripVertical } from "lucide-react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";

const USE_COLORS = {
  "Primary Net": "text-cyan-400",
  "Tactical": "text-emerald-400",
  "Emergency": "text-red-400",
  "Simplex": "text-blue-400",
  "Repeater": "text-violet-400",
  "Interop": "text-amber-400",
  "Other": "text-gray-400",
};

const empty = { name: "", frequency_mhz: "", tone: "", mode: "FM", use: "Primary Net", repeater_offset: "", remarks: "", notes: "" };

function exportICS205A(freqs, event) {
  const date = event?.date || new Date().toISOString().split("T")[0];
  const incidentName = event?.incident_name || event?.name || "Unknown";
  const preparedBy = event?.net_control_callsign || "";

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>ICS 205A - ${incidentName}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11pt; margin: 20mm; color: #000; }
  h2 { text-align: center; margin: 0 0 4px; font-size: 14pt; }
  .subtitle { text-align: center; font-size: 10pt; color: #444; margin-bottom: 16px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 16px; font-size: 10pt; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th { background: #1a1a2e; color: #fff; padding: 6px 8px; text-align: left; border: 1px solid #333; }
  td { padding: 5px 8px; border: 1px solid #bbb; vertical-align: top; }
  tr:nth-child(even) td { background: #f5f5f5; }
  .footer { margin-top: 12px; font-size: 9pt; color: #666; text-align: right; }
  @media print { body { margin: 10mm; } }
</style></head><body>
<h2>ICS 205A — Communications List</h2>
<div class="subtitle">SWCRS Event Communications Suite</div>
<div class="meta">
  <span><strong>Incident Name:</strong> ${incidentName}</span>
  <span><strong>Date Prepared:</strong> ${date}</span>
  <span><strong>Prepared By (NCS):</strong> ${preparedBy}</span>
</div>
<table>
  <thead><tr><th>#</th><th>Function/Channel</th><th>Freq (MHz)</th><th>Tone/NAC</th><th>Offset</th><th>Mode</th><th>Use</th><th>Remarks</th></tr></thead>
  <tbody>
    ${freqs.map((f, i) => `<tr>
      <td>${i + 1}</td>
      <td>${f.name}</td>
      <td style="font-family:monospace">${Number(f.frequency_mhz).toFixed(4)}</td>
      <td>${f.tone || ""}</td>
      <td>${f.repeater_offset || "Simplex"}</td>
      <td>${f.mode}</td>
      <td>${f.use}</td>
      <td>${f.remarks || f.notes || ""}</td>
    </tr>`).join("")}
  </tbody>
</table>
<div class="footer">SWCRS Event Communications Suite &mdash; ICS 205A</div>
<script>window.onload = () => { window.print(); }<\/script>
</body></html>`;

  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
}

export default function Frequencies() {
  const [freqs, setFreqs] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(true);
  const { activeEventId, activeEvent } = useEvent();

  const load = async () => {
    setLoading(true);
    const all = await base44.entities.Frequency.list();
    const filtered = activeEventId ? all.filter(f => f.event_id === activeEventId) : all;
    filtered.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    setFreqs(filtered);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeEventId]);

  const onDragEnd = async (result) => {
    if (!result.destination) return;
    const reordered = Array.from(freqs);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    setFreqs(reordered);
    await Promise.all(reordered.map((f, i) => base44.entities.Frequency.update(f.id, { sort_order: i })));
  };

  const openNew = () => { setForm(empty); setEditing(null); setShowForm(true); };
  const openEdit = (f) => { setForm({ ...f }); setEditing(f.id); setShowForm(true); };
  const del = async (id) => { if (confirm("Delete?")) { await base44.entities.Frequency.delete(id); load(); } };

  const save = async () => {
    const data = { ...form, frequency_mhz: parseFloat(form.frequency_mhz), event_id: activeEventId };
    if (editing) await base44.entities.Frequency.update(editing, data);
    else await base44.entities.Frequency.create(data);
    setShowForm(false);
    load();
  };

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Frequencies</h1>
            <p className="text-gray-500 text-sm mt-1">{freqs.length} frequencies configured{activeEvent ? ` · ${activeEvent.name}` : ""}</p>
          </div>
          <div className="flex items-center gap-2">
            {freqs.length > 0 && (
              <button onClick={() => exportICS205A(freqs, activeEvent)}
                className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 font-medium rounded-lg text-sm transition-all">
                <Download className="w-4 h-4" /> ICS-205A
              </button>
            )}
            <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-semibold rounded-lg text-sm transition-all">
              <Plus className="w-4 h-4" /> Add Frequency
            </button>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[24px_1fr_1fr_1fr_1fr_1fr_auto] px-4 py-3 border-b border-gray-800 text-xs text-gray-500 font-medium uppercase tracking-wider gap-3">
            <span></span><span>Name</span><span>Freq (MHz)</span><span>Tone</span><span>Mode</span><span>Use</span><span className="text-right">Actions</span>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-600">Loading...</div>
          ) : freqs.length === 0 ? (
            <div className="p-12 text-center text-gray-600">No frequencies yet</div>
          ) : (
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="freqs">
                {(provided) => (
                  <div ref={provided.innerRef} {...provided.droppableProps}>
                    {freqs.map((f, index) => (
                      <Draggable key={f.id} draggableId={f.id} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            className={`grid grid-cols-[24px_1fr_1fr_1fr_1fr_1fr_auto] px-4 py-3.5 border-b border-gray-800/50 items-center gap-3 transition-colors ${snapshot.isDragging ? "bg-gray-700" : "hover:bg-gray-800/40"}`}
                          >
                            <div {...provided.dragHandleProps} className="text-gray-600 hover:text-gray-400 cursor-grab active:cursor-grabbing">
                              <GripVertical className="w-4 h-4" />
                            </div>
                            <span className="text-white font-medium text-sm">{f.name}</span>
                            <span className="text-cyan-400 font-mono font-bold text-sm">{Number(f.frequency_mhz).toFixed(4)}</span>
                            <span className="text-gray-400 text-sm">{f.tone || "—"}</span>
                            <span className="text-gray-400 text-sm">{f.mode}</span>
                            <span className={`text-sm font-medium ${USE_COLORS[f.use] || "text-gray-400"}`}>{f.use}</span>
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => openEdit(f)} className="p-1.5 text-gray-500 hover:text-cyan-400 transition-colors"><Edit2 className="w-4 h-4" /></button>
                              <button onClick={() => del(f.id)} className="p-1.5 text-gray-500 hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
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

      {showForm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h2 className="text-lg font-semibold text-white">{editing ? "Edit Frequency" : "New Frequency"}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Name *", key: "name", placeholder: "Primary Net" },
                  { label: "Frequency (MHz) *", key: "frequency_mhz", placeholder: "146.5200" },
                  { label: "CTCSS/DCS Tone", key: "tone", placeholder: "100.0" },
                  { label: "Repeater Offset", key: "repeater_offset", placeholder: "+0.600" },
                  { label: "Remarks", key: "remarks", placeholder: "" },
                ].map(({ label, key, placeholder }) => (
                  <div key={key} className={key === "remarks" ? "col-span-2" : ""}>
                    <label className="text-xs text-gray-400 mb-1 block">{label}</label>
                    <input value={form[key] || ""} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Mode</label>
                  <select value={form.mode} onChange={e => setForm(f => ({ ...f, mode: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
                    {["FM","AM","SSB","DMR","P25","FRS","GMRS","Other"].map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Use</label>
                  <select value={form.use} onChange={e => setForm(f => ({ ...f, use: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
                    {["Primary Net","Tactical","Emergency","Simplex","Repeater","Interop","Other"].map(v => <option key={v}>{v}</option>)}
                  </select>
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