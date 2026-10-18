import { X, Phone, Mail, ClipboardList } from "lucide-react";

const statusColor = { Available: "text-emerald-400", Assigned: "text-cyan-400", "En Route": "text-blue-400", "Off Duty": "text-gray-500", Standby: "text-amber-400" };
const statusDot = { Available: "bg-emerald-400", Assigned: "bg-cyan-400", "En Route": "bg-blue-400", "Off Duty": "bg-gray-600", Standby: "bg-amber-400" };
const aColor = { Active: "text-emerald-400", Scheduled: "text-amber-400", Completed: "text-gray-500", Cancelled: "text-red-400" };

export default function OperatorDetailModal({ operator, assignments, onClose }) {
  if (!operator) return null;

  const opAssignments = assignments.filter(a => a.operator_callsign === operator.callsign);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <span className={`w-3 h-3 rounded-full flex-shrink-0 mt-0.5 ${statusDot[operator.status] || "bg-gray-500"}`} />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-cyan-400 font-mono font-bold text-lg">{operator.callsign}</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-gray-800 ${statusColor[operator.status]}`}>{operator.status}</span>
              </div>
              <p className="text-white font-semibold">{operator.full_name}</p>
              {operator.license_class && <p className="text-gray-500 text-xs mt-0.5">{operator.license_class}</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* Contact */}
          {(operator.phone || operator.email) && (
            <div className="space-y-1.5">
              {operator.phone && (
                <p className="text-xs text-gray-400 flex items-center gap-2">
                  <Phone className="w-3 h-3 text-gray-600" /> {operator.phone}
                </p>
              )}
              {operator.email && (
                <p className="text-xs text-gray-400 flex items-center gap-2">
                  <Mail className="w-3 h-3 text-gray-600" /> {operator.email}
                </p>
              )}
            </div>
          )}

          {/* Certifications */}
          {(operator.certifications || []).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Certifications</p>
              <div className="flex flex-wrap gap-1.5">
                {operator.certifications.map((c, i) => (
                  <span key={i} className="text-xs bg-gray-800 border border-gray-700 px-2 py-0.5 rounded text-gray-300">{c}</span>
                ))}
              </div>
            </div>
          )}

          {/* Assignments */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ClipboardList className="w-3.5 h-3.5 text-gray-500" />
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Assignments</p>
            </div>
            {opAssignments.length === 0 ? (
              <p className="text-xs text-gray-600 italic">No assignments for this event</p>
            ) : (
              <div className="space-y-1.5">
                {opAssignments.map((a, i) => (
                  <div key={i} className="bg-gray-800 rounded-lg px-3 py-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-white font-medium">{a.station_name}</span>
                      <span className={`font-medium ${aColor[a.status] || "text-gray-400"}`}>{a.status}</span>
                    </div>
                    <div className="text-gray-500 mt-0.5">{a.role}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          {operator.notes && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Notes</p>
              <p className="text-xs text-gray-400 bg-gray-800 rounded-lg px-3 py-2">{operator.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}