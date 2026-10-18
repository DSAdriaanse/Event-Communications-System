import { useEffect, useState } from "react";
import { db } from "@/api/ecs";
import { pb, ecsLogin, fetchPublicEvents } from "@/api/pb";
import { Radio, MapPin, Hash, Loader2, Plus, List, Search, Lock, LogOut, Eye, EyeOff, ChevronDown } from "lucide-react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const TABS = [
  { id: "bib",      label: "Bib Entry",  icon: Hash },
  { id: "request",  label: "Request",    icon: Plus },
  { id: "requests", label: "View Reqs",  icon: List },
  { id: "lookup",   label: "Lookup",     icon: Search },
];

const REQ_TYPES = ["SAG", "Food", "Water", "Medical", "Logistics", "Personnel", "Equipment", "Information", "Other"];
const REQ_PRIORITIES = ["Routine", "Urgent", "Emergency"];

const STATUS_COLOR = {
  Pending: "text-yellow-400", Approved: "text-blue-400",
  "En Route": "text-cyan-400", Fulfilled: "text-green-400", Cancelled: "text-gray-500",
};
const PRIORITY_COLOR = { Routine: "text-gray-400", Urgent: "text-amber-400", Emergency: "text-red-400" };



// ─── BIB ENTRY TAB ────────────────────────────────────────────────────────────
function BibEntryTab({ stations, participants, activeEventId, setParticipants, lockedStationId, lockedCallsign }) {
  const [bib, setBib] = useState("");
  const [comment, setComment] = useState("");
  const [station, setStation] = useState(lockedStationId || localStorage.getItem("ecs_bib_station") || "");
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);

  const matched = participants.find(p => p.bib_number === bib.trim());

  const press = async (updateType) => {
    const bibNum = bib.trim();
    if (!bibNum) return;
    if (!station) { setFlash({ type: "error", msg: "Please select your station first." }); setTimeout(() => setFlash(null), 2500); return; }
    setSubmitting(true);
    const st = stations.find(s => s.id === station);
    let participant = matched;
    if (!participant) {
      participant = await db.participants.create({
        event_id: activeEventId, bib_number: bibNum, runner_name: "Unknown",
        status: updateType === "Seen" ? "Active" : updateType,
        current_location_name: st?.name || null, current_location_station_id: st?.id || null,
        last_update_date: new Date().toISOString(),
      });
    } else {
      const newStatus = updateType === "Seen"
        ? (participant.status === "Active" || !participant.status ? "Active" : participant.status)
        : updateType;
      await db.participants.update(participant.id, {
        status: newStatus,
        current_location_name: updateType === "Seen" ? st?.name : participant.current_location_name,
        current_location_station_id: updateType === "Seen" ? st?.id : participant.current_location_station_id,
        last_update_date: new Date().toISOString(),
      });
    }
    await db.participantStatusUpdates.create({
      event_id: activeEventId, participant_id: participant.id, bib_number: bibNum,
      update_type: updateType, aide_station_id: st?.id || null, aide_station_name: st?.name || null,
      timestamp: new Date().toISOString(),
      comment: comment.trim() || undefined,
    });
    setFlash({ type: updateType, bib: bibNum, name: matched?.runner_name });
    setBib(""); setComment(""); setConfirmAction(null); setSubmitting(false);
    db.participants.filter({ event_id: activeEventId }).then(setParticipants);
    setTimeout(() => setFlash(null), 2500);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className={`flex items-center gap-2 bg-gray-900 border rounded-xl px-3 py-2.5 ${!station ? "border-red-500/60" : "border-gray-800"}`}>
        <MapPin className={`w-4 h-4 flex-shrink-0 ${!station ? "text-red-400" : "text-gray-500"}`} />
        {lockedStationId ? (
          <div className="flex-1 flex items-center justify-between">
            <span className="text-white text-base">{stations.find(s => s.id === lockedStationId)?.name || "Locked Station"}</span>
            <Lock className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
          </div>
        ) : (
          <select value={station} onChange={e => { localStorage.setItem("ecs_bib_station", e.target.value); setStation(e.target.value); }}
            className="flex-1 bg-transparent text-white text-base focus:outline-none appearance-none">
            <option value="">— My Station (required) —</option>
            {stations.map(s => <option key={s.id} value={s.id}>{s.station_id} – {s.name}</option>)}
          </select>
        )}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-4 text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Hash className="w-5 h-5 text-gray-600" />
          <span className="text-4xl font-mono font-bold text-white tracking-widest min-h-[48px]">
            {bib || <span className="text-gray-700">—</span>}
          </span>
        </div>
        {matched && <p className="text-sm text-cyan-300 font-medium">{matched.runner_name} · <span className="text-gray-500">{matched.status}</span></p>}
        {bib && !matched && <p className="text-xs text-amber-400 italic">New bib — will be created</p>}
        {!bib && <p className="text-xs text-gray-700">Enter bib number below</p>}
      </div>

      <input value={comment} onChange={e => setComment(e.target.value)} placeholder="Comment (optional)"
        className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 text-base text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />

      {flash && flash.type === "error" && (
        <div className="px-4 py-3 rounded-xl bg-red-500/15 border border-red-500/30 text-center text-sm font-semibold text-red-400">⚠ {flash.msg}</div>
      )}
      {flash && flash.type !== "error" && (
        <div className="px-4 py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-center text-sm font-semibold text-emerald-400">
          ✓ Bib <span className="font-mono">{flash.bib}</span>{flash.name && flash.name !== "Unknown" ? ` · ${flash.name}` : ""} → {flash.type}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {["1","2","3","4","5","6","7","8","9"].map(k => (
          <button key={k} onPointerDown={() => setBib(b => b.length < 6 ? b + k : b)}
            className="h-14 rounded-xl text-xl font-bold bg-gray-800 text-white active:bg-gray-600 transition-all">{k}</button>
        ))}
        <div />
        <button onPointerDown={() => setBib(b => b.length < 6 ? b + "0" : b)}
          className="h-14 rounded-xl text-xl font-bold bg-gray-800 text-white active:bg-gray-600 transition-all">0</button>
        <button onPointerDown={() => setBib(b => b.slice(0, -1))}
          className="h-14 rounded-xl text-xl font-bold bg-gray-800 text-gray-300 active:bg-gray-700 transition-all">⌫</button>
      </div>

      <button onPointerDown={() => press("Seen")} disabled={!bib.trim() || submitting}
        className="w-full h-16 rounded-2xl bg-emerald-600 active:bg-emerald-500 text-white text-xl font-black tracking-wide transition-all disabled:opacity-30 flex items-center justify-center">
        {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : "✓ SEEN"}
      </button>

      {!confirmAction ? (
        <div className="grid grid-cols-3 gap-2">
          {[
            { type: "DNF", label: "DNF", color: "text-red-400 border-red-800" },
            { type: "DNS", label: "DNS", color: "text-amber-400 border-amber-800" },
            { type: "Completed", label: "FINISH", color: "text-cyan-400 border-cyan-800" },
          ].map(({ type, label, color }) => (
            <button key={type} onPointerDown={() => { if (bib.trim()) setConfirmAction(type); }}
              disabled={!bib.trim() || submitting}
              className={`h-10 rounded-xl border bg-gray-900 text-sm font-bold tracking-wide transition-all disabled:opacity-30 ${color}`}>
              {label}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-3 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3">
          <p className="text-sm text-gray-300 flex-1">Log bib <span className="font-mono font-bold text-white">{bib}</span> as <span className="font-bold text-white">{confirmAction}</span>?</p>
          <button onPointerDown={() => setConfirmAction(null)} className="px-3 py-1.5 rounded-lg text-xs bg-gray-800 text-gray-400">Cancel</button>
          <button onPointerDown={() => { press(confirmAction); setConfirmAction(null); }} disabled={submitting}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-600 text-white active:bg-red-500 disabled:opacity-40 flex items-center gap-1">
            {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirm"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── RESOURCE REQUEST TAB ─────────────────────────────────────────────────────
function ResourceRequestTab({ stations, operators, activeEventId, lockedStationId, lockedCallsign }) {
  const lockedStationName = lockedStationId ? stations.find(s => s.id === lockedStationId)?.name || "" : "";
  const [form, setForm] = useState({
    type: "SAG", item: "", priority: "Routine",
    station_name: lockedStationName || "",
    requested_by: lockedCallsign || localStorage.getItem("ecs_callsign") || "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!form.item.trim()) return;
    if (!form.station_name) { setError("Please select your station before submitting."); return; }
    setSubmitting(true);
    await db.resourceRequests.create({
      event_id: activeEventId, type: form.type, item: form.item.trim(),
      priority: form.priority, status: "Pending",
      station_name: form.station_name || undefined,
      requested_by: form.requested_by || undefined,
      notes: form.notes.trim() || undefined,
    });
    setForm(f => ({ ...f, item: "", notes: "" }));
    setSubmitting(false); setFlash(true);
    setTimeout(() => setFlash(false), 2500);
  };

  const field = "w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-base focus:outline-none focus:border-cyan-500/50";

  return (
    <div className="flex flex-col gap-4">
      {flash && (
        <div className="px-4 py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-center text-sm font-semibold text-emerald-400">✓ Request submitted!</div>
      )}
      <div>
        <label className="text-xs text-gray-500 mb-2 block">Type</label>
        <div className="flex flex-wrap gap-2">
          {REQ_TYPES.map(t => (
            <button key={t} onClick={() => setForm(f => ({...f, type: t}))}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${form.type === t ? "bg-cyan-500 text-gray-950" : "bg-gray-800 text-gray-400"}`}>{t}</button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1.5 block">What do you need? *</label>
        <textarea value={form.item} onChange={e => setForm(f => ({...f, item: e.target.value}))}
          placeholder="e.g. Runner down at mile 14, needs SAG vehicle" rows={3} className={`${field} resize-none`} />
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1.5 block">Priority</label>
        <div className="flex gap-2">
          {REQ_PRIORITIES.map(p => (
            <button key={p} onClick={() => setForm(f => ({...f, priority: p}))}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                form.priority === p
                  ? p === "Emergency" ? "bg-red-600 text-white" : p === "Urgent" ? "bg-amber-500 text-gray-950" : "bg-cyan-500 text-gray-950"
                  : "bg-gray-800 text-gray-400"
              }`}>{p}</button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1.5 block">Your Station <span className="text-red-400">*</span></label>
        {lockedStationId ? (
          <div className={`${field} flex items-center justify-between opacity-80`}>
            <span>{form.station_name || "Locked Station"}</span>
            <Lock className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
          </div>
        ) : (
          <select value={form.station_name} onChange={e => { setForm(f => ({...f, station_name: e.target.value})); setError(""); }}
            className={`${field} ${!form.station_name && error ? "border-red-500" : ""}`}>
            <option value="">— Select station —</option>
            {stations.map(s => <option key={s.id} value={s.name}>{s.station_id} – {s.name}</option>)}
          </select>
        )}
        {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1.5 block">Your Callsign (optional)</label>
        {lockedCallsign ? (
          <div className={`${field} flex items-center justify-between opacity-80`}>
            <span>{form.requested_by}</span>
            <Lock className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
          </div>
        ) : (
          <select value={form.requested_by} onChange={e => setForm(f => ({...f, requested_by: e.target.value}))} className={field}>
            <option value="">— Select callsign —</option>
            {operators.map(o => <option key={o.id} value={o.callsign}>{o.callsign} — {o.full_name}</option>)}
          </select>
        )}
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1.5 block">Notes (optional)</label>
        <textarea value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))}
          placeholder="Any extra context..." rows={2} className={`${field} resize-none`} />
      </div>
      <button onClick={submit} disabled={!form.item.trim() || submitting}
        className="w-full py-4 rounded-2xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-gray-950 font-black text-lg tracking-wide transition-all flex items-center justify-center gap-2">
        {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Plus className="w-5 h-5" /> Submit Request</>}
      </button>
    </div>
  );
}

// ─── VIEW REQUESTS TAB ────────────────────────────────────────────────────────
const REQUEST_STATUSES = ["Pending", "Approved", "En Route", "Fulfilled", "Cancelled"];

function RequestCard({ request, onStatusChange }) {
  const [expanded, setExpanded] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [updating, setUpdating] = useState(false);
  const r = request;

  const applyStatus = async (newStatus) => {
    setUpdating(true);
    await db.resourceRequests.update(r.id, { status: newStatus });
    onStatusChange(r.id, newStatus);
    setUpdating(false); setConfirm(null); setExpanded(false);
  };

  return (
    <div className={`bg-gray-900 border rounded-xl overflow-hidden ${r.priority === "Emergency" ? "border-red-500/50" : r.priority === "Urgent" ? "border-amber-500/30" : "border-gray-800"}`}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <span className="text-white font-semibold text-sm leading-snug flex-1">{r.item}</span>
          <button onClick={() => { setExpanded(e => !e); setConfirm(null); }}
            className={`text-xs font-bold flex-shrink-0 ${STATUS_COLOR[r.status]} underline underline-offset-2 decoration-dotted`}>{r.status}</button>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
          <span className="font-medium text-cyan-500/80">{r.type}</span>
          <span className={PRIORITY_COLOR[r.priority]}>{r.priority}</span>
          {r.station_name && <span>📍 {r.station_name}</span>}
          {r.requested_by && <span>👤 {r.requested_by}</span>}
          <span>{new Date(r.created_date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        {r.notes && <p className="text-xs text-gray-600 mt-1 italic">{r.notes}</p>}
      </div>
      {expanded && (
        <div className="border-t border-gray-800 px-4 py-3 bg-gray-950/50">
          {!confirm ? (
            <>
              <p className="text-xs text-gray-500 mb-2">Change status:</p>
              <div className="flex flex-wrap gap-2">
                {REQUEST_STATUSES.filter(s => s !== r.status).map(s => (
                  <button key={s} onClick={() => setConfirm(s)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-800 text-gray-300 active:bg-gray-700 transition-all">{s}</button>
                ))}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <p className="text-xs text-gray-400 flex-1">Set to <span className="text-white font-bold">{confirm}</span>?</p>
              <button onClick={() => setConfirm(null)} className="px-3 py-1.5 rounded-lg text-xs bg-gray-800 text-gray-400">Cancel</button>
              <button onClick={() => applyStatus(confirm)} disabled={updating}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-cyan-500 text-gray-950 active:bg-cyan-400 disabled:opacity-40 flex items-center gap-1">
                {updating ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirm"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ViewRequestsTab({ activeEventId }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("Open");

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    const reqs = await db.resourceRequests.filter({ event_id: activeEventId }, "-created_date");
    setRequests(reqs); setLoading(false);
  };

  useEffect(() => { load(); }, [activeEventId]);

  // live updates (quiet refetch, no spinner)
  useEffect(() => {
    let t = null;
    const unsub = db.resourceRequests.subscribe(() => { clearTimeout(t); t = setTimeout(() => load(true), 300); });
    return () => { clearTimeout(t); unsub(); };
  }, [activeEventId]);

  const filtered = requests.filter(r =>
    filter === "All" ? true :
    filter === "Open" ? !["Fulfilled", "Cancelled"].includes(r.status) :
    r.status === filter
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 flex-wrap items-center">
        {["Open", "All", "Fulfilled"].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filter === f ? "bg-cyan-500 text-gray-950" : "bg-gray-800 text-gray-400"}`}>{f}</button>
        ))}
        <button onClick={load} className="ml-auto px-3 py-1.5 rounded-lg text-sm bg-gray-800 text-gray-400">↻</button>
      </div>
      {loading ? (
        <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-500" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-gray-600 text-sm">No requests found.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map(r => <RequestCard key={r.id} request={r} onStatusChange={(id, s) => setRequests(prev => prev.map(r => r.id === id ? {...r, status: s} : r))} />)}
        </div>
      )}
    </div>
  );
}

// ─── BIB LOOKUP TAB ───────────────────────────────────────────────────────────
const STATUS_BADGE = {
  Active: "bg-green-500/20 text-green-300 border-green-500/30",
  DNS: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  DNF: "bg-red-500/20 text-red-300 border-red-500/30",
  Completed: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  Withdrawn: "bg-gray-500/20 text-gray-300 border-gray-500/30",
};
const UPDATE_ICON = { Seen: "👁", DNS: "🚫", DNF: "⛔", Completed: "🏁", Comment: "💬", Withdrawn: "↩️" };

function BibDetailCard({ participant }) {
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let t = null;
    const fetchHistory = (silent) => {
      if (!silent) setLoading(true);
      db.participantStatusUpdates.filter({ participant_id: participant.id }, "timestamp")
        .then(updates => { setHistory(updates); setLoading(false); });
    };
    fetchHistory(false);
    const unsub = db.participantStatusUpdates.subscribe(() => { clearTimeout(t); t = setTimeout(() => fetchHistory(true), 300); });
    return () => { clearTimeout(t); unsub(); };
  }, [participant.id]);

  const badge = STATUS_BADGE[participant.status] || "bg-gray-700 text-gray-300 border-gray-600";

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="p-4">
        <div className="flex items-center gap-2.5 mb-2">
          <span className="text-3xl font-mono font-bold text-white">#{participant.bib_number}</span>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${badge}`}>{participant.status || "Active"}</span>
        </div>
        <p className="text-cyan-300 font-semibold text-base mb-3">{participant.runner_name}</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-gray-800 rounded-lg px-3 py-2">
            <p className="text-gray-500 mb-0.5">Last Seen At</p>
            <p className="text-white font-medium">{participant.current_location_name || "—"}</p>
          </div>
          <div className="bg-gray-800 rounded-lg px-3 py-2">
            <p className="text-gray-500 mb-0.5">Last Update</p>
            <p className="text-white font-medium">
              {participant.last_update_date ? new Date(participant.last_update_date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
            </p>
          </div>
        </div>
        {participant.notes && (
          <div className="mt-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2 text-xs text-yellow-300">📝 {participant.notes}</div>
        )}
      </div>
      <div className="border-t border-gray-800 px-4 py-3 space-y-2 bg-gray-950/50">
        <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-2">Station History</p>
        {loading ? (
          <div className="text-center py-2"><Loader2 className="w-4 h-4 animate-spin mx-auto text-gray-600" /></div>
        ) : !history || history.length === 0 ? (
          <p className="text-xs text-gray-600 text-center py-2">No history recorded.</p>
        ) : (
          history.map(u => (
            <div key={u.id} className="flex items-start gap-2.5 text-xs">
              <span className="text-base leading-none mt-0.5">{UPDATE_ICON[u.update_type] || "•"}</span>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white">{u.update_type}</span>
                  <span className="text-gray-600">{new Date(u.timestamp).toLocaleDateString([], { month: "short", day: "numeric" })} {new Date(u.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                {u.aide_station_name && <p className="text-gray-500">📍 {u.aide_station_name}</p>}
                {u.comment && <p className="text-gray-400 italic mt-0.5">"{u.comment}"</p>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function BibLookupTab({ participants }) {
  const [query, setQuery] = useState("");
  const results = query.trim().length === 0 ? [] : participants.filter(p =>
    p.bib_number.includes(query.trim()) || p.runner_name.toLowerCase().includes(query.trim().toLowerCase())
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Bib # or runner name..."
          className="w-full bg-gray-900 border border-gray-700 rounded-xl pl-10 pr-4 py-3 text-white text-base focus:outline-none focus:border-cyan-500/50" />
      </div>
      {query.trim().length > 0 && results.length === 0 && (
        <div className="text-center py-8 text-gray-600 text-sm">No participant found.</div>
      )}
      {results.map(p => <BibDetailCard key={p.id} participant={p} />)}
      {!query && (
        <div className="text-center py-8 text-gray-700 text-sm">
          <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
          Search by bib number or name
        </div>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
function MobileApp({ session, onLogout }) {
  const [tab, setTab] = useState("bib");
  const [stations, setStations] = useState([]);
  const [operators, setOperators] = useState([]);
  const [participants, setParticipants] = useState([]);

  useEffect(() => {
    let t = null;
    const fetchAll = () => Promise.all([
      db.aideStations.filter({ event_id: session.eventId }),
      db.operators.filter({ event_id: session.eventId }),
      db.participants.filter({ event_id: session.eventId }),
    ]).then(([sts, ops, ps]) => {
      setStations(sts.filter(s => s.status !== "Closed"));
      setOperators(ops);
      setParticipants(ps);
    }).catch(() => {});
    fetchAll();
    // live updates: other volunteers and net control change participants/stations
    const refresh = () => { clearTimeout(t); t = setTimeout(fetchAll, 300); };
    const unsubs = [
      db.participants.subscribe(refresh),
      db.aideStations.subscribe(refresh),
      db.operators.subscribe(refresh),
    ];
    return () => { clearTimeout(t); unsubs.forEach(u => u()); };
  }, [session.eventId]);

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <div className="flex-none px-4 pt-4 pb-3 border-b border-gray-800 bg-gray-900 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-600 uppercase tracking-widest">SWCRS</p>
          <h1 className="text-sm font-bold text-cyan-400 leading-tight">{session.eventName}</h1>
          {session.callsign && <p className="text-xs text-gray-500">{session.callsign}{session.stationName ? ` · ${session.stationName}` : ""}</p>}
        </div>
        <button onClick={onLogout} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 text-xs hover:text-red-400 transition-colors">
          <LogOut className="w-3.5 h-3.5" /> Leave
        </button>
      </div>
      <div className="flex-none grid grid-cols-4 border-b border-gray-800 bg-gray-900">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-all ${tab === id ? "text-cyan-400 border-b-2 border-cyan-400" : "text-gray-500"}`}>
            <Icon className="w-4 h-4" />
            <span className="leading-tight">{label}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-10">
        {tab === "bib" && <BibEntryTab stations={stations} participants={participants} activeEventId={session.eventId} setParticipants={setParticipants} lockedStationId={session.stationId || null} lockedCallsign={session.callsign || null} />}
        {tab === "request" && <ResourceRequestTab stations={stations} operators={operators} activeEventId={session.eventId} lockedStationId={session.stationId || null} lockedCallsign={session.callsign || null} />}
        {tab === "requests" && <ViewRequestsTab activeEventId={session.eventId} />}
        {tab === "lookup" && <BibLookupTab participants={participants} activeEventId={session.eventId} />}
      </div>
    </div>
  );
}

// ─── STANDALONE LOGIN ─────────────────────────────────────────────────────────
function MobileLogin({ onSession }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [stations, setStations] = useState([]);
  const [operators, setOperators] = useState([]);
  const [stationId, setStationId] = useState("");
  const [callsign, setCallsign] = useState("");
  const [pinValidated, setPinValidated] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchPublicEvents().then(evs => {
      const active = evs.filter(e => e.status !== "Archived");
      setEvents(active);
      const def = active.find(e => e.status === "Active") || active[0];
      if (def) setSelectedEventId(def.id);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // stations/operators are only readable after the server accepted the PIN
  useEffect(() => {
    if (!selectedEventId || !pinValidated) { setStations([]); setOperators([]); return; }
    Promise.all([
      db.aideStations.filter({ event_id: selectedEventId }),
      db.operators.filter({ event_id: selectedEventId }),
    ]).then(([sts, ops]) => {
      setStations(sts.filter(s => s.status !== "Closed"));
      setOperators(ops);
    }).catch(() => {});
  }, [selectedEventId, pinValidated]);

  const validate = async () => {
    setError("");
    if (!selectedEventId) { setError("Please select an event."); return; }
    try {
      await ecsLogin({ mode: "event", eventId: selectedEventId, pin });
      setPinValidated(true);
    } catch (err) {
      setError(err.message || "Login failed.");
    }
  };

  const proceed = () => {
    const ev = events.find(e => e.id === selectedEventId);
    const st = stations.find(s => s.id === stationId);
    if (stationId) localStorage.setItem("ecs_bib_station", stationId);
    if (st) localStorage.setItem("ecs_station_name", st.name);
    if (callsign) localStorage.setItem("ecs_callsign", callsign);
    onSession({
      eventId: selectedEventId,
      eventName: ev.name,
      stationId: stationId || null,
      callsign: callsign || null,
      stationName: st?.name || null,
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-700 border-t-cyan-400 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mx-auto mb-3">
            <Radio className="w-6 h-6 text-cyan-400" />
          </div>
          <h1 className="text-lg font-bold text-white">Volunteer Mobile</h1>
          <p className="text-gray-500 text-sm mt-1">SWCRS Event Communications</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Select Event</label>
            <div className="relative">
              <select value={selectedEventId} onChange={e => { setSelectedEventId(e.target.value); setPinValidated(false); setPin(""); setError(""); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-8 text-sm text-white focus:outline-none focus:border-cyan-500/50 appearance-none">
                <option value="">— Choose an event —</option>
                {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}{ev.status === "Active" ? " ★" : ""}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            </div>
          </div>

          {!pinValidated && (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Event PIN <span className="text-gray-600">(if required)</span></label>
              <div className="relative">
                <input type={showPin ? "text" : "password"} value={pin}
                  onChange={e => { setPin(e.target.value); setError(""); }}
                  onKeyDown={e => e.key === "Enter" && validate()}
                  placeholder="Enter PIN or leave blank"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-10 text-sm text-white font-mono tracking-widest focus:outline-none focus:border-cyan-500/50"
                />
                <button type="button" onClick={() => setShowPin(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                  {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {pinValidated && (
            <div className="space-y-3 border-t border-gray-800 pt-4">
              <p className="text-xs text-cyan-400 font-semibold uppercase tracking-wider">✓ Identify Yourself (optional)</p>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">My Station</label>
                <div className="relative">
                  <select value={stationId} onChange={e => setStationId(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-8 text-sm text-white focus:outline-none focus:border-cyan-500/50 appearance-none">
                    <option value="">— None —</option>
                    {stations.map(s => <option key={s.id} value={s.id}>{s.station_id} – {s.name}</option>)}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">My Callsign</label>
                <div className="relative">
                  <select value={callsign} onChange={e => setCallsign(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-8 text-sm text-white focus:outline-none focus:border-cyan-500/50 appearance-none">
                    <option value="">— None —</option>
                    {operators.map(o => <option key={o.id} value={o.callsign}>{o.callsign} — {o.full_name}</option>)}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                </div>
              </div>
            </div>
          )}

          {error && <p className="text-red-400 text-xs">{error}</p>}

          {!pinValidated ? (
            <button onClick={validate}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-bold rounded-lg text-sm transition-all">
              <Lock className="w-4 h-4" /> Continue
            </button>
          ) : (
            <div className="space-y-2">
              <button onClick={proceed}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-bold rounded-lg text-sm transition-all">
                Enter Volunteer View
              </button>
              <button onClick={() => { setPinValidated(false); setPin(""); }}
                className="w-full text-xs text-gray-600 hover:text-gray-400 transition-all py-1">← Back</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function VolunteerMobile() {
  const [session, setSession] = useState(null);
  const [resolving, setResolving] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlEventId = params.get("eventId");
    const urlPin = params.get("pin");
    const urlStationId = params.get("stationId");
    const urlCallsign = params.get("callsign");

    if (urlEventId) {
      // Auto-login from PinGate URL params (server verifies the PIN)
      ecsLogin({ mode: "event", eventId: urlEventId, pin: urlPin || "" }).then(r => {
        // do not leave the PIN in the address bar / history
        params.delete("pin");
        const q = params.toString();
        window.history.replaceState(null, "", window.location.pathname + (q ? `?${q}` : ""));
        setSession({
          eventId: urlEventId,
          eventName: r.eventName,
          stationId: urlStationId || null,
          callsign: urlCallsign || null,
          stationName: localStorage.getItem("ecs_station_name") || null,
        });
      }).catch(() => {
        // wrong/missing PIN: show the login screen instead
      }).finally(() => setResolving(false));
    } else {
      // No URL params — show the standalone login screen
      setResolving(false);
    }
  }, []);

  const handleLogout = () => { pb.authStore.clear(); setSession(null); };

  if (resolving) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-700 border-t-cyan-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) return <MobileLogin onSession={setSession} />;
  return <MobileApp session={session} onLogout={handleLogout} />;
}