import { useState, useRef } from "react";
import { Zap, MapPin, XCircle, CheckCircle, MessageSquare } from "lucide-react";

export default function BibQuickEntry({ stations, onSubmit, participants }) {
  const [bibInput, setBibInput] = useState("");
  const [selectedStation, setSelectedStation] = useState(localStorage.getItem("ecs_bib_station") || "");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const bibRef = useRef(null);

  const matched = participants.find(p => p.bib_number === bibInput.trim());

  const submit = async (updateType) => {
    const bib = bibInput.trim();
    if (!bib) return;
    // station is optional
    setSubmitting(true);
    try {
      const station = stations.find(s => s.id === selectedStation);
      await onSubmit({
        bibNumber: bib,
        updateType,
        stationId: station?.id || null,
        stationName: station?.name || null,
        comment: comment.trim() || null,
      });
      setLastResult({ bib, type: updateType, name: matched?.runner_name, prevStatus: matched?.status });
      setBibInput("");
      setComment("");
      bibRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-gray-900 border border-cyan-500/20 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Zap className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-semibold text-cyan-400 uppercase tracking-wider">Quick Update</span>
      </div>

      <div className="flex gap-3 items-start flex-wrap">
        {/* Bib # */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Bib #</label>
          <input
            ref={bibRef}
            value={bibInput}
            onChange={e => { setBibInput(e.target.value); }}
            onKeyDown={e => { if (e.key === "Enter") submit("Seen"); }}
            placeholder="e.g. 42"
            className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500/50"
          />
          {matched && (
            <span className="text-xs text-cyan-300 font-medium">{matched.runner_name}</span>
          )}
          {bibInput.trim() && !matched && (
            <span className="text-xs text-amber-400 italic">New bib</span>
          )}
        </div>

        {/* Station */}
        <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
          <label className="text-xs text-gray-500 flex items-center gap-1"><MapPin className="w-3 h-3" /> Station</label>
          <select
            value={selectedStation}
            onChange={e => { localStorage.setItem("ecs_bib_station", e.target.value); setSelectedStation(e.target.value); }}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
          >
            <option value="">— Select station —</option>
            {stations.filter(s => s.status !== "Closed").map(s => (
              <option key={s.id} value={s.id}>{s.station_id} – {s.name}</option>
            ))}
          </select>
        </div>

        {/* Comment */}
        <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
          <label className="text-xs text-gray-500 flex items-center gap-1"><MessageSquare className="w-3 h-3" /> Comment (optional)</label>
          <input
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="e.g. limping, needs water"
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
          />
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Action</label>
          <div className="flex gap-2">
            <button
              onClick={() => submit("Seen")}
              disabled={bibInput.trim().length === 0 || submitting}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-sm transition-all"
            >
              <MapPin className="w-3.5 h-3.5" /> Seen
            </button>
            <button
              onClick={() => submit("DNF")}
              disabled={bibInput.trim().length === 0 || submitting}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-sm transition-all"
            >
              <XCircle className="w-3.5 h-3.5" /> DNF
            </button>
            <button
              onClick={() => submit("DNS")}
              disabled={bibInput.trim().length === 0 || submitting}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-sm transition-all"
            >
              <XCircle className="w-3.5 h-3.5" /> DNS
            </button>
            <button
              onClick={() => submit("Completed")}
              disabled={bibInput.trim().length === 0 || submitting}
              className="flex items-center gap-1.5 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-sm transition-all"
            >
              <CheckCircle className="w-3.5 h-3.5" /> Finish
            </button>
          </div>
        </div>
      </div>

      {lastResult && (
        <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-1.5">
          ✓ Bib <span className="font-mono font-bold">{lastResult.bib}</span>
          {lastResult.name && lastResult.name !== "Unknown" ? ` (${lastResult.name})` : ""}
          {lastResult.prevStatus ? <span className="text-gray-400"> [{lastResult.prevStatus}]</span> : ""} → <strong>{lastResult.type}</strong>
        </div>
      )}
    </div>
  );
}