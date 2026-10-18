import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2, Save } from "lucide-react";

const PRIORITIES = ["Routine", "Welfare", "Priority", "Emergency"];
const MSG_TYPES = ["Net Check-in", "Situation Report", "Resource Request", "Medical", "General", "Alert"];

export default function EditLogEntryDialog({ entry, stations, operators, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (entry) {
      setForm({
        content: entry.content || "",
        from_callsign: entry.from_callsign || "",
        from_station: entry.from_station || "",
        to_station: entry.to_station || "ALL NET",
        priority: entry.priority || "Routine",
        message_type: entry.message_type || "General",
        acknowledged: entry.acknowledged || false,
      });
      setConfirmDelete(false);
    }
  }, [entry]);

  if (!entry || !form) return null;

  const sortedStations = [...stations].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const sortedOperators = [...operators].sort((a, b) => (a.callsign || "").localeCompare(b.callsign || ""));

  const handleSave = async () => {
    await onSave(entry.id, form);
    onClose();
  };

  const handleDelete = async () => {
    await onDelete(entry.id);
    onClose();
  };

  return (
    <Dialog open={!!entry} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            Edit Log Entry
            <span className="text-xs text-gray-500 font-mono font-normal">{entry.type}</span>
          </DialogTitle>
        </DialogHeader>

        {!confirmDelete ? (
          <div className="space-y-4">
            {entry.type === "note" ? (
              <div className="text-xs text-gray-400 bg-yellow-900/20 border border-yellow-700/30 rounded-lg px-3 py-2">
                Editing NCO Note — only the content field applies.
              </div>
            ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">From</label>
                <select value={form.from_callsign || form.from_station || ""} onChange={(e) => {
                  const val = e.target.value;
                  const station = stations.find(s => s.name === val);
                  const operator = operators.find(o => o.callsign === val);
                  if (station) setForm(f => ({ ...f, from_station: station.name, from_callsign: "" }));
                  else if (operator) setForm(f => ({ ...f, from_callsign: operator.callsign, from_station: "" }));
                  else setForm(f => ({ ...f, from_callsign: "", from_station: "" }));
                }} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500/50">
                  <option value="">— None —</option>
                  <optgroup label="Aide Stations">
                    {sortedStations.map(s => <option key={s.id} value={s.name}>{s.station_id} – {s.name}</option>)}
                  </optgroup>
                  <optgroup label="Operators">
                    {sortedOperators.map(o => <option key={o.id} value={o.callsign}>{o.callsign} – {o.full_name}</option>)}
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">To</label>
                <select value={form.to_station} onChange={(e) => setForm(f => ({ ...f, to_station: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500/50">
                  <option>ALL NET</option>
                  <optgroup label="Aide Stations">
                    {sortedStations.map(s => <option key={s.id} value={s.name}>{s.station_id} – {s.name}</option>)}
                  </optgroup>
                  <optgroup label="Operators">
                    {sortedOperators.map(o => <option key={o.id} value={o.callsign}>{o.callsign} – {o.full_name}</option>)}
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Priority</label>
                <select value={form.priority} onChange={(e) => setForm(f => ({ ...f, priority: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none">
                  {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Message Type</label>
                <select value={form.message_type} onChange={(e) => setForm(f => ({ ...f, message_type: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none">
                  {MSG_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
            )}

            <div>
              <label className="text-xs text-gray-500 mb-1 block">Content</label>
              <textarea value={form.content} onChange={(e) => setForm(f => ({ ...f, content: e.target.value }))} rows={4}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50 resize-none" />
            </div>

            {entry.type !== "note" && (
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
              <input type="checkbox" checked={form.acknowledged} onChange={(e) => setForm(f => ({ ...f, acknowledged: e.target.checked }))} className="accent-cyan-500" />
              Acknowledged
            </label>
            )}

            <DialogFooter className="flex justify-between gap-2 sm:justify-between">
              <Button variant="destructive" onClick={() => setConfirmDelete(true)} className="bg-red-600 hover:bg-red-500 text-white">
                <Trash2 className="w-4 h-4 mr-1" /> Delete
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose} className="bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700">Cancel</Button>
                <Button onClick={handleSave} className="bg-cyan-500 hover:bg-cyan-400 text-gray-950">
                  <Save className="w-4 h-4 mr-1" /> Save
                </Button>
              </div>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="text-center">
              <Trash2 className="w-10 h-10 text-red-500 mx-auto mb-3" />
              <h3 className="text-white font-semibold">Delete this log entry?</h3>
              <p className="text-gray-500 text-xs mt-1">This action cannot be undone.</p>
              <div className="mt-3 bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 text-left max-h-24 overflow-y-auto">
                {entry.content}
              </div>
            </div>
            <DialogFooter className="flex justify-between gap-2 sm:justify-between">
              <Button variant="outline" onClick={() => setConfirmDelete(false)} className="bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700">Cancel</Button>
              <Button variant="destructive" onClick={handleDelete} className="bg-red-600 hover:bg-red-500 text-white">
                <Trash2 className="w-4 h-4 mr-1" /> Confirm Delete
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}