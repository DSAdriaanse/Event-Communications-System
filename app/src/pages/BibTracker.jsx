import { useEffect, useState, useRef } from "react";
import { db } from "@/api/ecs";
import { useEvent } from "@/components/EventContext";
import { Users, Upload, Plus, Search } from "lucide-react";
import BibQuickEntry from "@/components/bibtracker/BibQuickEntry";
import BibParticipantDetail from "@/components/bibtracker/BibParticipantDetail";
import BibList from "@/components/bibtracker/BibList";
import BibImportModal from "@/components/bibtracker/BibImportModal";
import BibAddModal from "@/components/bibtracker/BibAddModal";

export default function BibTracker() {
  const { activeEventId, activeEvent } = useEvent();
  const tz = activeEvent?.timezone || "America/Phoenix";
  const [participants, setParticipants] = useState([]);
  const [stations, setStations] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedParticipant, setSelectedParticipant] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const load = async (silent = false) => {
    if (!activeEventId) { setLoading(false); return; }
    if (!silent) setLoading(true);
    const [ps, sts, upds] = await Promise.all([
      db.participants.filter({ event_id: activeEventId }),
      db.aideStations.filter({ event_id: activeEventId }),
      db.participantStatusUpdates.filter({ event_id: activeEventId }),
    ]);
    setParticipants(ps.sort((a, b) => {
      const an = parseInt(a.bib_number) || 0;
      const bn = parseInt(b.bib_number) || 0;
      return an !== bn ? an - bn : a.bib_number.localeCompare(b.bib_number);
    }));
    setStations(sts);
    setUpdates(upds);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeEventId]);

  // Live updates: refetch quietly (no spinner) when records change, e.g. from the mobile app.
  useEffect(() => {
    if (!activeEventId) return;
    let timer = null;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => load(true), 300);
    };
    const unsubs = [
      db.participants.subscribe(refresh),
      db.participantStatusUpdates.subscribe(refresh),
      db.aideStations.subscribe(refresh),
    ];
    return () => { clearTimeout(timer); unsubs.forEach((u) => u()); };
  }, [activeEventId]);

  const handleQuickUpdate = async ({ bibNumber, updateType, stationId, stationName, comment }) => {
    let participant = participants.find(p => p.bib_number === bibNumber);
    if (!participant) {
      // Auto-create unknown bib
      participant = await db.participants.create({
        event_id: activeEventId,
        bib_number: bibNumber,
        runner_name: "Unknown",
        status: updateType === "Seen" ? "Active" : updateType,
        current_location_name: stationName || null,
        current_location_station_id: stationId || null,
        last_update_date: new Date().toISOString(),
      });
    } else {
      const newStatus = updateType === "Seen" ? (participant.status === "Active" || !participant.status ? "Active" : participant.status) : updateType;
      await db.participants.update(participant.id, {
        status: newStatus,
        current_location_name: updateType === "Seen" ? stationName : participant.current_location_name,
        current_location_station_id: updateType === "Seen" ? stationId : participant.current_location_station_id,
        last_update_date: new Date().toISOString(),
      });
    }
    await db.participantStatusUpdates.create({
      event_id: activeEventId,
      participant_id: participant.id,
      bib_number: bibNumber,
      update_type: updateType,
      aide_station_id: stationId || null,
      aide_station_name: stationName || null,
      timestamp: new Date().toISOString(),
      comment: comment || null,
    });
    await load();
  };

  const handleSelectParticipant = (p) => setSelectedParticipant(p);

  const handleDeleteParticipant = async () => {
    if (!selectedParticipant) return;
    // One call: the server deletes the participant's status updates in the same transaction.
    await db.participants.delete(selectedParticipant.id);
    setSelectedParticipant(null);
    await load();
  };

  const filtered = participants.filter(p => {
    const matchesSearch = p.bib_number?.toLowerCase().includes(search.toLowerCase()) ||
      p.runner_name?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "All" || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: participants.length,
    active: participants.filter(p => p.status === "Active").length,
    dns: participants.filter(p => p.status === "DNS").length,
    dnf: participants.filter(p => p.status === "DNF").length,
    completed: participants.filter(p => p.status === "Completed").length,
  };

  if (!activeEventId) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Select an event to use the Bib Tracker.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Bib Tracker</h1>
            <p className="text-gray-500 text-sm mt-1">{activeEvent?.name}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowImport(true)}
              className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-300 transition-all">
              <Upload className="w-3.5 h-3.5" /> Import CSV
            </button>
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 px-3 py-2 bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-semibold rounded-lg text-xs transition-all">
              <Plus className="w-3.5 h-3.5" /> Add Participant
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: "Total", value: stats.total, color: "text-white" },
            { label: "Active", value: stats.active, color: "text-emerald-400" },
            { label: "DNS", value: stats.dns, color: "text-amber-400" },
            { label: "DNF", value: stats.dnf, color: "text-red-400" },
            { label: "Finished", value: stats.completed, color: "text-cyan-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
              <div className={`text-2xl font-bold ${color}`}>{value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Quick Entry */}
        <BibQuickEntry stations={stations} onSubmit={handleQuickUpdate} participants={participants} />

        {/* Main content: list */}
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {[
              { label: "All", color: "text-white border-gray-600" },
              { label: "Active", color: "text-emerald-400 border-emerald-700" },
              { label: "Seen", color: "text-cyan-400 border-cyan-700" },
              { label: "DNS", color: "text-amber-400 border-amber-700" },
              { label: "DNF", color: "text-red-400 border-red-700" },
              { label: "Completed", color: "text-cyan-300 border-cyan-600" },
            ].map(({ label, color }) => (
              <button key={label} onClick={() => setStatusFilter(label === statusFilter && label !== "All" ? "All" : label)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  statusFilter === label
                    ? `${color} bg-gray-800`
                    : "text-gray-500 border-gray-800 hover:border-gray-600 hover:text-gray-300"
                }`}>
                {label}
                {label !== "All" && (
                  <span className="ml-1.5 text-gray-600 font-normal">
                    {label === "Active" ? stats.active : label === "DNS" ? stats.dns : label === "DNF" ? stats.dnf : label === "Completed" ? stats.completed : participants.filter(p => p.status === label).length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search bib # or name..."
              className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50" />
          </div>
          <BibList
            participants={filtered}
            updates={updates}
            loading={loading}
            onSelect={handleSelectParticipant}
            selectedId={selectedParticipant?.id}
            tz={tz}
          />
        </div>

        {selectedParticipant && (
          <BibParticipantDetail
            participant={selectedParticipant}
            updates={updates.filter(u => u.participant_id === selectedParticipant.id)}
            stations={stations}
            onClose={() => setSelectedParticipant(null)}
            onRefresh={load}
            onDelete={handleDeleteParticipant}
            tz={tz}
          />
        )}
      </div>

      {showImport && (
        <BibImportModal
          eventId={activeEventId}
          onClose={() => setShowImport(false)}
          onImported={load}
        />
      )}
      {showAdd && (
        <BibAddModal
          eventId={activeEventId}
          onClose={() => setShowAdd(false)}
          onSaved={load}
        />
      )}
    </div>
  );
}