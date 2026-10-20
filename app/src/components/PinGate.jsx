import { useState, useEffect, createContext, useContext } from "react";
import { db } from "@/api/ecs";
import { pb, ecsLogin, fetchPublicEvents } from "@/api/pb";
import { Radio, Lock, Eye, EyeOff, Smartphone } from "lucide-react";
import { useEvent } from "@/components/EventContext";

function isMobileOrTablet() {
  return /Mobi|Android|iPad|Tablet|Touch/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.innerWidth <= 1024);
}

const AuthContext = createContext({ auth: null, logout: () => {}, isAdmin: false, canEdit: false });

export function useAuth() {
  return useContext(AuthContext);
}

const SESSION_KEY = "ecs_auth";
const UNLOCKED_KEY = "ecs_unlocked_events";

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveSession(data) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(UNLOCKED_KEY);
}

function loadUnlocked() {
  try {
    const raw = sessionStorage.getItem(UNLOCKED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveUnlocked(ids) {
  sessionStorage.setItem(UNLOCKED_KEY, JSON.stringify(ids));
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
function LoginScreen({ events, onAuth }) {
  const [mode, setMode] = useState("event");
  const [selectedEventId, setSelectedEventId] = useState(() => {
    const active = events.find(e => e.status === "Active") || events[0];
    return active?.id || "";
  });
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState("");
  // Step 2: after PIN validated
  const [pinValidated, setPinValidated] = useState(false);
  const [stations, setStations] = useState([]);
  const [operators, setOperators] = useState([]);
  const [stationId, setStationId] = useState("");
  const [callsign, setCallsign] = useState("");
  const [busy, setBusy] = useState(false);

  // Load stations/operators once the PIN has been validated (the server issued a session token)
  useEffect(() => {
    if (!selectedEventId || !pinValidated) { setStations([]); setOperators([]); return; }
    Promise.all([
      db.aideStations.filter({ event_id: selectedEventId }),
      db.operators.filter({ event_id: selectedEventId }),
    ]).then(([sts, ops]) => {
      setStations(sts.filter(s => s.status !== "Closed"));
      setOperators(ops);
    }).catch(() => {});
  }, [selectedEventId, pinValidated]);

  const handleEventChange = (id) => {
    setSelectedEventId(id);
    setPin("");
    setError("");
    setPinValidated(false);
    setStationId("");
    setCallsign("");
  };

  const validate = async () => {
    setError("");
    if (mode === "event" && !selectedEventId) { setError("Please select an event."); return; }
    setBusy(true);
    try {
      if (mode === "admin") {
        await ecsLogin({ mode: "admin", pin });
        onAuth({ role: "admin" }, null, null, null);
      } else {
        await ecsLogin({ mode: "event", eventId: selectedEventId, pin });
        setPinValidated(true);
      }
    } catch (err) {
      setError(err.message || "Login failed.");
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const proceed = () => {
    if (stationId) {
      localStorage.setItem("ecs_bib_station", stationId);
      const st = stations.find(s => s.id === stationId);
      if (st) localStorage.setItem("ecs_station_name", st.name);
    }
    if (callsign) localStorage.setItem("ecs_callsign", callsign);
    onAuth({ role: "user", eventId: selectedEventId }, selectedEventId, stationId, callsign);
  };

  const mobileUrl = () => {
    const params = new URLSearchParams();
    if (selectedEventId) params.set("eventId", selectedEventId);
    if (pin) params.set("pin", pin);
    if (stationId) params.set("stationId", stationId);
    if (callsign) params.set("callsign", callsign);
    return `/VolunteerMobile?${params.toString()}`;
  };

  const selectedEvent = events.find(e => e.id === selectedEventId);

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mx-auto mb-4">
            <Radio className="w-7 h-7 text-cyan-400" />
          </div>
          <h1 className="text-xl font-bold text-white">ECS</h1>
          <p className="text-gray-500 text-sm mt-1">Event Communications System</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          {/* Mode tabs */}
          <div className="flex rounded-lg bg-gray-800 p-1 gap-1">
            <button onClick={() => { setMode("event"); setError(""); setPin(""); setPinValidated(false); }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${mode === "event" ? "bg-cyan-500 text-gray-950" : "text-gray-400 hover:text-white"}`}>
              Event Access
            </button>
            <button onClick={() => { setMode("admin"); setError(""); setPin(""); setPinValidated(false); }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${mode === "admin" ? "bg-cyan-500 text-gray-950" : "text-gray-400 hover:text-white"}`}>
              Admin
            </button>
          </div>

          {/* Event selector */}
          {mode === "event" && (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Select Event</label>
              <select value={selectedEventId} onChange={e => handleEventChange(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50">
                <option value="">— Choose an event —</option>
                {events.map(ev => (
                  <option key={ev.id} value={ev.id}>{ev.name}{ev.status === "Active" ? " ★" : ""}</option>
                ))}
              </select>
            </div>
          )}

          {/* Step 1: PIN entry */}
          {!pinValidated && (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                {mode === "admin" ? "Admin PIN" : "Event PIN"}
              </label>
              <div className="relative">
                <input type={showPin ? "text" : "password"} value={pin}
                  onChange={e => { setPin(e.target.value); setError(""); }}
                  onKeyDown={e => e.key === "Enter" && validate()}
                  placeholder="Enter PIN"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-10 text-sm text-white font-mono tracking-widest focus:outline-none focus:border-cyan-500/50"
                />
                <button type="button" onClick={() => setShowPin(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                  {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {mode === "event" && (
                <p className="text-xs text-gray-600 mt-1">Leave blank if no PIN is set for this event</p>
              )}
            </div>
          )}

          {/* Step 2: Station + Callsign (after PIN validated) */}
          {pinValidated && mode === "event" && (
            <>
              <div className="border-t border-gray-800 pt-4">
                <p className="text-xs text-cyan-400 font-semibold mb-3 uppercase tracking-wider">
                  ✓ {selectedEvent?.name} — Identify Yourself
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">My Station <span className="text-gray-600">(optional)</span></label>
                    <select value={stationId} onChange={e => setStationId(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50">
                      <option value="">— None —</option>
                      {stations.map(s => <option key={s.id} value={s.id}>{s.station_id} – {s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">My Callsign <span className="text-gray-600">(optional)</span></label>
                    <select value={callsign} onChange={e => setCallsign(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50">
                      <option value="">— None —</option>
                      {operators.map(o => <option key={o.id} value={o.callsign}>{o.callsign} — {o.full_name}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </>
          )}

          {error && <p className="text-red-400 text-xs">{error}</p>}

          {/* Primary action button */}
          {!pinValidated ? (
            <button onClick={validate} disabled={busy}
              className="w-full flex items-center justify-center gap-2 py-2.5 disabled:opacity-60 bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-bold rounded-lg text-sm transition-all">
              <Lock className="w-4 h-4" />
              {mode === "admin" ? "Admin Login" : "Validate"}
            </button>
          ) : (
            <div className="space-y-2">
              <button onClick={proceed}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-bold rounded-lg text-sm transition-all">
                <Lock className="w-4 h-4" /> Proceed to ECS
              </button>
              {isMobileOrTablet() && (
                <a href={mobileUrl()}
                  className="w-full flex items-center justify-center gap-2 py-2.5 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 rounded-lg text-sm font-semibold transition-all">
                  <Smartphone className="w-4 h-4" /> Open Mobile View
                </a>
              )}
              <button onClick={() => { setPinValidated(false); setPin(""); }}
                className="w-full text-xs text-gray-600 hover:text-gray-400 transition-all py-1">
                ← Back
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-700 mt-4">
          SWCRS · Southwest Community Radio System
        </p>
      </div>
    </div>
  );
}

// ─── PROVIDER ─────────────────────────────────────────────────────────────────
export function PinGateProvider({ children }) {
  const { selectEvent } = useEvent();
  const [auth, setAuth] = useState(() => (pb.authStore.isValid ? loadSession() : null));
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!pb.authStore.isValid) clearSession();
    fetchPublicEvents()
      .then((evs) => setEvents(evs.filter((e) => e.status !== "Archived")))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  // A restored event session is always bound to its own event.
  useEffect(() => {
    if (auth?.role === "user" && auth.eventId) selectEvent(auth.eventId);
  }, [auth]);

  // Token expired / revoked (e.g. the PIN was changed) -> back to the login screen.
  useEffect(() => pb.authStore.onChange((token) => {
    if (!token) { clearSession(); setAuth(null); }
  }), []);

  const handleAuth = (session, eventId) => {
    saveSession(session);
    setAuth(session);
    if (eventId) selectEvent(eventId);
  };

  const logout = () => {
    pb.authStore.clear();
    clearSession();
    setAuth(null);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gray-950">
        <div className="w-8 h-8 border-4 border-gray-800 border-t-cyan-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (!auth) {
    return <LoginScreen events={events} onAuth={handleAuth} />;
  }

  return (
    <AuthContext.Provider value={{ auth, logout, isAdmin: auth?.role === "admin", canEdit: auth?.role === "admin" || auth?.role === "user" }}>
      {children}
    </AuthContext.Provider>
  );
}
