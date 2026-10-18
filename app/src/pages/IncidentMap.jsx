import { useEffect, useRef, useState } from "react";
import { db, callFunction } from "@/api/ecs";
import { useEvent } from "@/components/EventContext";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// Basemap tiles need internet access. Point VITE_TILE_URL at a local tile server for offline events.
const TILE_URL = import.meta.env.VITE_TILE_URL || "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
import { Radio, Users, Layers, Info, UserCircle, Download } from "lucide-react";

// Fix default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const STATION_STATUS_COLORS = { Active: "#22c55e", Standby: "#f59e0b", Closed: "#6b7280", Requested: "#3b82f6" };

const makeIcon = (color, label, callsigns = [], assignStatus = "none", stationName = "", stationStatus = "", hasPendingRequests = false) => {
  const stationStatusColor = STATION_STATUS_COLORS[stationStatus] || "#9ca3af";
  const statusColors = { active: "#22c55e", scheduled: "#f59e0b", none: "#ef4444" };
  const statusDot = assignStatus !== "none"
    ? `<div style="position:absolute;top:-4px;right:-4px;width:10px;height:10px;border-radius:50%;background:${statusColors[assignStatus]};border:1.5px solid #111;"></div>`
    : `<div style="position:absolute;top:-4px;right:-4px;width:10px;height:10px;border-radius:50%;background:#ef4444;border:1.5px solid #111;"></div>`;
  const pendingDot = hasPendingRequests
    ? `<div style="position:absolute;top:-4px;left:-4px;width:15px;height:15px;border-radius:50%;background:#f97316;border:1.5px solid #111;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:white;">!</div>`
    : "";
  const callsignLine = callsigns.length > 0
    ? `<div style="color:#67e8f9;font-size:13px;font-weight:bold;font-family:monospace;">${callsigns.join(", ")}</div>`
    : `<div style="color:#ef4444;font-size:13px;font-weight:bold;font-family:monospace;">UNASSIGNED</div>`;
  const callsignHtml = `<div style="position:absolute;top:30px;left:50%;transform:translateX(-50%);white-space:nowrap;background:rgba(0,0,0,0.85);padding:3px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);pointer-events:none;text-align:center;">
    <div style="color:#ffffff;font-size:13px;font-weight:bold;font-family:sans-serif;">${stationName}</div>
    <div style="color:${stationStatusColor};font-size:12px;font-family:sans-serif;">${stationStatus}</div>
    ${callsignLine}
  </div>`;
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:28px;height:28px;">
      <div style="
        background:${color};
        border:2px solid rgba(255,255,255,0.8);
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        width:28px;height:28px;
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 2px 8px rgba(0,0,0,0.5);
      ">
        <span style="transform:rotate(45deg);font-size:10px;font-weight:bold;color:white;">${label}</span>
      </div>
      ${statusDot}
      ${pendingDot}
      ${callsignHtml}
    </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -30],
  });
};

const TYPE_COLOR_LABEL = {
  "Net Control": ["#06b6d4", "NC"],
  "Aide Station": ["#22c55e", "AS"],
  "Command Post": ["#8b5cf6", "CP"],
  "Staging": ["#f59e0b", "ST"],
  "Water Point": ["#3b82f6", "WP"],
  "Start Line": ["#10b981", "SL"],
  "Finish Line": ["#ec4899", "FL"],
  "Other": ["#6b7280", "?"],
};

const getStationIcon = (st, stationAssignments, pendingRequests = []) => {
  const [color, label] = TYPE_COLOR_LABEL[st.type] || TYPE_COLOR_LABEL["Other"];
  const callsigns = stationAssignments.map(a => a.operator_callsign);
  const hasActive = stationAssignments.some(a => a.status === "Active");
  const hasScheduled = stationAssignments.some(a => a.status === "Scheduled");
  const assignStatus = stationAssignments.length === 0 ? "none" : hasActive ? "active" : hasScheduled ? "scheduled" : "none";
  return makeIcon(color, label, callsigns, assignStatus, st.name, st.status, pendingRequests.length > 0);
};

function MapBoundsController({ stations, fittedRef }) {
  const map = useMap();
  useEffect(() => {
    if (fittedRef.current) return;
    const valid = stations.filter(s => s.latitude && s.longitude);
    if (valid.length > 0) {
      const bounds = L.latLngBounds(valid.map(s => [s.latitude, s.longitude]));
      map.fitBounds(bounds, { padding: [60, 60] });
      fittedRef.current = true;
    }
  }, [stations]);
  return null;
}

