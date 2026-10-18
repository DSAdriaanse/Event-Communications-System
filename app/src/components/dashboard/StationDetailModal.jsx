import { X, Radio, Users, PackageSearch, AlertTriangle } from "lucide-react";

const stDot = { Active: "bg-emerald-400", Standby: "bg-amber-400", Closed: "bg-gray-500", Requested: "bg-blue-400" };
const stColor = { Active: "text-emerald-400", Standby: "text-amber-400", Closed: "text-gray-500", Requested: "text-blue-400" };
const reqPriColor = { Routine: "text-gray-400", Urgent: "text-amber-400", Emergency: "text-red-400" };
const reqStatusColor = { Pending: "text-amber-400", Approved: "text-blue-400", "En Route": "text-cyan-400", Fulfilled: "text-emerald-400", Cancelled: "text-gray-500" };

export default function StationDetailModal({ station, assignments, resourceRequests, onClose }) {
  if (!station) return null;

  const stationAssignments = assignments.filter(a => a.station_name === station.name);
  const stationRequests = resourceRequests.filter(r => r.station_name === station.name);
  const pendingRequests = stationRequests.filter(r => r.status === "Pending" || r.status === "Approved" || r.status === "En Route");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <span className={`w-3 h-3 rounded-full flex-shrink-0 mt-0.5 ${stDot[station.status] || "bg-gray-500"}`} />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-cyan-400 font-mono font-bold text-lg">{station.station_id}</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-gray-800 ${stColor[station.status]}`}>{station.status}</span>
              </div>
              <p className="text-white font-semibold">{station.name}</p>
              {station.type && <p className="text-gray-500 text-xs mt-0.5">{station.type}</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* Details */}
          {(station.address || station.primary_frequency || station.backup_frequency) && (
            <div className="space-y-1.5">
              {station.address && <p className="text-xs text-gray-400"><span className="text-gray-600">Address:</span> {station.address}</p>}
              {station.primary_frequency && (
                <p className="text-xs text-gray-400 flex items-center gap-1.5">
                  <Radio className="w-3 h-3 text-cyan-400" />
                  <span className="font-mono text-cyan-300">{station.primary_frequency} MHz</span>
                  {station.backup_frequency && <span className="text-gray-600">/ {station.backup_frequency} MHz backup</span>}
                </p>
              )}
            </div>
          )}

          {/* Assets */}
          {(station.assets || []).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Assets</p>
              <div className="flex flex-wrap gap-1.5">
                {station.assets.map((a, i) => <span key={i} className="text-xs bg-gray-800 border border-gray-700 px-2 py-0.5 rounded text-gray-300">{a}</span>)}
              </div>
            </div>
          )}

          {/* Operators / Assignments */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-3.5 h-3.5 text-gray-500" />
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Assigned Operators</p>
            </div>
            {stationAssignments.length === 0 ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-red-900/20 border border-red-800/40 rounded-lg text-xs text-red-400">
                <AlertTriangle className="w-3.5 h-3.5" /> No operators assigned
              </div>
            ) : (
              <div className="space-y-1.5">
                {stationAssignments.map((a, i) => {
                  const aColor = { Active: "text-emerald-400", Scheduled: "text-amber-400", Completed: "text-gray-500", Cancelled: "text-red-400" };
                  return (
                    <div key={i} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2 text-xs">
                      <span className="text-cyan-400 font-mono font-bold">{a.operator_callsign}</span>
                      <span className="text-gray-400">{a.role}</span>
                      <span className={`font-medium ${aColor[a.status] || "text-gray-400"}`}>{a.status}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Resource Requests */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <PackageSearch className="w-3.5 h-3.5 text-gray-500" />
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Resource Requests</p>
              {pendingRequests.length > 0 && (
                <span className="ml-auto text-xs bg-orange-500/20 text-orange-400 border border-orange-500/30 px-2 py-0.5 rounded-full font-medium">
                  {pendingRequests.length} pending
                </span>
              )}
            </div>
            {stationRequests.length === 0 ? (
              <p className="text-xs text-gray-600 italic">No resource requests</p>
            ) : (
              <div className="space-y-1.5">
                {stationRequests.map((r, i) => (
                  <div key={i} className="bg-gray-800 rounded-lg px-3 py-2 text-xs space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-white font-medium">{r.type}: {r.item}</span>
                      <span className={`font-medium ${reqStatusColor[r.status] || "text-gray-400"}`}>{r.status}</span>
                    </div>
                    <div className="flex items-center gap-3 text-gray-500">
                      {r.quantity && <span>{r.quantity} {r.unit}</span>}
                      <span className={reqPriColor[r.priority]}>{r.priority}</span>
                      {r.requested_by && <span>by {r.requested_by}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          {station.notes && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Notes</p>
              <p className="text-xs text-gray-400 bg-gray-800 rounded-lg px-3 py-2">{station.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}