import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useEvent } from "@/components/EventContext";
import { useAuth } from "@/components/PinGate";
import { formatEventTime } from "@/lib/eventTime";
import {
  CheckCircle2, Circle, Clock, AlertTriangle, RefreshCw, Radio, Users,
  Zap, MessageSquare, MapPin, ClipboardList, Plus, Pencil, Trash2, X, Save
} from "lucide-react";

const DEFAULT_TASKS = [
  { id: "net_roll_call", label: "Net Roll Call / Check-ins", desc: "Announce net, invite check-ins, confirm all stations are on frequency", interval: 1800 },
  { id: "station_status", label: "Poll Station Status", desc: "Contact each aide station, confirm status (Active/Standby/Closed) and staffing", interval: 900 },
  { id: "operator_welfare", label: "Operator Welfare Check", desc: "Confirm all operators are comfortable — hydration, shade, breaks needed", interval: 3600 },
  { id: "sitrep", label: "Situation Report (SITREP)", desc: "Collect and relay any medical, resource, or logistical updates from stations", interval: 1800 },
  { id: "freq_check", label: "Frequency / Interference Check", desc: "Confirm primary and backup frequencies are clear, no QRM or desense", interval: 1200 },
  { id: "msg_log_review", label: "Message Log Review", desc: "Review unacknowledged messages, follow up on any Priority or Emergency traffic", interval: 600 },
  { id: "resource_request", label: "Resource / Supply Check", desc: "Ask stations if any supplies, relief operators, or equipment are needed", interval: 3600 },
  { id: "time_hack", label: "Time Hack / Net Time", desc: "Announce current time on net for logging synchronization", interval: 3600 },
  { id: "medical_summary", label: "Medical Incident Summary", desc: "Request medical stats from all aide stations (treatments, transports, holds)", interval: 1800 },
  { id: "backup_freq_test", label: "Backup Frequency Test", desc: "Brief test of backup/tactical frequency — confirm all stations can copy", interval: 7200 },
];

const TASKS_CONFIG_KEY = "nco_tasks";
const TIMERS_CONFIG_KEY = "nco_timers";

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return `${h}h ${rem}m`;
  }
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function urgencyClass(elapsed, interval) {
  const ratio = elapsed / interval;
  if (ratio >= 1.5) return "border-red-500/60 bg-red-500/5";
  if (ratio >= 1.0) return "border-amber-500/60 bg-amber-500/5";
  if (ratio >= 0.75) return "border-yellow-600/40 bg-yellow-600/5";
  return "border-gray-700 bg-gray-900";
}

function urgencyBadge(elapsed, interval) {
  const ratio = elapsed / interval;
  if (ratio >= 1.5) return { label: "OVERDUE", cls: "bg-red-500/20 text-red-400 border border-red-500/30" };
  if (ratio >= 1.0) return { label: "DUE NOW", cls: "bg-amber-500/20 text-amber-400 border border-amber-500/30" };
  if (ratio >= 0.75) return { label: "SOON", cls: "bg-yellow-600/20 text-yellow-400 border border-yellow-600/30" };
  return null;
}

function timeRemaining(elapsed, interval) {
  return Math.max(0, interval - elapsed);
}

