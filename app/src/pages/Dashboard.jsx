import { useEffect, useState, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { useEvent } from "@/components/EventContext";
import { Radio, Users, MapPin, ClipboardList, MessageSquare, Zap, AlertTriangle } from "lucide-react";
import StationDetailModal from "@/components/dashboard/StationDetailModal";
import OperatorDetailModal from "@/components/dashboard/OperatorDetailModal";

const OP_STATUS_COLOR = { Available: "text-emerald-400", Assigned: "text-cyan-400", "En Route": "text-blue-400", "Off Duty": "text-gray-500", Standby: "text-amber-400" };
const OP_STATUS_DOT  = { Available: "bg-emerald-400", Assigned: "bg-cyan-400", "En Route": "bg-blue-400", "Off Duty": "bg-gray-600", Standby: "bg-amber-400" };
const ST_COLOR = { Active: "text-emerald-400", Standby: "text-amber-400", Closed: "text-gray-500", Requested: "text-blue-400" };
const ST_DOT   = { Active: "bg-emerald-400", Standby: "bg-amber-400", Closed: "bg-gray-500", Requested: "bg-blue-400" };

export default function Dashboard() {
  const [operators, setOperators] = useState([]);
  const [stations, setStations] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [resourceRequests, setResourceRequests] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStation, setSelectedStation] = useState(null);
  const [selectedOperator, setSelectedOperator] = useState(null);
  const { activeEventId } = useEvent();

  const debounceTimer = useRef(null);

  const loadData = useCallback(async () => {
    const [ops, sts, asgn, msgs, reqs] = await Promise.all([
      base44.entities.Operator.filter({ event_id: activeEventId }),
      base44.entities.AideStation.filter({ event_id: activeEventId }),
      base44.entities.Assignment.filter({ event_id: activeEventId }),
      base44.entities.EventLog.filter({ event_id: activeEventId }, "-created_date", 20),
      base44.entities.ResourceRequest.filter({ event_id: activeEventId }),
    ]);
    setOperators(ops);
    setStations(sts);
    setAssignments(asgn);
    setResourceRequests(reqs);
    setMessages(msgs.filter(m => m.type === "communication").slice(0, 5));
    setLoading(false);
  }, [activeEventId]);

  const debouncedLoad = useCallback(() => {
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => loadData(), 1500);
  }, [loadData]);

  useEffect(() => {
    if (!activeEventId) { setLoading(false); return; }
    setLoading(true);
    loadData();

    const unsubs = [
      base44.entities.Operator.subscribe(debouncedLoad),
      base44.entities.AideStation.subscribe(debouncedLoad),
      base44.entities.Assignment.subscribe(debouncedLoad),
      base44.entities.EventLog.subscribe(debouncedLoad),
      base44.entities.ResourceRequest.subscribe(debouncedLoad),
    ];
    return () => { unsubs.forEach(u => u()); clearTimeout(debounceTimer.current); };
  }, [activeEventId]);

  const activeStations = stations.filter(s => s.status === "Active").length;
  const assignedOps = operators.filter(o => o.status === "Assigned").length;
  const activeAssignments = assignments.filter(a => a.status === "Active").length;
  const emergencyMsgs = messages.filter(m => m.type === "communication" && m.priority === "Emergency").length;

  const stats = [
    { label: "Operators", value: operators.length, sub: `${assignedOps} assigned`, icon: Users, color: "cyan", page: "Operators" },
    { label: "Stations", value: stations.length, sub: `${activeStations} active`, icon: Radio, color: "emerald", page: "AideStations" },
    { label: "Assignments", value: assignments.length, sub: `${activeAssignments} active`, icon: ClipboardList, color: "violet", page: "Assignments" },
    { label: "Messages", value: messages.length, sub: emergencyMsgs > 0 ? `${emergencyMsgs} EMERGENCY` : "no alerts", icon: MessageSquare, color: emergencyMsgs > 0 ? "red" : "amber", page: "Communications" },
  ];

  const colorMap = {
    cyan: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    violet: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    red: "bg-red-500/10 text-red-400 border-red-500/20",
  };

  const sortedOperators = [...operators].sort((a, b) => a.callsign.localeCompare(b.callsign));
  const sortedStations = [...stations].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const getStationOperatorStatus = (stationName) => {
    const ops = assignments.filter(a => a.station_name === stationName && (a.status === "Active" || a.status === "Scheduled"));
    if (ops.some(a => a.status === "Active")) return "active";
    if (ops.some(a => a.status === "Scheduled")) return "scheduled";
    return "none";
  };

  const getStationPendingRequests = (stationName) =>
    resourceRequests.filter(r => r.station_name === stationName && (r.status === "Pending" || r.status === "Approved" || r.status === "En Route"));

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Operations Dashboard</h1>
            <p className="text-gray-500 text-sm mt-1">SWCRS Event Communications Systems</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-xs text-emerald-400 font-medium">NET ACTIVE</span>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map(({ label, value, sub, icon: Icon, color, page }) => (
            <Link key={label} to={createPageUrl(page)} className={`rounded-xl border p-4 flex flex-col gap-3 transition-all hover:scale-[1.02] ${colorMap[color]}`}>
              <div className="flex items-center justify-between">
                <Icon className="w-5 h-5" />
                <span className="text-2xl font-bold text-white">{loading ? "—" : value}</span>
              </div>
              <div>
                <p className="text-sm font-semibold">{label}</p>
                <p className="text-xs opacity-70 mt-0.5">{loading ? "..." : sub}</p>
              </div>
            </Link>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-6 items-start">
          {/* Operator Status */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Operator Status</h2>
              <Link to={createPageUrl("Operators")} className="text-xs text-cyan-400 hover:text-cyan-300">Manage →</Link>
            </div>
            {loading ? (
              <div className="space-y-2">{[0,1,2,3].map((i) => <div key={i} className="h-10 bg-gray-800 rounded-lg animate-pulse" />)}</div>
            ) : operators.length === 0 ? (
              <p className="text-gray-600 text-sm text-center py-8">No operators registered</p>
            ) : (
              <div className="space-y-1.5">
                {sortedOperators.map(op => (
                  <button
                    key={op.id}
                    onClick={() => setSelectedOperator(op)}
                    className="w-full flex items-center justify-between bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-2 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${OP_STATUS_DOT[op.status] || "bg-gray-500"}`} />
                      <span className="text-sm text-white font-bold font-mono">{op.callsign}</span>
                      <span className="text-xs text-gray-400 truncate max-w-[120px]">{op.full_name}</span>
                    </div>
                    <span className={`text-xs font-medium ${OP_STATUS_COLOR[op.status] || "text-gray-400"}`}>{op.status}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Station Status */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Station Status</h2>
              <Link to={createPageUrl("AideStations")} className="text-xs text-cyan-400 hover:text-cyan-300">Manage →</Link>
            </div>
            {loading ? (
              <div className="space-y-2">{[0,1,2,3].map((i) => <div key={i} className="h-10 bg-gray-800 rounded-lg animate-pulse" />)}</div>
            ) : stations.length === 0 ? (
              <p className="text-gray-600 text-sm text-center py-8">No stations configured</p>
            ) : (
              <div className="space-y-1.5">
                {sortedStations.map(st => {
                  const opStatus = getStationOperatorStatus(st.name);
                  const pending = getStationPendingRequests(st.name);
                  const opDot = opStatus === "active" ? "bg-emerald-400" : opStatus === "scheduled" ? "bg-amber-400" : "bg-red-500";
                  const opLabel = opStatus === "active" ? "Op ✓" : opStatus === "scheduled" ? "Sched" : "No Op";
                  const opLabelColor = opStatus === "active" ? "text-emerald-400" : opStatus === "scheduled" ? "text-amber-400" : "text-red-400";
                  return (
                    <button
                      key={st.id}
                      onClick={() => setSelectedStation(st)}
                      className="w-full flex items-center gap-2 bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-2 transition-colors text-left"
                    >
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ST_DOT[st.status] || "bg-gray-500"}`} />
                      <span className="text-sm text-white font-medium font-mono w-12 flex-shrink-0">{st.station_id}</span>
                      <span className="text-xs text-gray-400 truncate flex-1">{st.name}</span>
                      {/* Operator presence */}
                      <span className={`text-xs font-medium flex-shrink-0 ${opLabelColor}`}>{opLabel}</span>
                      {/* Resource requests */}
                      {pending.length > 0 ? (
                        <span className="flex-shrink-0 flex items-center gap-1 text-xs text-orange-400 font-medium">
                          <span className="w-3.5 h-3.5 rounded-full bg-orange-500 text-white text-[9px] font-bold flex items-center justify-center">!</span>
                          {pending.length}
                        </span>
                      ) : (
                        <span className="w-8 flex-shrink-0" />
                      )}
                      <span className={`text-xs font-medium flex-shrink-0 ${ST_COLOR[st.status]}`}>{st.status}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Quick links */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: "Open Incident Map", page: "IncidentMap", IconComp: MapPin },
            { label: "Manage Frequencies", page: "Frequencies", IconComp: Zap },
            { label: "Send Message", page: "Communications", IconComp: MessageSquare },
          ].map(({ label, page, IconComp }) => (
            <Link key={page} to={createPageUrl(page)} className="flex items-center gap-3 bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-xl px-4 py-3 transition-all group">
              <IconComp className="w-4 h-4 text-cyan-400 group-hover:scale-110 transition-transform" />
              <span className="text-sm text-gray-300">{label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Modals */}
      {selectedStation && (
        <StationDetailModal
          station={selectedStation}
          assignments={assignments}
          resourceRequests={resourceRequests}
          onClose={() => setSelectedStation(null)}
        />
      )}
      {selectedOperator && (
        <OperatorDetailModal
          operator={selectedOperator}
          assignments={assignments}
          onClose={() => setSelectedOperator(null)}
        />
      )}
    </div>
  );
}