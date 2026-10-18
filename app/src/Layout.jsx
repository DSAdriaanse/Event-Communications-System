import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { useState, useEffect } from "react";
import {
  Radio, Users, MapPin, Zap, ClipboardList, MessageSquare, Menu, X, Shield, CalendarDays, ChevronDown, FileText, Maximize, Minimize, ListChecks, CalendarClock, FolderOpen, LogOut, PackageSearch, Hash, Smartphone, BookOpen, GripVertical, Settings2, Terminal, Sun, Moon
} from "lucide-react";
import { useTheme } from "@/lib/useTheme";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { db } from "@/api/ecs";
import { EventProvider, useEvent } from "@/components/EventContext";
import { PinGateProvider, useAuth } from "@/components/PinGate";
import { isModuleEnabled, MODULES } from "@/lib/modules";

const MODULE_PAGES = MODULES.map(m => m.page);

const DEFAULT_NAV_GROUPS = [
  {
    label: "Event Management",
    items: [
      { label: "Dashboard", page: "Dashboard", icon: Shield },
      { label: "Communications Log", page: "Communications", icon: MessageSquare },
      { label: "Event Map", page: "IncidentMap", icon: MapPin },
      { label: "Positions", page: "AideStations", icon: Radio },
      { label: "Frequencies", page: "Frequencies", icon: Zap },
      { label: "Operators", page: "Operators", icon: Users },
      { label: "Assignments", page: "Assignments", icon: ClipboardList },
      { label: "Resource Requests", page: "ResourceRequests", icon: PackageSearch },
      { label: "Bib Tracker", page: "BibTracker", icon: Hash },
      { label: "Event Report", page: "EventReport", icon: FileText },
      { label: "Event Schedule", page: "EventSchedule", icon: CalendarClock },
      { label: "Briefing", page: "Discussion", icon: MessageSquare },
      { label: "ConOps", page: "ConOps", icon: BookOpen },
      { label: "Documents", page: "Documents", icon: FolderOpen },
    ],
  },
  {
    label: "ECS Management",
    items: [
      { label: "Events", page: "Events", icon: CalendarDays },
      { label: "NCO Task Assistant", page: "NetControl", icon: ListChecks },
    ],
  },
  {
    label: "Additional Tools",
    items: [
      { label: "Mobile Entry", page: "VolunteerMobile", icon: Smartphone },
      { label: "API Interface", page: "APIInterface", icon: Terminal },
    ],
  },
];

// Icon lookup by page name for persistence/restore
const PAGE_ICONS = Object.fromEntries(
  DEFAULT_NAV_GROUPS.flatMap(g => g.items.map(i => [i.page, i.icon]))
);

const PAGE_LABELS = Object.fromEntries(
  DEFAULT_NAV_GROUPS.flatMap(g => g.items.map(i => [i.page, i.label]))
);

const NAV_ORDER_KEY = "ecs_nav_order";

function loadNavGroups() {
  try {
    const raw = localStorage.getItem(NAV_ORDER_KEY);
    if (!raw) return DEFAULT_NAV_GROUPS;
    const saved = JSON.parse(raw);
    // Re-attach icon references (can't serialize functions)
    const restored = saved.map(g => ({
      ...g,
      items: g.items.map(i => ({ ...i, label: PAGE_LABELS[i.page] || i.label, icon: PAGE_ICONS[i.page] || Shield })),
    }));
    // Merge in any new items from DEFAULT_NAV_GROUPS that aren't in saved order
    const savedPages = new Set(restored.flatMap(g => g.items.map(i => i.page)));
    DEFAULT_NAV_GROUPS.forEach((defGroup, gi) => {
      defGroup.items.forEach(item => {
        if (!savedPages.has(item.page)) {
          // Add to the matching group index if it exists, otherwise last group
          const target = restored[gi] || restored[restored.length - 1];
          target.items.push(item);
        }
      });
    });
    return restored;
  } catch { return DEFAULT_NAV_GROUPS; }
}

function saveNavGroups(groups) {
  const serializable = groups.map(g => ({
    label: g.label,
    items: g.items.map(({ icon, ...rest }) => rest),
  }));
  localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(serializable));
}

