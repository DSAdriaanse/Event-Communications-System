import { useEffect, useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useEvent } from "@/components/EventContext";
import { Send, CheckCheck, Radio, StickyNote, CheckSquare, Zap, FileText, Pencil } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { formatEventTime } from "@/lib/eventTime";
import EditLogEntryDialog from "@/components/communications/EditLogEntryDialog";

const PRIORITY_COLORS = {
  Routine: { bg: "bg-gray-800", badge: "bg-gray-700 text-gray-300", border: "border-gray-700", label: "text-gray-400" },
  Welfare: { bg: "bg-blue-950/40", badge: "bg-blue-900/50 text-blue-300", border: "border-blue-800/30", label: "text-blue-400" },
  Priority: { bg: "bg-amber-950/40", badge: "bg-amber-900/50 text-amber-300", border: "border-amber-800/30", label: "text-amber-400" },
  Emergency: { bg: "bg-red-950/40", badge: "bg-red-900/60 text-red-200", border: "border-red-700/50", label: "text-red-400" },
};

const TYPE_STYLES = {
  communication: { icon: Radio, color: "text-cyan-400", bg: "bg-cyan-500/10", label: "Radio" },
  note: { icon: StickyNote, color: "text-yellow-400", bg: "bg-yellow-500/10", label: "Note" },
  task_completion: { icon: CheckSquare, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Task Done" },
  system_event: { icon: Zap, color: "text-violet-400", bg: "bg-violet-500/10", label: "System" },
};

const MSG_TYPES = ["Net Check-in", "Situation Report", "Resource Request", "Medical", "General", "Alert"];
const PRIORITIES = ["Routine", "Welfare", "Priority", "Emergency"];


export default function Communications() {
  const [entries, setEntries] = useState([]);
  const [stations, setStations] = useState([]);
  const [operators, setOperators] = useState([]);
  const [bulletins, setBulletins] = useState([]);
  const [filterType, setFilterType] = useState("all");
  const [filterStation, setFilterStation] = useState("All");
  const [composeMode, setComposeMode] = useState("communication"); // 'communication' | 'note'
  const [form, setForm] = useState({ from_callsign: "", from_station: "", to_station: "ALL NET", priority: "Routine", message_type: "General", content: "" });
  const [noteContent, setNoteContent] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingEntry, setEditingEntry] = useState(null);
  const bottomRef = useRef(null);
  const { activeEventId, activeEvent } = useEvent();
  const tz = activeEvent?.timezone || "America/Phoenix";

  const load = async () => {
    if (!activeEventId) { setLoading(false); return; }
    const [logs, sts, ops, bltns] = await Promise.all([
      base44.entities.EventLog.filter({ event_id: activeEventId }, "-created_date", 500),
      base44.entities.AideStation.filter({ event_id: activeEventId }),
      base44.entities.Operator.filter({ event_id: activeEventId }),
      base44.entities.Bulletin.filter({ event_id: activeEventId }, "-created_date"),
    ]);
    setEntries([...logs].reverse());
    setStations(sts);
    setOperators(ops);
    setBulletins(bltns);
    setLoading(false);
  };

  useEffect(() => {
    setForm(f => ({ ...f, from_callsign: "", from_station: "" }));
    load();
  }, [activeEventId]);

  useEffect(() => {
    const savedFrom = localStorage.getItem("ecs_from");
    if (savedFrom && !form.from_callsign && !form.from_station) {
      const station = stations.find(s => s.name === savedFrom);
      const operator = operators.find(o => o.callsign === savedFrom);
      if (station) setForm(f => ({ ...f, from_station: station.name }));
      else if (operator) setForm(f => ({ ...f, from_callsign: operator.callsign }));
    }
  }, [stations, operators]);

  useEffect(() => {
    const unsub = base44.entities.EventLog.subscribe((event) => {
      if (event.type === "create") {
        if (!activeEventId || event.data.event_id === activeEventId)
          setEntries(prev => [...prev, event.data]);
      } else if (event.type === "update") {
        setEntries(prev => prev.map(e => e.id === event.id ? event.data : e));
      } else if (event.type === "delete") {
        setEntries(prev => prev.filter(e => e.id !== event.id));
      }
    });
    return unsub;
  }, [activeEventId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [entries]);

  const sendCommunication = async () => {
    if (!form.content.trim() || !(form.from_callsign.trim() || form.from_station.trim())) return;
    setSending(true);
    await base44.entities.EventLog.create({ ...form, type: "communication", event_id: activeEventId });
    setForm(f => ({ ...f, content: "" }));
    setSending(false);
  };

  const sendNote = async () => {
    if (!noteContent.trim()) return;
    setSending(true);
    await base44.entities.EventLog.create({
      event_id: activeEventId,
      type: "note",
      content: noteContent.trim(),
      priority: "Routine",
    });
    setNoteContent("");
    setSending(false);
  };

  const ack = async (entry) => {
    await base44.entities.EventLog.update(entry.id, { acknowledged: true, acknowledged_by: form.from_callsign || form.from_station || "NCO" });
  };

  const saveEdit = async (id, data) => {
    await base44.entities.EventLog.update(id, data);
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...data } : e));
  };

  const deleteEntry = async (id) => {
    await base44.entities.EventLog.delete(id);
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const filtered = entries.filter(e => {
    const typeMatch = filterType === "all" || e.type === filterType;
    const stationMatch = filterStation === "All" || e.from_station === filterStation || e.to_station === filterStation || e.to_station === "ALL NET";
    return typeMatch && stationMatch;
  });

  const unackedComms = entries.filter(e => e.type === "communication" && !e.acknowledged && (e.priority === "Emergency" || e.priority === "Priority"));

  const bulletinByLogId = Object.fromEntries(bulletins.filter(b => b.event_log_id).map(b => [b.event_log_id, b]));

  return (
    <div className="h-screen bg-gray-950 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-none px-6 py-4 border-b border-gray-800 bg-gray-900 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
            <Radio className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-white font-bold">Communications</h1>
            <p className="text-gray-500 text-xs">{entries.length} entries{activeEvent ? ` · ${activeEvent.name}` : ""}{unackedComms.length > 0 ? ` · ${unackedComms.length} unacked` : ""}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Link to={createPageUrl("IssueBulletin")}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-500/15 hover:bg-violet-500/25 text-violet-400 border border-violet-500/30 rounded-lg text-xs font-semibold transition-all">
            <FileText className="w-3.5 h-3.5" /> Issue General Bulletin
          </Link>
          {/* Type filter */}
          <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1">
            {[["all", "All"], ["communication", "Radio"], ["note", "Notes"], ["task_completion", "Tasks"]].map(([val, label]) => (
              <button key={val} onClick={() => setFilterType(val)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${filterType === val ? "bg-cyan-500 text-gray-950" : "text-gray-400 hover:text-white"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Station:</label>
            <select value={filterStation} onChange={e => setFilterStation(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none">
              <option>All</option>
              {stations.map(s => <option key={s.id}>{s.name}</option>)}
            </select>
          </div>

        </div>
      </div>

      {/* Log */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
        {loading ? (
          <div className="text-center text-gray-600 pt-12">Loading event log...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-gray-700 pt-20">
            <Radio className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No entries yet.</p>
          </div>
        ) : (
          filtered.map(entry => {
            const typeStyle = TYPE_STYLES[entry.type] || TYPE_STYLES.communication;
            const TypeIcon = typeStyle.icon;

            if (entry.type === "note") {
              return (
                <div key={entry.id} className="rounded-xl px-4 py-3 border border-yellow-700/30 bg-yellow-900/10">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <StickyNote className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
                      <span className="text-xs font-semibold text-yellow-400">NCO NOTE</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => setEditingEntry(entry)} className="text-gray-600 hover:text-yellow-400 transition-colors p-0.5" title="Edit note">
                        <Pencil className="w-3 h-3" />
                      </button>
                      <span className="text-xs text-gray-600">{formatEventTime(entry.created_date, tz)}</span>
                    </div>
                  </div>
                  <p className="text-gray-200 text-sm mt-2 leading-relaxed whitespace-pre-line">{entry.content}</p>
                </div>
              );
            }

            if (entry.type === "task_completion") {
              return (
                <div key={entry.id} className="rounded-xl px-4 py-3 border border-emerald-700/30 bg-emerald-900/10">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <CheckSquare className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                      <span className="text-xs font-semibold text-emerald-400">TASK COMPLETED</span>
                      <span className="text-sm text-white font-medium">{entry.task_label}</span>
                    </div>
                    <span className="text-xs text-gray-600 flex-shrink-0">{formatEventTime(entry.created_date, tz)}</span>
                  </div>
                  {entry.content && entry.content !== entry.task_label && (
                    <p className="text-gray-400 text-xs mt-1 ml-6 whitespace-pre-line">{entry.content}</p>
                  )}
                </div>
              );
            }

            if (entry.type === "system_event") {
              const linkedBulletin = bulletinByLogId[entry.id];
              return (
                <div key={entry.id}
                  className={`rounded-xl px-4 py-3 border border-violet-700/30 bg-violet-900/10 ${linkedBulletin ? "cursor-pointer hover:border-violet-500/50 hover:bg-violet-900/20 transition-all" : ""}`}
                  onClick={linkedBulletin ? () => window.open(`/BulletinView/${linkedBulletin.id}`, "_blank") : undefined}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Zap className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
                      <span className="text-xs font-semibold text-violet-400 flex-shrink-0">SYSTEM</span>
                      <span className="text-sm text-gray-300 truncate">{entry.content}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {linkedBulletin && <span className="text-xs text-violet-400 hover:underline whitespace-nowrap">View →</span>}
                      <span className="text-xs text-gray-600">{formatEventTime(entry.created_date, tz)}</span>
                    </div>
                  </div>
                </div>
              );
            }

            // Default: communication
            const colors = PRIORITY_COLORS[entry.priority] || PRIORITY_COLORS.Routine;
            return (
              <div key={entry.id} className={`rounded-xl px-4 py-3 border ${colors.bg} ${colors.border} transition-all`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-bold font-mono text-sm">{entry.from_callsign || entry.from_station}</span>
                    <span className="text-gray-500 text-xs">→</span>
                    <span className={`text-sm font-medium ${entry.to_station === "ALL NET" ? "text-cyan-300" : "text-gray-300"}`}>{entry.to_station}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors.badge}`}>{entry.priority}</span>
                    <span className="text-xs text-gray-600 bg-gray-800 px-2 py-0.5 rounded">{entry.message_type}</span>
                    {entry.from_callsign && entry.from_station && <span className="text-xs text-gray-600">from {entry.from_station}</span>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {entry.acknowledged ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCheck className="w-3 h-3" /> ACK</span>
                    ) : (
                      <button onClick={() => ack(entry)} className="text-xs text-gray-500 hover:text-cyan-400 border border-gray-700 hover:border-cyan-500/40 px-2 py-0.5 rounded transition-all">ACK</button>
                    )}
                    <button onClick={() => setEditingEntry(entry)} className="text-gray-600 hover:text-cyan-400 transition-colors p-0.5" title="Edit entry">
                      <Pencil className="w-3 h-3" />
                    </button>
                    <span className="text-xs text-gray-600">{formatEventTime(entry.created_date, tz)}</span>
                  </div>
                </div>
                <p className="text-gray-200 text-sm mt-2 leading-relaxed whitespace-pre-line">{entry.content}</p>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <EditLogEntryDialog
        entry={editingEntry}
        stations={stations}
        operators={operators}
        onClose={() => setEditingEntry(null)}
        onSave={saveEdit}
        onDelete={deleteEntry}
      />

      {/* Compose panel */}
      <div className="flex-none bg-gray-900 border-t border-gray-800 px-6 py-4">
        <div className="max-w-4xl mx-auto space-y-3">
          {/* Mode toggle */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1">
              <button onClick={() => setComposeMode("communication")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all ${composeMode === "communication" ? "bg-cyan-500 text-gray-950" : "text-gray-400 hover:text-white"}`}>
                <Radio className="w-3 h-3" /> Radio Traffic
              </button>
              <button onClick={() => setComposeMode("note")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all ${composeMode === "note" ? "bg-yellow-500 text-gray-950" : "text-gray-400 hover:text-white"}`}>
                <StickyNote className="w-3 h-3" /> NCO Note
              </button>
            </div>
          </div>

          {composeMode === "note" ? (
            <div className="flex gap-3 items-end">
              <textarea
                value={noteContent}
                onChange={e => setNoteContent(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendNote(); } }}
                placeholder="Add a note to the event log... (Enter to save)"
                rows={2}
                className="flex-1 bg-gray-800 border border-yellow-700/40 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none resize-none focus:border-yellow-500/50"
              />
              <button onClick={sendNote} disabled={sending || !noteContent.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-700 disabled:text-gray-500 text-gray-950 font-semibold rounded-lg text-sm transition-all">
                <StickyNote className="w-4 h-4" />
                {sending ? "..." : "Log Note"}
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">From</label>
                  <select value={form.from_callsign || form.from_station || ""} onChange={e => {
                      const val = e.target.value;
                      localStorage.setItem("ecs_from", val);
                      const station = stations.find(s => s.name === val);
                      const operator = operators.find(o => o.callsign === val);
                      if (station) setForm(f => ({ ...f, from_station: station.name, from_callsign: "" }));
                      else if (operator) setForm(f => ({ ...f, from_callsign: operator.callsign, from_station: "" }));
                      else setForm(f => ({ ...f, from_callsign: "", from_station: "" }));
                    }}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500/50">
                    <option value="">— Select —</option>
                    <optgroup label="Aide Stations">
                      {[...stations].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map(s => <option key={s.id} value={s.name}>{s.station_id} – {s.name}</option>)}
                    </optgroup>
                    <optgroup label="Operators">
                      {[...operators].sort((a, b) => a.callsign.localeCompare(b.callsign)).map(o => <option key={o.id} value={o.callsign}>{o.callsign} – {o.full_name}</option>)}
                    </optgroup>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">To</label>
                  <select value={form.to_station} onChange={e => setForm(f => ({ ...f, to_station: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500/50">
                    <option>ALL NET</option>
                    <optgroup label="Aide Stations">
                      {[...stations].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map(s => <option key={s.id} value={s.name}>{s.station_id} – {s.name}</option>)}
                    </optgroup>
                    <optgroup label="Operators">
                      {[...operators].sort((a, b) => a.callsign.localeCompare(b.callsign)).map(o => <option key={o.id} value={o.callsign}>{o.callsign} – {o.full_name}</option>)}
                    </optgroup>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Priority</label>
                  <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                    className={`w-full bg-gray-800 border rounded-lg px-3 py-2 text-xs text-white focus:outline-none ${form.priority === "Emergency" ? "border-red-600" : form.priority === "Priority" ? "border-amber-600" : "border-gray-700"}`}>
                    {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <label className="text-xs text-gray-500">Message</label>
                    <select value={form.message_type} onChange={e => setForm(f => ({ ...f, message_type: e.target.value }))}
                      className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-400 focus:outline-none">
                      {MSG_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendCommunication(); } }}
                    placeholder="Type your transmission... (Enter to send)"
                    rows={2}
                    className={`w-full bg-gray-800 border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none resize-none transition-colors ${form.priority === "Emergency" ? "border-red-600/70 focus:border-red-500" : "border-gray-700 focus:border-cyan-500/50"}`} />
                </div>
                <button onClick={sendCommunication} disabled={sending || !form.content.trim() || !form.from_callsign}
                  className="flex items-center gap-2 px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 disabled:text-gray-500 text-gray-950 font-semibold rounded-lg text-sm transition-all">
                  <Send className="w-4 h-4" />
                  {sending ? "..." : "Send"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}