import { useState } from "react";
import { db } from "@/api/ecs";
import { X, Save } from "lucide-react";

export default function BibAddModal({ eventId, onClose, onSaved }) {
  const [form, setForm] = useState({ bib_number: "", runner_name: "", notes: "", status: "Active" });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.bib_number.trim() || !form.runner_name.trim()) return;
    setSaving(true);
    await db.participants.create({ ...form, event_id: eventId });
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">Add Participant</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {[
            { label: "Bib # *", key: "bib_number", placeholder: "e.g. 42" },
            { label: "Runner Name *", key: "runner_name", placeholder: "Jane Doe" },
          ].map(({ label, key, placeholder }) => (
            <div key={key}>
              <label className="text-xs text-gray-400 mb-1 block">{label}</label>
              <input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
            </div>
          ))}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Status</label>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
              {["Active", "DNS", "DNF", "Completed", "Withdrawn"].map(v => <option key={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none resize-none" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button onClick={save} disabled={!form.bib_number.trim() || !form.runner_name.trim() || saving}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-gray-950 font-semibold rounded-lg text-sm">
            <Save className="w-4 h-4" /> Save
          </button>
        </div>
      </div>
    </div>
  );
}