// Pages that are accessible without an active event
const ALWAYS_UNLOCKED = ["Events", "Landing", "APIInterface"];

function NavItems({ activeEventId, currentPageName, onNavigate, unackedMsgs, editMode, navGroups, offPages, onDragEnd }) {
  if (editMode) {
    return (
      <DragDropContext onDragEnd={onDragEnd}>
        {navGroups.map((group, gi) => (
          <div key={gi} className={gi > 0 ? "pt-3 border-t border-gray-800 mt-3" : ""}>
            <div className="px-3 pb-1 pt-1">
              <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest">{group.label}</span>
            </div>
            <Droppable droppableId={String(gi)}>
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps}>
                  {group.items.map(({ label, page, icon: Icon }, idx) => (
                    <Draggable key={page} draggableId={`${gi}-${page}`} index={idx}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={`flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-400 ${snapshot.isDragging ? "bg-gray-700 shadow-lg" : "bg-transparent"}`}
                        >
                          <div {...provided.dragHandleProps} className="text-gray-600 hover:text-gray-300 cursor-grab active:cursor-grabbing p-0.5">
                            <GripVertical className="w-4 h-4" />
                          </div>
                          <Icon className="w-4 h-4 flex-shrink-0" />
                          <span className="truncate">{label}</span>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </div>
        ))}
      </DragDropContext>
    );
  }

  return (
    <>
      {navGroups.map((group, gi) => (
        <div key={gi} className={gi > 0 ? "pt-3 border-t border-gray-800 mt-3" : ""}>
          <div className="px-3 pb-1 pt-1">
            <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest">{group.label}</span>
          </div>
          {group.items.map(({ label, page, icon: Icon }) => {
            const active = currentPageName === page;
            const locked = !activeEventId && !ALWAYS_UNLOCKED.includes(page);
            if (locked) {
              return (
                <div key={page} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-700 cursor-not-allowed select-none">
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {label}
                </div>
              );
            }
            return (
              <Link
                key={page}
                to={createPageUrl(page)}
                onClick={onNavigate}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all relative ${
                  active
                    ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/20"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                } ${offPages?.has(page) ? "opacity-50" : ""}`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
                {offPages?.has(page) && <span className="ml-auto text-[9px] uppercase tracking-wider text-amber-400/80 border border-amber-500/30 rounded px-1">off</span>}
                {page === "Communications" && unackedMsgs > 0 && (
                  <style>{`@keyframes blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.3; } }`}</style>
                )}
                {page === "Communications" && unackedMsgs > 0 && (
                  <span className="absolute right-2 w-2 h-2 rounded-full bg-red-500" style={{ animation: "blink 1s infinite" }} />
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

function EventSelector() {
  const { events, activeEvent, selectEvent } = useEvent();
  return (
    <div className="px-3 py-2 border-b border-gray-800">
      <label className="text-xs text-gray-600 mb-1 block uppercase tracking-wider">Active Event</label>
      <div className="relative">
        <select
          value={activeEvent?.id || ""}
          onChange={e => selectEvent(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-cyan-300 font-medium focus:outline-none focus:border-cyan-500/50 appearance-none pr-7"
        >
          <option value="">— No Event —</option>
          {events.map(ev => (
            <option key={ev.id} value={ev.id}>{ev.name}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
      </div>
    </div>
  );
}

function LayoutInner({ children, currentPageName }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [unackedMsgs, setUnackedMsgs] = useState(0);
  const [navGroups, setNavGroups] = useState(() => loadNavGroups());
  const [editMode, setEditMode] = useState(false);
  const { activeEventId, activeEvent } = useEvent();
  const { auth, logout, isAdmin } = useAuth();
  const { theme, setTheme } = useTheme();

  // Modules switched off for the active event: hidden for operators, dimmed (still usable) for admins.
  const off = new Set(MODULE_PAGES.filter(p => !isModuleEnabled(activeEvent, p)));
  const visibleGroups = isAdmin
    ? navGroups
    : navGroups.map(g => ({ ...g, items: g.items.filter(i => !off.has(i.page)) })).filter(g => g.items.length > 0);
  const pageDisabled = !isAdmin && !!activeEvent && off.has(currentPageName);

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const srcGroup = parseInt(result.source.droppableId);
    const dstGroup = parseInt(result.destination.droppableId);
    const updated = navGroups.map(g => ({ ...g, items: [...g.items] }));
    const [moved] = updated[srcGroup].items.splice(result.source.index, 1);
    updated[dstGroup].items.splice(result.destination.index, 0, moved);
    setNavGroups(updated);
    saveNavGroups(updated);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Load unacknowledged messages count
  useEffect(() => {
    const loadUnackedCount = async () => {
      if (!activeEventId) {
        setUnackedMsgs(0);
        return;
      }
      const msgs = await db.eventLogs.filter({ event_id: activeEventId });
      const msgArray = Array.isArray(msgs) ? msgs : (msgs?.data || []);
      const unacked = msgArray.filter(m => m.type === "communication" && !m.acknowledged).length;
      setUnackedMsgs(unacked);
    };
    loadUnackedCount();
    // Refresh every 10 seconds
    const interval = setInterval(loadUnackedCount, 10000);
    // Subscribe to real-time updates
    const unsubscribe = db.eventLogs.subscribe(() => loadUnackedCount());
    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [activeEventId]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <style>{`
        :root {
          --accent: #22d3ee;
          --accent-dim: #0891b2;
          --danger: #ef4444;
          --warning: #f59e0b;
          --success: #22c55e;
        }
        * { box-sizing: border-box; }
        body { background: #030712; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #111827; }
        ::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
      `}</style>

      {/* Sidebar Desktop */}
      <aside className={`hidden lg:flex flex-col bg-gray-900 border-r border-gray-800 fixed h-full z-40 transition-all duration-300 ${sidebarCollapsed ? "w-14" : "w-60"}`}>
        <div className={`px-3 py-4 border-b border-gray-800 flex items-center ${sidebarCollapsed ? "justify-center" : "justify-between gap-2"}`}>
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                <Radio className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-white tracking-wide">SWCRS</p>
                <p className="text-xs text-gray-500">Event Comms System</p>
              </div>
            </div>
          )}
          {sidebarCollapsed && (
            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
              <Radio className="w-4 h-4 text-cyan-400" />
            </div>
          )}
          <button onClick={() => setSidebarCollapsed(c => !c)} className="text-gray-600 hover:text-gray-300 transition-colors flex-shrink-0" title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {sidebarCollapsed ? <Menu className="w-4 h-4" /> : <X className="w-4 h-4" />}
          </button>
        </div>

        {!sidebarCollapsed && isAdmin && <EventSelector />}
        {!sidebarCollapsed && !isAdmin && activeEvent && (
          <div className="px-3 py-2 border-b border-gray-800">
            <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Active Event</p>
            <p className="text-xs text-cyan-300 font-semibold truncate">{activeEvent.name}</p>
          </div>
        )}

        <nav className="flex-1 px-2 py-4 overflow-y-auto space-y-0.5">
          {sidebarCollapsed ? (
            visibleGroups.flatMap(g => g.items).map(({ page, icon: Icon, label }) => {
              const active = currentPageName === page;
              const locked = !activeEventId && !ALWAYS_UNLOCKED.includes(page);
              if (locked) return (
                <div key={page} title={label} className="flex items-center justify-center px-1 py-2.5 rounded-lg text-gray-700 cursor-not-allowed">
                  <Icon className="w-4 h-4 flex-shrink-0" />
                </div>
              );
              return (
                <Link key={page} to={createPageUrl(page)} title={label}
                  className={`flex items-center justify-center px-1 py-2.5 rounded-lg transition-all relative ${active ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/20" : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"}`}>
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {page === "Communications" && unackedMsgs > 0 && (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500" />
                  )}
                </Link>
              );
            })
          ) : (
            <NavItems activeEventId={activeEventId} currentPageName={currentPageName} unackedMsgs={unackedMsgs} editMode={editMode} navGroups={editMode ? navGroups : visibleGroups} offPages={isAdmin ? off : null} onDragEnd={handleDragEnd} />
          )}
        </nav>

        <div className={`px-3 py-3 border-t border-gray-800 space-y-2 ${sidebarCollapsed ? "flex flex-col items-center" : ""}`}>
          {!sidebarCollapsed && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-600">v2.0 · {isAdmin ? <span className="text-cyan-500 font-bold">ADMIN</span> : <span className="text-green-400">operator</span>}</p>
              <button onClick={toggleFullscreen} className="text-gray-600 hover:text-gray-300 transition-colors" title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            </div>
          )}
          {!sidebarCollapsed && (
            <button
              onClick={() => setTheme(t => t === "dark" ? "hc" : "dark")}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-lg transition-all text-gray-600 hover:text-gray-300 hover:bg-gray-800"
              title={theme === "dark" ? "Switch to High Contrast" : "Switch to Dark"}
            >
              {theme === "hc" ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
              {theme === "hc" ? "Dark Theme" : "High Contrast"}
            </button>
          )}
          {sidebarCollapsed && (
            <button
              onClick={() => setTheme(t => t === "dark" ? "hc" : "dark")}
              title={theme === "dark" ? "High Contrast" : "Dark Theme"}
              className="flex items-center justify-center p-1.5 text-gray-600 hover:text-gray-300 hover:bg-gray-800 rounded-lg transition-all"
            >
              {theme === "hc" ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
            </button>
          )}
          {!sidebarCollapsed && (
            <button
              onClick={() => setEditMode(e => !e)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-lg transition-all ${editMode ? "text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20" : "text-gray-600 hover:text-gray-300 hover:bg-gray-800"}`}
            >
              <Settings2 className="w-3.5 h-3.5" />
              {editMode ? "Done Editing" : "Edit Sidebar"}
            </button>
          )}
          {sidebarCollapsed ? (
            <button onClick={logout} title="Sign Out" className="flex items-center justify-center p-1.5 text-gray-600 hover:text-red-400 hover:bg-gray-800 rounded-lg transition-all">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button onClick={logout} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-600 hover:text-red-400 hover:bg-gray-800 rounded-lg transition-all">
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          )}
        </div>
      </aside>

      {/* Mobile header */}
      <div className={`lg:hidden fixed top-0 left-0 right-0 z-50 bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between ${currentPageName === "BibMobile" ? "hidden" : ""}`}>
        <div className="flex items-center gap-2">
          <Radio className="w-5 h-5 text-cyan-400" />
          <span className="text-sm font-bold text-white">SWCRS ECS</span>
        </div>
        <button onClick={() => setMobileOpen(!mobileOpen)} className="text-gray-400 hover:text-white">
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/60" onClick={() => setMobileOpen(false)}>
          <div className="w-60 h-full bg-gray-900 border-r border-gray-800 pt-16 overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-3 py-2">
              {isAdmin ? <EventSelector /> : activeEvent && (
                <div className="py-1">
                  <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Active Event</p>
                  <p className="text-xs text-cyan-300 font-semibold truncate">{activeEvent.name}</p>
                </div>
              )}
            </div>
            <div className="px-3 py-2 space-y-0.5">
              <NavItems activeEventId={activeEventId} currentPageName={currentPageName} onNavigate={() => setMobileOpen(false)} unackedMsgs={unackedMsgs} editMode={false} navGroups={visibleGroups} offPages={isAdmin ? off : null} onDragEnd={handleDragEnd} />
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className={`flex-1 pt-0 lg:pt-0 min-h-screen transition-all duration-300 ${currentPageName === "BibMobile" ? "" : (sidebarCollapsed ? "lg:ml-14" : "lg:ml-60")}`}>
        <div className={`${currentPageName === "BibMobile" ? "" : "pt-14 lg:pt-0"} h-full`}>
          {pageDisabled ? (
            <div className="min-h-[60vh] flex items-center justify-center p-6">
              <div className="max-w-sm text-center space-y-2">
                <p className="text-white font-semibold">This module is not enabled for this event</p>
                <p className="text-sm text-gray-500">Ask your event administrator if you need it turned on.</p>
              </div>
            </div>
          ) : children}
        </div>
      </main>
    </div>
  );
}

export default function Layout({ children, currentPageName }) {
  return (
    <EventProvider>
      <PinGateProvider>
        <LayoutInner currentPageName={currentPageName}>{children}</LayoutInner>
      </PinGateProvider>
    </EventProvider>
  );
}