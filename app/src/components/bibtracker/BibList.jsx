import { formatEventTime } from "@/lib/eventTime";

const STATUS_STYLE = {
  Active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  DNS: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  DNF: "bg-red-500/10 text-red-400 border-red-500/20",
  Completed: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  Withdrawn: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

export default function BibList({ participants, updates, loading, onSelect, selectedId, tz = "America/Phoenix" }) {
  if (loading) return <div className="text-center text-gray-600 py-12">Loading...</div>;
  if (participants.length === 0) return (
    <div className="text-center text-gray-600 py-12">
      <p>No participants found.</p>
      <p className="text-xs mt-1">Import a CSV or add participants manually.</p>
    </div>
  );

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-5 px-4 py-2.5 border-b border-gray-800 text-xs font-medium uppercase tracking-wider text-gray-500">
        <span>Bib #</span>
        <span className="col-span-2">Name</span>
        <span>Status</span>
        <span>Last Seen</span>
      </div>
      <div className="divide-y divide-gray-800/50 max-h-[50vh] overflow-y-auto">
        {participants.map(p => {
          const lastUpdate = updates
            .filter(u => u.participant_id === p.id)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
          return (
            <div
              key={p.id}
              onClick={() => onSelect(p)}
              className={`grid grid-cols-5 px-4 py-3 cursor-pointer transition-colors items-center ${
                selectedId === p.id ? "bg-cyan-500/10 border-l-2 border-cyan-500" : "hover:bg-gray-800/60"
              }`}
            >
              <span className="text-cyan-400 font-mono font-bold text-sm">{p.bib_number}</span>
              <span className="col-span-2 text-white text-sm truncate">{p.runner_name}</span>
              <span>
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${STATUS_STYLE[p.status] || "bg-gray-700 text-gray-300"}`}>
                  {p.status || "Active"}
                </span>
              </span>
              <span className="text-xs text-gray-500">
                {p.current_location_name
                  ? <span className="text-gray-400">{p.current_location_name}</span>
                  : <span className="italic text-gray-700">—</span>
                }
                {lastUpdate && (
                  <div className="text-gray-700 mt-0.5">
                    {formatEventTime(lastUpdate.timestamp, tz, false)}
                  </div>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}