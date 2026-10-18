import { useEffect, useState, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useEvent } from "@/components/EventContext";
import { CalendarClock, ChevronDown, ChevronRight, Radio, Users } from "lucide-react";

const ROLE_COLORS = {
  "Net Control": "#22d3ee",
  "Station Operator": "#4ade80",
  "Liaison": "#a78bfa",
  "Floater": "#fbbf24",
  "Backup": "#9ca3af",
};

const STATUS_ALPHA = {
  Scheduled: "cc",
  Active: "ff",
  Completed: "88",
  Cancelled: "44",
};

function toMs(dt) {
  if (!dt) return null;
  return new Date(dt).getTime();
}

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(ms) {
  const d = new Date(ms);
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function formatDate(ms) {
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}

// Clamp a value between min and max
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// Snap to nearest 15-minute increment
const SNAP_MS = 15 * 60 * 1000;
function snap15(ms) { return Math.round(ms / SNAP_MS) * SNAP_MS; }

export default function EventSchedule() {
   const { activeEventId } = useEvent();
   const [event, setEvent] = useState(null);
   const [stations, setStations] = useState([]);
   const [assignments, setAssignments] = useState([]);
   const [loading, setLoading] = useState(true);
   const [collapsed, setCollapsed] = useState({});
   const [tooltip, setTooltip] = useState(null);
   const [now, setNow] = useState(Date.now());

  // Drag state for resizing assignment bars
  const dragRef = useRef(null);
  const timelineRef = useRef(null);

  const load = async () => {
    setLoading(true);
    const [allEvents, st, as] = await Promise.all([
      base44.entities.Event.list(),
      base44.entities.AideStation.filter({ event_id: activeEventId }),
      base44.entities.Assignment.filter({ event_id: activeEventId }),
    ]);
    const ev = allEvents.find(e => e.id === activeEventId) || null;
    setEvent(ev);
    st.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    setStations(st);
    setAssignments(as);
    setLoading(false);
  };

  useEffect(() => {
    if (activeEventId) load();
  }, [activeEventId]);

  // Update current time every second for the "now" line
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // --- Compute timeline window ---
  const eventStart = toMs(event?.start_datetime);
  const eventEnd = toMs(event?.end_datetime);

  // Fall back: derive from stations / assignments if event has no times
  const allStarts = [
    eventStart,
    ...stations.map(s => toMs(s.start_datetime)),
    ...assignments.map(a => toMs(a.start_time)),
  ].filter(Boolean);
  const allEnds = [
    eventEnd,
    ...stations.map(s => toMs(s.end_datetime)),
    ...assignments.map(a => toMs(a.end_time)),
  ].filter(Boolean);

  const winStart = allStarts.length ? Math.min(...allStarts) : Date.now();
  const winEnd = allEnds.length ? Math.max(...allEnds) : Date.now() + 8 * 3600 * 1000;
  const winDuration = winEnd - winStart || 1;

  // Position helpers
  const pct = (ms) => clamp(((ms - winStart) / winDuration) * 100, 0, 100);
  const width = (startMs, endMs) => clamp(((endMs - startMs) / winDuration) * 100, 0.5, 100);

  // --- Drag logic (shared for assignments and stations) ---
  // type: "assignment" | "station"
  const startDrag = useCallback((e, item, edge, type) => {
    e.preventDefault();
    const origStart = type === "station" ? toMs(item.start_datetime) : toMs(item.start_time);
    const origEnd   = type === "station" ? toMs(item.end_datetime)   : toMs(item.end_time);
    dragRef.current = { id: item.id, edge, startX: e.clientX, origStart, origEnd, type };

    const onMove = (ev) => {
      const ref = dragRef.current;
      if (!ref) return;
      const rect = timelineRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pxPerMs = rect.width / winDuration;
      const deltaPx = ev.clientX - ref.startX;
      const deltaMs = deltaPx / pxPerMs;

      let newStart = ref.origStart;
      let newEnd = ref.origEnd;
      if (ref.edge === "move") {
        const dur = newEnd - newStart;
        newStart = snap15(clamp(ref.origStart + deltaMs, winStart, winEnd - dur));
        newEnd = newStart + dur;
      } else if (ref.edge === "left") {
        newStart = snap15(clamp(ref.origStart + deltaMs, winStart, (ref.origEnd || winEnd) - SNAP_MS));
      } else if (ref.edge === "right") {
        newEnd = snap15(clamp((ref.origEnd || winEnd) + deltaMs, (ref.origStart || winStart) + SNAP_MS, winEnd));
      }

      if (ref.type === "station") {
        setStations(prev => prev.map(s => s.id !== ref.id ? s : {
          ...s, start_datetime: new Date(newStart).toISOString(), end_datetime: new Date(newEnd).toISOString(),
        }));
      } else {
        setAssignments(prev => prev.map(a => a.id !== ref.id ? a : {
          ...a, start_time: new Date(newStart).toISOString(), end_time: new Date(newEnd).toISOString(),
        }));
      }
    };

    const onUp = () => {
      const ref = dragRef.current;
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (!ref) return;
      if (ref.type === "station") {
        setStations(prev => {
          const s = prev.find(x => x.id === ref.id);
          if (s) base44.entities.AideStation.update(s.id, { start_datetime: s.start_datetime, end_datetime: s.end_datetime });
          return prev;
        });
      } else {
        setAssignments(prev => {
          const a = prev.find(x => x.id === ref.id);
          if (a) base44.entities.Assignment.update(a.id, { start_time: a.start_time, end_time: a.end_time });
          return prev;
        });
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [winStart, winEnd, winDuration]);

  // Tick marks
  const tickCount = 8;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => winStart + (winDuration * i) / tickCount);

  const toggleCollapse = (stId) => setCollapsed(c => ({ ...c, [stId]: !c[stId] }));

  // Click on timeline row to place an unscheduled assignment
  const placeAssignment = useCallback(async (e, assignment) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clickPct = (e.clientX - rect.left) / rect.width;
    const clickMs = winStart + clickPct * winDuration;
    const newStart = snap15(clickMs);
    const newEnd = newStart + 60 * 60 * 1000; // default 1 hour
    const updated = { start_time: new Date(newStart).toISOString(), end_time: new Date(newEnd).toISOString() };
    await base44.entities.Assignment.update(assignment.id, updated);
    setAssignments(prev => prev.map(a => a.id === assignment.id ? { ...a, ...updated } : a));
  }, [winStart, winDuration]);

  if (!activeEventId) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <CalendarClock className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Select an active event to view the schedule.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-600">Loading schedule…</div>;
  }

  const hasEventTimes = !!(event?.start_datetime && event?.end_datetime);

  return (
    <div className="min-h-screen bg-gray-950 p-4 lg:p-6 select-none">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">Event Schedule</h1>
          <p className="text-gray-500 text-sm mt-1">{event?.name}{event?.operational_period ? ` · Op Period: ${event.operational_period}` : ""}</p>
          {!hasEventTimes && (
            <p className="text-xs text-amber-400/70 mt-1">⚠ No event start/end times set — timeline derived from station and assignment times.</p>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 text-xs text-gray-500">
          {Object.entries(ROLE_COLORS).map(([role, color]) => (
            <span key={role} className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm inline-block flex-shrink-0" style={{ background: color }} />
              {role}
            </span>
          ))}
        </div>

        {/* Timeline */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">

          {/* Time axis */}
          <div className="flex border-b border-gray-800">
            <div className="w-48 flex-shrink-0 border-r border-gray-800 px-3 py-2 text-xs text-gray-600 font-medium">Station / Operator</div>
            <div className="flex-1 relative h-12" ref={timelineRef}>
              {ticks.map((t, i) => (
                <div key={i} className="absolute top-0 h-full flex flex-col items-center" style={{ left: `${pct(t)}%` }}>
                  <div className="w-px h-2 bg-gray-700 mt-1" />
                  <span className="text-[9px] text-gray-600 whitespace-nowrap mt-0.5 -translate-x-1/2 leading-tight">
                    <div>{formatDate(t)}</div>
                    <div className="text-gray-700">{formatTime(t)}</div>
                  </span>
                </div>
              ))}
              {/* Current time line */}
              <div className="absolute top-0 h-full w-px bg-red-500" style={{ left: `${pct(now)}%` }} />
            </div>
          </div>

          {/* Level 1: Event bar */}
          {hasEventTimes && (
            <div className="flex border-b border-gray-800/60">
              <div className="w-48 flex-shrink-0 border-r border-gray-800 px-3 py-2.5 flex items-center gap-2">
                <CalendarClock className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                <span className="text-xs font-semibold text-cyan-300 truncate">{event?.name}</span>
              </div>
              <div className="flex-1 relative py-2.5 px-0 h-10">
                <div
                  className="absolute top-2 h-5 rounded bg-cyan-500/20 border border-cyan-500/40 flex items-center px-2 overflow-hidden"
                  style={{ left: `${pct(eventStart)}%`, width: `${width(eventStart, eventEnd)}%` }}
                >
                  <span className="text-[10px] text-cyan-300 whitespace-nowrap font-medium">
                    {formatTime(eventStart)} – {formatTime(eventEnd)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Levels 2 & 3: Stations + Assignments */}
          {stations.length === 0 ? (
            <div className="p-10 text-center text-gray-600 text-sm">No aide stations configured for this event.</div>
          ) : stations.map(station => {
            const stStart = toMs(station.start_datetime);
            const stEnd = toMs(station.end_datetime);
            const stAssignments = assignments.filter(a => a.station_name === station.name);
            const isCollapsed = collapsed[station.id];

            return (
              <div key={station.id} className="border-b border-gray-800/50">
                {/* Level 2: Station row */}
                <div className="flex hover:bg-gray-800/30 transition-colors">
                  <div
                    className="w-48 flex-shrink-0 border-r border-gray-800 px-3 py-2.5 flex items-center gap-2 cursor-pointer"
                    onClick={() => toggleCollapse(station.id)}
                  >
                    {stAssignments.length > 0 ? (
                      isCollapsed
                        ? <ChevronRight className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                        : <ChevronDown className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                    ) : <span className="w-3.5 flex-shrink-0" />}
                    <Radio className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">{station.station_id}</div>
                      <div className="text-[10px] text-gray-500 truncate">{station.name}</div>
                    </div>
                  </div>
                  <div className="flex-1 relative py-2.5 h-11">
                    {stStart && stEnd ? (
                      <div
                        className="absolute top-2 h-6 rounded bg-emerald-500/15 border border-emerald-500/30 flex items-center overflow-visible cursor-grab active:cursor-grabbing group"
                        style={{ left: `${pct(stStart)}%`, width: `${width(stStart, stEnd)}%` }}
                        onMouseDown={e => startDrag(e, station, "move", "station")}
                        onMouseEnter={e => setTooltip({ x: e.clientX, y: e.clientY, text: `${station.name}: ${formatTime(stStart)} – ${formatTime(stEnd)}` })}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        {/* Left resize handle */}
                        <div
                          className="absolute left-0 top-0 h-full w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity rounded-l flex items-center justify-center"
                          style={{ background: "#4ade8044" }}
                          onMouseDown={e => { e.stopPropagation(); startDrag(e, station, "left", "station"); }}
                        >
                          <div className="w-0.5 h-3 rounded bg-emerald-400" />
                        </div>
                        <span className="text-[10px] text-emerald-300 whitespace-nowrap px-2 flex-1 truncate">
                          {formatTime(stStart)} – {formatTime(stEnd)}
                        </span>
                        {/* Right resize handle */}
                        <div
                          className="absolute right-0 top-0 h-full w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity rounded-r flex items-center justify-center"
                          style={{ background: "#4ade8044" }}
                          onMouseDown={e => { e.stopPropagation(); startDrag(e, station, "right", "station"); }}
                        >
                          <div className="w-0.5 h-3 rounded bg-emerald-400" />
                        </div>
                      </div>
                    ) : stAssignments.length > 0 ? (
                      <div className="absolute inset-y-0 flex items-center px-2">
                        <span className="text-[10px] text-gray-700">No station times set</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Level 3: Assignment rows */}
                {!isCollapsed && stAssignments.map(a => {
                  const aStart = toMs(a.start_time);
                  const aEnd = toMs(a.end_time);
                  const color = ROLE_COLORS[a.role] || "#9ca3af";
                  const alpha = STATUS_ALPHA[a.status] || "cc";
                  const hasBar = aStart && aEnd;

                  return (
                    <div key={a.id} className="flex hover:bg-gray-800/20 transition-colors bg-gray-950/40">
                      <div className="w-48 flex-shrink-0 border-r border-gray-800 pl-8 pr-3 py-2 flex items-center gap-2">
                        <Users className="w-3 h-3 text-gray-600 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[11px] font-mono font-bold truncate" style={{ color }}>{a.operator_callsign}</div>
                          <div className="text-[10px] text-gray-600 truncate">{a.role}</div>
                        </div>
                      </div>
                      <div className="flex-1 relative py-2 h-9">
                        {hasBar ? (
                          <div
                            className="absolute top-1.5 h-5 rounded flex items-center overflow-visible cursor-grab active:cursor-grabbing group"
                            style={{
                              left: `${pct(aStart)}%`,
                              width: `${width(aStart, aEnd)}%`,
                              background: `${color}22`,
                              border: `1px solid ${color}66`,
                            }}
                            onMouseDown={e => startDrag(e, a, "move", "assignment")}
                            onMouseEnter={e => setTooltip({ x: e.clientX, y: e.clientY, text: `${a.operator_callsign} (${a.role}): ${formatTime(aStart)} – ${formatTime(aEnd)}` })}
                            onMouseLeave={() => setTooltip(null)}
                          >
                            {/* Left resize handle */}
                            <div
                              className="absolute left-0 top-0 h-full w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity rounded-l flex items-center justify-center"
                              style={{ background: `${color}44` }}
                              onMouseDown={e => { e.stopPropagation(); startDrag(e, a, "left", "assignment"); }}
                            >
                              <div className="w-0.5 h-3 rounded" style={{ background: color }} />
                            </div>
                            <span className="text-[10px] font-mono px-2 truncate flex-1" style={{ color }}>
                              {a.operator_callsign}
                            </span>
                            {/* Right resize handle */}
                            <div
                              className="absolute right-0 top-0 h-full w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity rounded-r flex items-center justify-center"
                              style={{ background: `${color}44` }}
                              onMouseDown={e => { e.stopPropagation(); startDrag(e, a, "right", "assignment"); }}
                            >
                              <div className="w-0.5 h-3 rounded" style={{ background: color }} />
                            </div>
                          </div>
                        ) : (
                          <div
                            className="absolute inset-0 flex items-center px-2 cursor-crosshair group/place"
                            onClick={e => placeAssignment(e, a)}
                            title="Click to place assignment on timeline"
                          >
                            <span className="text-[10px] text-gray-700 group-hover/place:text-cyan-600 transition-colors">
                              {a.operator_callsign} — click to place
                            </span>
                            <span className="ml-2 text-[9px] text-gray-800 group-hover/place:text-cyan-700 transition-colors">+</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-gray-700 text-center">Click unscheduled rows to place · Drag bars to move · Drag edges to resize · Snaps to 15-min · Changes auto-save</p>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white pointer-events-none shadow-xl"
          style={{ left: tooltip.x + 12, top: tooltip.y - 30 }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}