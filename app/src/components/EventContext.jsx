import { createContext, useContext, useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { pb } from "@/api/pb";

const EventContext = createContext(null);

export function EventProvider({ children }) {
  const [events, setEvents] = useState([]);
  const [activeEventId, setActiveEventId] = useState(() => localStorage.getItem("activeEventId") || null);
  const [loading, setLoading] = useState(true);

  const loadEvents = async () => {
    let data = [];
    if (pb.authStore.isValid) {
      try { data = await base44.entities.Event.list("-date"); } catch { data = []; }
    }
    setEvents(data);
    setLoading(false);
    // Auto-select first active event if none selected
    if (!localStorage.getItem("activeEventId") && data.length > 0) {
      const active = data.find(e => e.status === "Active") || data[0];
      setActiveEventId(active.id);
      localStorage.setItem("activeEventId", active.id);
    }
  };

  // Events are only readable with a session, so (re)load whenever the login state changes.
  useEffect(() => {
    loadEvents();
    return pb.authStore.onChange(() => { loadEvents(); });
  }, []);

  const selectEvent = (id) => {
    setActiveEventId(id);
    localStorage.setItem("activeEventId", id);
  };

  const activeEvent = events.find(e => e.id === activeEventId) || null;

  return (
    <EventContext.Provider value={{ events, activeEvent, activeEventId, selectEvent, loadEvents, loading }}>
      {children}
    </EventContext.Provider>
  );
}

export function useEvent() {
  return useContext(EventContext);
}