const STATUS_DOT = { Active: "#22c55e", Standby: "#f59e0b", Closed: "#6b7280", Requested: "#3b82f6" };

const makeOperatorIcon = (callsign, name) => {
  const label = `<div style="position:absolute;top:22px;left:50%;transform:translateX(-50%);white-space:nowrap;background:rgba(0,0,0,0.8);padding:2px 6px;border-radius:4px;border:1px solid rgba(139,92,246,0.4);pointer-events:none;text-align:center;">
    <div style="color:#c4b5fd;font-size:11px;font-weight:bold;font-family:monospace;">${callsign}</div>
    <div style="color:#9ca3af;font-size:10px;font-family:sans-serif;">${name ? name.split(" ")[0] : ""}</div>
  </div>`;
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:18px;height:18px;">
      <div style="width:18px;height:18px;border-radius:50%;background:#7c3aed;border:2px solid rgba(196,181,253,0.7);box-shadow:0 1px 4px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;">
        <div style="width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,0.8);"></div>
      </div>
      ${label}
    </div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -14],
  });
};

export default function IncidentMap() {
  const [stations, setStations] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [operators, setOperators] = useState([]);
  const [frequencies, setFrequencies] = useState([]);
  const [resourceRequests, setResourceRequests] = useState([]);
  const [showPanel, setShowPanel] = useState(true);
  const [showOperators, setShowOperators] = useState(false);
  const [loading, setLoading] = useState(true);
  const fittedRef = useRef(false);
  const { activeEventId } = useEvent();

  const getChannelName = (id) => {
    if (!id) return null;
    const freq = frequencies.find(f => f.id === id);
    return freq ? freq.name : null;
  };

  const loadData = async () => {
    const [sts, asgn, ops, reqs, freqs] = await Promise.all([
      db.aideStations.list(),
      db.assignments.list(),
      db.operators.list(),
      activeEventId ? db.resourceRequests.filter({ event_id: activeEventId }) : db.resourceRequests.list(),
      activeEventId ? db.frequencies.filter({ event_id: activeEventId }) : db.frequencies.list(),
    ]);
    setStations(activeEventId ? sts.filter(s => s.event_id === activeEventId) : sts);
    setAssignments(activeEventId ? asgn.filter(a => a.event_id === activeEventId) : asgn);
    setOperators(ops);
    setFrequencies(freqs);
    setResourceRequests(reqs.filter(r => r.status === "Pending" || r.status === "Approved" || r.status === "En Route"));
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    fittedRef.current = false;
    loadData();

    const unsubs = [
      db.aideStations.subscribe(() => loadData()),
      db.assignments.subscribe(() => loadData()),
      db.operators.subscribe(() => loadData()),
      db.resourceRequests.subscribe(() => loadData()),
      db.frequencies.subscribe(() => loadData()),
    ];
    return () => unsubs.forEach(u => u());
  }, [activeEventId]);

  // APRS.fi heartbeat — fires while this page is open; backend enforces 5-min cooldown
  // so only the first caller per window actually hits the APRS.fi API.
  useEffect(() => {
    callFunction('aprsFiTracker', {});
    const interval = setInterval(() => {
      callFunction('aprsFiTracker', {});
    }, 60000); // ping every minute; backend skips if < 5 min since last real call
    return () => clearInterval(interval);
  }, []);

  const getStationPendingRequests = (stationName) =>
    resourceRequests.filter(r => r.station_name === stationName);

  const getStationOperators = (stationName) =>
    assignments.filter(a => a.station_name === stationName).map(a => {
      const op = operators.find(o => o.callsign === a.operator_callsign);
      return { ...a, op };
    });

  const downloadGPX = () => {
    const wpts = validStations.map(st => `  <wpt lat="${st.latitude}" lon="${st.longitude}">
    <name>${st.station_id} - ${st.name}</name>
    <desc>${st.type} | ${st.status}${st.address ? " | " + st.address : ""}</desc>
    <sym>Flag, Blue</sym>
  </wpt>`).join("\n");
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SWCRS ECS" xmlns="http://www.topografix.com/GPX/1/1">
${wpts}
</gpx>`;
    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "event-map.gpx";
    a.click();
    URL.revokeObjectURL(url);
  };

  const validStations = stations.filter(s => s.latitude && s.longitude);
  const center = validStations.length > 0
    ? [validStations[0].latitude, validStations[0].longitude]
    : [34.0522, -118.2437];

  return (
    <div className="h-screen bg-gray-950 flex flex-col">
      <div className="flex-none px-6 py-4 border-b border-gray-800 bg-gray-900 flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold">Event Map</h1>
          <p className="text-gray-500 text-xs">{validStations.length} of {stations.length} positions plotted</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={downloadGPX} disabled={validStations.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-300 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
            <Download className="w-3.5 h-3.5" />
            GPX
          </button>
          <button onClick={() => setShowOperators(o => !o)}
            className={`flex items-center gap-2 px-3 py-1.5 border rounded-lg text-xs transition-all ${showOperators ? "bg-violet-600/20 border-violet-500/50 text-violet-300" : "bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-300"}`}>
            <UserCircle className="w-3.5 h-3.5" />
            Operators
          </button>
          <button onClick={() => setShowPanel(!showPanel)}
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-300 transition-all">
            <Layers className="w-3.5 h-3.5" />
            {showPanel ? "Hide Panel" : "Show Panel"}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Map */}
        <div className="flex-1 relative">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-gray-600">Loading map...</div>
          ) : (
            <MapContainer center={center} zoom={13} style={{ height: "100%", width: "100%", background: "#111827" }} zoomControl={true}>
              <TileLayer
                attribution='&copy; OpenStreetMap'
                url={TILE_URL}
              />
              {validStations.length > 1 && <MapBoundsController stations={validStations} fittedRef={fittedRef} />}
              {showOperators && operators.filter(o => o.latitude && o.longitude).map(op => (
                <Marker key={op.id} position={[op.latitude, op.longitude]} icon={makeOperatorIcon(op.callsign, op.full_name)}>
                  <Popup>
                    <div className="bg-gray-900 text-white rounded-lg p-3 min-w-[160px] text-sm">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-2 h-2 rounded-full bg-violet-400 flex-shrink-0" />
                        <span className="font-bold text-violet-300 font-mono">{op.callsign}</span>
                      </div>
                      <p className="text-white font-medium">{op.full_name}</p>
                      {op.status && <p className="text-gray-400 text-xs mt-1">{op.status}</p>}
                      {op.position_source && <p className="text-gray-600 text-xs mt-0.5">via {op.position_source}</p>}
                    </div>
                  </Popup>
                </Marker>
              ))}
              {validStations.map(st => (
                <Marker key={st.id} position={[st.latitude, st.longitude]} icon={getStationIcon(st, getStationOperators(st.name), getStationPendingRequests(st.name))}>
                  <Popup className="dark-popup">
                    <div className="bg-gray-900 text-white rounded-lg p-3 min-w-[200px] text-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_DOT[st.status] || "#6b7280" }} />
                        <span className="font-bold text-cyan-400 font-mono">{st.station_id}</span>
                        <span className="text-gray-400 text-xs">{st.type}</span>
                      </div>
                      <p className="font-semibold text-white">{st.name}</p>
                      {st.address && <p className="text-gray-400 text-xs mt-1">{st.address}</p>}
                      {st.primary_frequency_id && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <Radio className="w-3 h-3 text-cyan-400" />
                          <span className="text-xs font-mono text-cyan-300">{getChannelName(st.primary_frequency_id)}</span>
                          {st.backup_frequency_id && <span className="text-xs text-gray-500">/ {getChannelName(st.backup_frequency_id)}</span>}
                        </div>
                      )}
                      {(st.assets || []).length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs text-gray-500 mb-1">Assets:</p>
                          <div className="flex flex-wrap gap-1">
                            {st.assets.map((a, i) => <span key={i} className="text-xs bg-gray-800 px-1.5 py-0.5 rounded text-gray-300">{a}</span>)}
                          </div>
                        </div>
                      )}
                      {(() => {
                       const pending = getStationPendingRequests(st.name);
                       return pending.length > 0 ? (
                         <div className="mt-2 px-2 py-1.5 bg-orange-900/30 border border-orange-600/40 rounded text-xs text-orange-400">
                           <div className="font-bold mb-1">⚠ {pending.length} Pending Resource Request{pending.length > 1 ? "s" : ""}</div>
                           {pending.map((r, i) => (
                             <div key={i} className="text-orange-300">{r.type}: {r.item}</div>
                           ))}
                         </div>
                       ) : null;
                      })()}
                      {(() => {
                       const ops = getStationOperators(st.name);
                       const aStatusColor = { Active: "text-emerald-400", Scheduled: "text-amber-400", Completed: "text-gray-500", Cancelled: "text-red-400" };
                       return ops.length > 0 ? (
                         <div className="mt-2">
                           <p className="text-xs text-gray-500 mb-1.5">Operators:</p>
                           <div className="space-y-1">
                           {ops.map((a, i) => (
                             <div key={i} className="bg-gray-800 rounded px-2 py-1.5 text-xs">
                               <div className="flex items-center justify-between gap-2">
                                 <span className="text-cyan-400 font-mono font-bold">{a.operator_callsign}</span>
                                 <span className={`font-medium whitespace-nowrap ${aStatusColor[a.status] || "text-gray-400"}`}>{a.status}</span>
                               </div>
                               <div className="text-gray-400 mt-0.5">{a.op?.full_name ? a.op.full_name.split(" ")[0] : ""}{a.op?.full_name ? " · " : ""}<span className="text-gray-600">{a.role}</span></div>
                             </div>
                           ))}
                           </div>
                         </div>
                        ) : (
                          <div className="mt-2 px-2 py-1 bg-red-900/30 border border-red-700/30 rounded text-xs text-red-400">⚠ No operator assigned</div>
                        );
                      })()}
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          )}

          {validStations.length === 0 && !loading && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-gray-900/90 border border-gray-700 rounded-xl px-6 py-4 text-center">
                <Info className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                <p className="text-gray-400 text-sm">No stations with GPS coordinates yet.</p>
                <p className="text-gray-600 text-xs mt-1">Add latitude/longitude to stations to see them on the map.</p>
              </div>
            </div>
          )}
        </div>

        {/* Side panel */}
        {showPanel && (
          <div className="w-72 bg-gray-900 border-l border-gray-800 overflow-y-auto flex-shrink-0">
            <div className="px-4 py-3 border-b border-gray-800">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Position Legend</h2>
            </div>
            <div className="p-3 space-y-1.5">
              {[
                { type: "Net Control", color: "#06b6d4" },
                { type: "Aide Station", color: "#22c55e" },
                { type: "Command Post", color: "#8b5cf6" },
                { type: "Staging", color: "#f59e0b" },
                { type: "Water Point", color: "#3b82f6" },
                { type: "Start Line", color: "#10b981" },
                { type: "Finish Line", color: "#ec4899" },
              ].map(({ type, color }) => (
                <div key={type} className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
                  {type}
                </div>
              ))}
            </div>

            <div className="px-4 py-3 border-t border-b border-gray-800 mt-2">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Positions</h2>
            </div>
            <div className="p-3 space-y-2">
               {[...stations].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map(st => {
                 const ops = getStationOperators(st.name);
                 const pending = getStationPendingRequests(st.name);
                return (
                  <div key={st.id} className="bg-gray-800 rounded-lg px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_DOT[st.status] || "#6b7280" }} />
                      <span className="text-cyan-400 font-mono font-bold text-xs">{st.station_id}</span>
                      <span className="text-white text-xs font-medium truncate flex-1">{st.name}</span>
                      {pending.length > 0 && (
                        <span className="flex-shrink-0 w-4 h-4 rounded-full bg-orange-500 text-white text-[9px] font-bold flex items-center justify-center" title={`${pending.length} pending resource request(s)`}>!</span>
                      )}
                    </div>
                    {st.primary_frequency_id && (
                      <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        <Radio className="w-3 h-3" /> <span className="font-mono text-gray-400">{getChannelName(st.primary_frequency_id)}</span>
                        {st.backup_frequency_id && <span className="text-gray-600 font-mono"> / {getChannelName(st.backup_frequency_id)}</span>}
                      </p>
                    )}
                    {ops.length > 0 && (
                      <div className="mt-1.5 flex items-center gap-1">
                        <Users className="w-3 h-3 text-gray-600" />
                        <span className="text-xs text-gray-500">{ops.map(a => a.operator_callsign).join(", ")}</span>
                      </div>
                    )}
                    {!st.latitude && (
                      <p className="text-xs text-amber-600 mt-1">⚠ No GPS</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}