import { useEffect, useState } from "react";
import { db } from "@/api/ecs";
import { useEvent } from "@/components/EventContext";
import { MapPin, Hash, Loader2, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

const ACTIONS = [
  { type: "Seen",      label: "SEEN",   bg: "bg-emerald-600 active:bg-emerald-500", border: "border-emerald-500" },
  { type: "Completed", label: "FINISH", bg: "bg-cyan-600 active:bg-cyan-500",      border: "border-cyan-500"    },
  { type: "DNF",       label: "DNF",    bg: "bg-red-600 active:bg-red-500",         border: "border-red-500"     },
  { type: "DNS",       label: "DNS",    bg: "bg-amber-600 active:bg-amber-500",     border: "border-amber-500"   },
];

export default function BibMobile() {
  const { activeEventId, activeEvent } = useEvent();
  const navigate = useNavigate();
  const [bib, setBib] = useState("");
  const [station, setStation] = useState(localStorage.getItem("ecs_bib_station") || "");
  const [stations, setStations] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState(null); // { type, bib, name, ok }

  useEffect(() => {
    if (!activeEventId) return;
    Promise.all([
      db.aideStations.filter({ event_id: activeEventId }),
      db.participants.filter({ event_id: activeEventId }),
    ]).then(([sts, ps]) => {
      setStations(sts.filter(s => s.status !== "Closed"));
      setParticipants(ps);
    });
  }, [activeEventId]);

  const matched = participants.find(p => p.bib_number === bib.trim());

  const press = async (updateType) => {
    const bibNum = bib.trim();
    if (!bibNum) return;
    // station is optional for Seen
    setSubmitting(true);
    const st = stations.find(s => s.id === station);

    let participant = matched;
    if (!participant) {
      participant = await db.participants.create({
        event_id: activeEventId,
        bib_number: bibNum,
        runner_name: "Unknown",
        status: updateType === "Seen" ? "Active" : updateType,
        current_location_name: st?.name || null,
        current_location_station_id: st?.id || null,
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
      event_id: activeEventId,
      participant_id: participant.id,
      bib_number: bibNum,
      update_type: updateType,
      aide_station_id: st?.id || null,
      aide_station_name: st?.name || null,
      timestamp: new Date().toISOString(),
    });

    setFlash({ type: updateType, bib: bibNum, name: matched?.runner_name });
    setBib("");
    setSubmitting(false);

    // Refresh participants list
    db.participants.filter({ event_id: activeEventId }).then(setParticipants);

    setTimeout(() => setFlash(null), 2500);
  };

  if (!activeEventId) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500 text-sm">
        Select an event first.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col select-none">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-gray-800">
        <button
          onClick={() => navigate("/BibTracker")}
          className="flex items-center justify-center w-9 h-9 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 transition-all flex-shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 text-center pr-9">
          <p className="text-xs text-gray-600 uppercase tracking-widest">{activeEvent?.name}</p>
          <h1 className="text-base font-bold text-cyan-400">Bib Entry</h1>
        </div>
      </div>

      {/* Station picker */}
      <div className="px-4 mb-3">
        <div className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2">
          <MapPin className="w-4 h-4 text-gray-500 flex-shrink-0" />
          <select
            value={station}
            onChange={e => { localStorage.setItem("ecs_bib_station", e.target.value); setStation(e.target.value); }}
            className="flex-1 bg-transparent text-white text-sm focus:outline-none appearance-none"
          >
            <option value="">— Select station (for SEEN) —</option>
            {stations.map(s => (
              <option key={s.id} value={s.id}>{s.station_id} – {s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Bib display */}
      <div className="px-4 mb-4">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl px-6 py-5 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Hash className="w-5 h-5 text-gray-600" />
            <span className="text-4xl font-mono font-bold text-white tracking-widest min-h-[48px]">
              {bib || <span className="text-gray-700">—</span>}
            </span>
          </div>
          {matched && <p className="text-sm text-cyan-300 font-medium">{matched.runner_name} · <span className="text-gray-500">{matched.status}</span></p>}
          {bib && !matched && <p className="text-xs text-amber-400 italic">New bib — will be created</p>}
          {!bib && <p className="text-xs text-gray-700">Enter a bib number</p>}
        </div>
      </div>

      {/* Flash feedback */}
      {flash && (
        <div className="mx-4 mb-3 px-4 py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-center text-sm font-semibold text-emerald-400">
          ✓ Bib <span className="font-mono">{flash.bib}</span>{flash.name && flash.name !== "Unknown" ? ` · ${flash.name}` : ""} → {flash.type}
        </div>
      )}

      {/* Numpad */}
      <div className="px-4 grid grid-cols-3 gap-2 mb-3">
        {["1","2","3","4","5","6","7","8","9","⌫","0","⏎"].map(k => (
          <button
            key={k}
            onPointerDown={() => {
              if (k === "⌫") setBib(b => b.slice(0, -1));
              else if (k === "⏎") press("Seen");
              else setBib(b => b.length < 6 ? b + k : b);
            }}
            className={`h-14 rounded-xl text-xl font-bold transition-all
              ${k === "⏎"
                ? "bg-emerald-700 text-white active:bg-emerald-500"
                : k === "⌫"
                ? "bg-gray-800 text-gray-300 active:bg-gray-700"
                : "bg-gray-800 text-white active:bg-gray-600"
              }`}
          >
            {k}
          </button>
        ))}
      </div>

      {/* Action buttons */}
      <div className="px-4 grid grid-cols-2 gap-2 pb-8">
        {ACTIONS.map(({ type, label, bg }) => (
          <button
            key={type}
            onPointerDown={() => press(type)}
            disabled={!bib.trim() || submitting}
            className={`h-16 rounded-2xl text-white text-lg font-black tracking-wide transition-all ${bg} disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
          >
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : label}
          </button>
        ))}
      </div>
    </div>
  );
}