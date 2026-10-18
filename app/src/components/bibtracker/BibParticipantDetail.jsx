import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { X, Edit2, Save, Trash2, MapPin, XCircle, CheckCircle, Clock, AlertTriangle } from "lucide-react";
import { formatEventDateTime, formatEventTime } from "@/lib/eventTime";

const STATUS_STYLE = {
  Active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  DNS: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  DNF: "bg-red-500/10 text-red-400 border-red-500/20",
  Completed: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  Withdrawn: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

const UPDATE_ICON = {
  Seen: <MapPin className="w-3.5 h-3.5 text-emerald-400" />,
  DNS: <XCircle className="w-3.5 h-3.5 text-amber-400" />,
  DNF: <XCircle className="w-3.5 h-3.5 text-red-400" />,
  Completed: <CheckCircle className="w-3.5 h-3.5 text-cyan-400" />,
  Comment: <Clock className="w-3.5 h-3.5 text-gray-400" />,
  Withdrawn: <XCircle className="w-3.5 h-3.5 text-gray-400" />,
};

export default function BibParticipantDetail({ participant, updates, onClose, onRefresh, onDelete, tz = "America/Phoenix" }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ bib_number: participant.bib_number, runner_name: participant.runner_name, notes: participant.notes || "" });
  const [editingUpdate, setEditingUpdate] = useState(null);
  const [editUpdateForm, setEditUpdateForm] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const sorted = [...updates].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const saveParticipant = async () => {
    await base44.entities.Participant.update(participant.id, form);
    setEditing(false);
    onRefresh();
  };

  const deleteUpdate = async (upd) => {
    if (!confirm("Delete this history entry?")) return;
    await base44.entities.ParticipantStatusUpdate.delete(upd.id);
    onRefresh();
  };

  const startEditUpdate = (upd) => {
    setEditingUpdate(upd.id);
    setEditUpdateForm({ comment: upd.comment || "", aide_station_name: upd.aide_station_name || "", update_type: upd.update_type });
  };

  const saveUpdate = async (upd) => {
    await base44.entities.ParticipantStatusUpdate.update(upd.id, editUpdateForm);
    setEditingUpdate(null);
    onRefresh();
  };

  return (
    // Full-screen modal overlay
    <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <span className="text-cyan-400 font-mono font-bold text-2xl">#{participant.bib_number}</span>
            <span className={`px-2.5 py-0.5 rounded-full text-sm border ${STATUS_STYLE[participant.status] || ""}`}>{participant.status}</span>
          </div>
          <div className="flex items-center gap-2">
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 rounded-lg transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete Bib
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-red-900/30 border border-red-500/30 rounded-lg px-3 py-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                <span className="text-xs text-red-300">Are you sure?</span>
                <button onClick={onDelete} className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded">Yes, delete</button>
                <button onClick={() => setConfirmDelete(false)} className="text-xs text-gray-400 hover:text-white">Cancel</button>
              </div>
            )}
            <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors ml-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Participant info */}
          <div className="px-6 py-4 border-b border-gray-800">
            {editing ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500">Bib #</label>
                    <input value={form.bib_number} onChange={e => setForm(f => ({ ...f, bib_number: e.target.value }))}
                      className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Runner Name</label>
                    <input value={form.runner_name} onChange={e => setForm(f => ({ ...f, runner_name: e.target.value }))}
                      className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Notes</label>
                  <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none resize-none" />
                </div>
                <div className="flex gap-2">
                  <button onClick={saveParticipant} className="flex items-center gap-1.5 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-semibold rounded-lg text-sm">
                    <Save className="w-3.5 h-3.5" /> Save
                  </button>
                  <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-white font-semibold text-lg">{participant.runner_name}</p>
                  {participant.current_location_name && (
                    <p className="text-sm text-gray-400 mt-1 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" /> Last seen at <span className="text-gray-300 font-medium">{participant.current_location_name}</span>
                    </p>
                  )}
                  {participant.last_update_date && (
                    <p className="text-xs text-gray-600 mt-1">
                      Updated: {formatEventDateTime(participant.last_update_date, tz)}
                    </p>
                  )}
                  {participant.notes && (
                    <p className="text-sm text-amber-300/80 mt-2 italic bg-amber-500/5 border border-amber-500/10 rounded-lg px-3 py-1.5">{participant.notes}</p>
                  )}
                </div>
                <button
                  onClick={() => { setEditing(true); setForm({ bib_number: participant.bib_number, runner_name: participant.runner_name, notes: participant.notes || "" }); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-cyan-400 hover:bg-gray-800 rounded-lg transition-all flex-shrink-0"
                >
                  <Edit2 className="w-3.5 h-3.5" /> Edit
                </button>
              </div>
            )}
          </div>

          {/* History */}
          <div className="px-6 py-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">History ({updates.length})</p>
            {sorted.length === 0 ? (
              <p className="text-sm text-gray-600 italic">No updates recorded.</p>
            ) : (
              <div className="space-y-2">
                {sorted.map(upd => (
                  <div key={upd.id} className="bg-gray-800 rounded-lg px-4 py-3 text-sm">
                    {editingUpdate === upd.id ? (
                      <div className="space-y-2">
                        <select value={editUpdateForm.update_type} onChange={e => setEditUpdateForm(f => ({ ...f, update_type: e.target.value }))}
                          className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none">
                          {["Seen","DNS","DNF","Completed","Comment","Withdrawn"].map(v => <option key={v}>{v}</option>)}
                        </select>
                        {editUpdateForm.update_type === "Seen" && (
                          <input value={editUpdateForm.aide_station_name} onChange={e => setEditUpdateForm(f => ({ ...f, aide_station_name: e.target.value }))}
                            placeholder="Station name"
                            className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none" />
                        )}
                        <input value={editUpdateForm.comment} onChange={e => setEditUpdateForm(f => ({ ...f, comment: e.target.value }))}
                          placeholder="Comment"
                          className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none" />
                        <div className="flex gap-2">
                          <button onClick={() => saveUpdate(upd)} className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-semibold rounded text-xs">Save</button>
                          <button onClick={() => setEditingUpdate(null)} className="text-gray-400 hover:text-white text-xs">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <span className="mt-0.5 flex-shrink-0">{UPDATE_ICON[upd.update_type] || UPDATE_ICON["Comment"]}</span>
                          <div className="min-w-0">
                            <span className="font-semibold text-white">{upd.update_type}</span>
                            {upd.aide_station_name && <span className="text-gray-400"> @ {upd.aide_station_name}</span>}
                            {upd.comment && <p className="text-gray-400 mt-0.5 italic text-sm">{upd.comment}</p>}
                            <p className="text-gray-600 text-xs mt-0.5">{formatEventDateTime(upd.timestamp, tz)}</p>
                          </div>
                        </div>
                        <div className="flex gap-1.5 flex-shrink-0">
                          <button onClick={() => startEditUpdate(upd)} className="p-1 text-gray-600 hover:text-cyan-400 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                          <button onClick={() => deleteUpdate(upd)} className="p-1 text-gray-600 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}