export default function NetControl() {
  const { activeEvent, activeEventId } = useEvent();
  const tz = activeEvent?.timezone || "America/Phoenix";
  const { isAdmin, canEdit } = useAuth();
  const [tasks, setTasks] = useState(DEFAULT_TASKS);
  // timers: { [taskId]: { lastDone: timestamp_ms | null } }
  const [timers, setTimers] = useState({});
  const [messages, setMessages] = useState([]);
  const [tick, setTick] = useState(0);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [tasksConfigId, setTasksConfigId] = useState(null);
  const [timersConfigId, setTimersConfigId] = useState(null);

  // Edit modal state
  const [editingTask, setEditingTask] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTask, setNewTask] = useState({ label: "", desc: "", interval: 1800 });
  // Task completion note prompt
  const [pendingDoneTask, setPendingDoneTask] = useState(null); // task object awaiting note
  const [doneNote, setDoneNote] = useState("");
  const saveTimerRef = useRef(null);

  // Tick every second
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Load tasks + timers from AppConfig on mount
  useEffect(() => {
    const load = async () => {
      const configs = await base44.entities.AppConfig.list();
      const tasksCfg = configs.find(c => c.key === TASKS_CONFIG_KEY);
      const timersCfg = configs.find(c => c.key === TIMERS_CONFIG_KEY);

      if (tasksCfg) {
        try {
          const parsed = JSON.parse(tasksCfg.value);
          if (Array.isArray(parsed) && parsed.length > 0) setTasks(parsed);
        } catch {}
        setTasksConfigId(tasksCfg.id);
      }

      if (timersCfg) {
        try {
          const parsed = JSON.parse(timersCfg.value);
          setTimers(parsed || {});
        } catch {}
        setTimersConfigId(timersCfg.id);
      }

      setConfigLoaded(true);
    };
    load();
  }, []);

  // Save timers to AppConfig (debounced) whenever timers change
  useEffect(() => {
    if (!configLoaded) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const value = JSON.stringify(timers);
      if (timersConfigId) {
        await base44.entities.AppConfig.update(timersConfigId, { value });
      } else {
        const created = await base44.entities.AppConfig.create({ key: TIMERS_CONFIG_KEY, value });
        setTimersConfigId(created.id);
      }
    }, 1000);
  }, [timers, configLoaded]);

  // Save tasks to AppConfig whenever tasks change
  const saveTasks = async (updatedTasks) => {
    const value = JSON.stringify(updatedTasks);
    if (tasksConfigId) {
      await base44.entities.AppConfig.update(tasksConfigId, { value });
    } else {
      const created = await base44.entities.AppConfig.create({ key: TASKS_CONFIG_KEY, value });
      setTasksConfigId(created.id);
    }
  };

  // Load situational data
  useEffect(() => {
    if (!activeEventId) return;
    let cancelled = false;
    const load = async () => {
      const msgs = await base44.entities.EventLog.filter({ event_id: activeEventId });
      if (!cancelled) setMessages(msgs);
    };
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeEventId]);

  const getElapsed = (taskId, interval) => {
    const t = timers[taskId];
    if (t?.lastDone) return Math.floor((Date.now() - t.lastDone) / 1000);
    // If never done, count up from start of app config or just use interval as default
    return interval; // show as due
  };

  const markDone = (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    setPendingDoneTask(task);
    setDoneNote("");
  };

  const confirmDone = async () => {
    if (!pendingDoneTask) return;
    const task = pendingDoneTask;
    setTimers(prev => ({ ...prev, [task.id]: { lastDone: Date.now() } }));
    setPendingDoneTask(null);
    if (activeEventId) {
      await base44.entities.EventLog.create({
        event_id: activeEventId,
        type: "task_completion",
        task_id: task.id,
        task_label: task.label,
        content: doneNote.trim() || task.label,
        priority: "Routine",
      });
    }
    setDoneNote("");
  };

  const resetTask = (taskId) => {
    setTimers(prev => ({ ...prev, [taskId]: { lastDone: null } }));
  };

  const deleteTask = async (taskId) => {
    const updated = tasks.filter(t => t.id !== taskId);
    setTasks(updated);
    await saveTasks(updated);
  };

  const saveEditTask = async () => {
    const updated = tasks.map(t => t.id === editingTask.id ? editingTask : t);
    setTasks(updated);
    setEditingTask(null);
    await saveTasks(updated);
  };

  const addTask = async () => {
    if (!newTask.label.trim()) return;
    const task = {
      id: `task_${Date.now()}`,
      label: newTask.label.trim(),
      desc: newTask.desc.trim(),
      interval: Number(newTask.interval) || 1800,
    };
    const updated = [...tasks, task];
    setTasks(updated);
    setNewTask({ label: "", desc: "", interval: 1800 });
    setShowAddForm(false);
    await saveTasks(updated);
  };

  const unackedMsgs = messages.filter(m => m.type === "communication" && !m.acknowledged && (m.priority === "Emergency" || m.priority === "Priority"));

  // Sort tasks: soonest due (least time remaining) first
  const sortedTasks = [...tasks].sort((a, b) => {
    const ra = timeRemaining(getElapsed(a.id, a.interval), a.interval);
    const rb = timeRemaining(getElapsed(b.id, b.interval), b.interval);
    return ra - rb;
  });

  if (!activeEventId) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <Radio className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Select an active event to begin.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-4 lg:p-6">

      {/* Task completion note modal */}
      {pendingDoneTask && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-cyan-500/30 rounded-2xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <h3 className="text-white font-semibold">Task Complete</h3>
            </div>
            <p className="text-sm text-gray-300">{pendingDoneTask.label}</p>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Note (optional)</label>
              <textarea
                autoFocus
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50 resize-none"
                rows={3}
                placeholder="Any observations or details to log..."
                value={doneNote}
                onChange={e => setDoneNote(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); confirmDone(); } }}
              />
            </div>
            <div className="flex gap-2">
              <button onClick={confirmDone} className="flex-1 flex items-center justify-center gap-2 py-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold rounded-lg text-sm transition-all">
                <CheckCircle2 className="w-4 h-4" /> Confirm Done
              </button>
              <button onClick={() => setPendingDoneTask(null)} className="px-4 py-2 text-gray-400 hover:text-white border border-gray-700 rounded-lg text-sm transition-all">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">NCO Task Assistant</h1>
            <p className="text-gray-500 text-sm mt-1">{activeEvent?.name} · NCS: {activeEvent?.net_control_callsign || "—"}</p>
          </div>
          <div className="text-right text-xs text-gray-600">
            <div className="text-gray-400 font-mono text-lg">{formatEventTime(new Date().toISOString(), tz)}</div>
          </div>
        </div>

        {/* Situational awareness bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className={`border rounded-xl p-4 text-center ${unackedMsgs.length > 0 ? "bg-red-500/10 border-red-500/40" : "bg-gray-900 border-gray-800"}`}>
            <div className={`text-2xl font-bold ${unackedMsgs.length > 0 ? "text-red-400" : "text-gray-400"}`}>{unackedMsgs.length}</div>
            <div className="text-xs text-gray-500 mt-1">Unacked Priority+ Msgs</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-gray-400">{tasks.length}</div>
            <div className="text-xs text-gray-500 mt-1">Active Tasks</div>
          </div>
        </div>

        {/* NCO Task Queue */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">NCO Task Queue</h2>
            {canEdit && (
              <button
                onClick={() => setShowAddForm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-400 text-xs font-semibold rounded-lg transition-all"
              >
                <Plus className="w-3.5 h-3.5" /> Add Task
              </button>
            )}
          </div>

          {/* Add Task Form */}
          {showAddForm && (
            <div className="bg-gray-900 border border-cyan-500/30 rounded-xl p-4 mb-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white">New Task</span>
                <button onClick={() => setShowAddForm(false)}><X className="w-4 h-4 text-gray-500" /></button>
              </div>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
                placeholder="Task label"
                value={newTask.label}
                onChange={e => setNewTask(p => ({ ...p, label: e.target.value }))}
              />
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
                placeholder="Description (optional)"
                value={newTask.desc}
                onChange={e => setNewTask(p => ({ ...p, desc: e.target.value }))}
              />
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400 whitespace-nowrap">Interval (minutes)</label>
                <input
                  type="number"
                  className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
                  value={Math.round(newTask.interval / 60)}
                  min={1}
                  onChange={e => setNewTask(p => ({ ...p, interval: Number(e.target.value) * 60 }))}
                />
              </div>
              <button
                onClick={addTask}
                className="flex items-center gap-1.5 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-semibold text-sm rounded-lg transition-all"
              >
                <Save className="w-3.5 h-3.5" /> Save Task
              </button>
            </div>
          )}

          <div className="space-y-2">
            {sortedTasks.map(task => {
              const elapsed = getElapsed(task.id, task.interval);
              const badge = urgencyBadge(elapsed, task.interval);
              const cardCls = urgencyClass(elapsed, task.interval);
              const progressPct = Math.min((elapsed / task.interval) * 100, 100);
              const remaining = timeRemaining(elapsed, task.interval);

              return (
                <div key={task.id} className={`border rounded-xl p-4 transition-all ${cardCls}`}>
                  {editingTask?.id === task.id ? (
                    <div className="space-y-3">
                      <input
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                        value={editingTask.label}
                        onChange={e => setEditingTask(p => ({ ...p, label: e.target.value }))}
                      />
                      <input
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                        value={editingTask.desc}
                        onChange={e => setEditingTask(p => ({ ...p, desc: e.target.value }))}
                      />
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-400 whitespace-nowrap">Interval (minutes)</label>
                        <input
                          type="number"
                          className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                          value={Math.round(editingTask.interval / 60)}
                          min={1}
                          onChange={e => setEditingTask(p => ({ ...p, interval: Number(e.target.value) * 60 }))}
                        />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={saveEditTask} className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-semibold text-xs rounded-lg transition-all">
                          <Save className="w-3.5 h-3.5" /> Save
                        </button>
                        <button onClick={() => setEditingTask(null)} className="px-3 py-1.5 text-gray-400 hover:text-white text-xs rounded-lg border border-gray-700 transition-all">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => markDone(task.id)}
                        className="mt-0.5 flex-shrink-0 text-gray-500 hover:text-cyan-400 transition-colors"
                        title="Mark as done"
                      >
                        <Circle className="w-5 h-5" />
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="text-sm font-semibold text-white">{task.label}</span>
                          {badge && (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                          )}
                        </div>
                        {task.desc && <p className="text-xs text-gray-500 mb-2">{task.desc}</p>}

                        {/* Progress bar */}
                        <div className="h-1 bg-gray-800 rounded-full overflow-hidden mb-2">
                          <div
                            className={`h-full rounded-full transition-all ${progressPct >= 100 ? "bg-red-500" : progressPct >= 75 ? "bg-amber-500" : "bg-cyan-600"}`}
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1 text-xs text-gray-600">
                            <Clock className="w-3 h-3" />
                            <span className={progressPct >= 100 ? "text-red-400 font-mono font-bold" : progressPct >= 75 ? "text-amber-400 font-mono" : "font-mono"}>
                              {formatElapsed(elapsed)}
                            </span>
                            <span className="text-gray-700">/ {formatElapsed(task.interval)} interval</span>
                            {remaining > 0 && <span className="text-gray-700 ml-1">· {formatElapsed(remaining)} left</span>}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {timers[task.id]?.lastDone && (
                              <button onClick={() => resetTask(task.id)} className="text-gray-700 hover:text-gray-500 transition-colors" title="Reset timer">
                                <RefreshCw className="w-3 h-3" />
                              </button>
                            )}
                            {canEdit && (
                              <>
                                <button onClick={() => setEditingTask(task)} className="text-gray-700 hover:text-gray-400 transition-colors" title="Edit task">
                                  <Pencil className="w-3 h-3" />
                                </button>
                                <button onClick={() => deleteTask(task.id)} className="text-gray-700 hover:text-red-400 transition-colors" title="Delete task">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => markDone(task.id)}
                        className="flex-shrink-0 px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 hover:border-cyan-500/40 text-cyan-400 text-xs font-semibold rounded-lg transition-all"
                      >
                        Done
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Unacked messages alert */}
        {unackedMsgs.length > 0 && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Unacknowledged Priority / Emergency Traffic ({unackedMsgs.length})
            </h2>
            <div className="space-y-2">
              {unackedMsgs.map(m => (
                <div key={m.id} className="flex items-start gap-3 text-xs bg-gray-900 rounded-lg p-3 border border-gray-800">
                  <span className={`flex-shrink-0 font-bold px-2 py-0.5 rounded ${m.priority === "Emergency" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"}`}>{m.priority}</span>
                  <div>
                    <div className="text-gray-400"><strong className="text-white">{m.from_callsign}</strong>{m.from_station ? ` / ${m.from_station}` : ""} → {m.to_station}</div>
                    <div className="text-gray-300 mt-0.5">{m.content}</div>
                  </div>
                  <div className="ml-auto text-gray-600 whitespace-nowrap">{new Date(m.created_date).toLocaleTimeString()}</div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}