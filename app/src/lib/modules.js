// Modules (sidebar pages) that can be switched on/off per event. Keys are page names.
// "Events", "API Interface" and "Landing" are never switchable.
export const MODULES = [
  { page: "Dashboard", label: "Dashboard" },
  { page: "Communications", label: "Communications Log" },
  { page: "IncidentMap", label: "Event Map" },
  { page: "AideStations", label: "Positions" },
  { page: "Frequencies", label: "Frequencies" },
  { page: "Operators", label: "Operators" },
  { page: "Assignments", label: "Assignments" },
  { page: "ResourceRequests", label: "Resource Requests" },
  { page: "BibTracker", label: "Bib Tracker" },
  { page: "EventReport", label: "Event Report" },
  { page: "EventSchedule", label: "Event Schedule" },
  { page: "Discussion", label: "Briefing" },
  { page: "ConOps", label: "ConOps" },
  { page: "Documents", label: "Documents" },
  { page: "NetControl", label: "NCO Task Assistant" },
  { page: "VolunteerMobile", label: "Mobile Entry" },
];

export const MODULE_LABELS = Object.fromEntries(MODULES.map((m) => [m.page, m.label]));

const SWITCHABLE = new Set(MODULES.map((m) => m.page));

export function disabledModules(event) {
  const v = event?.disabled_modules;
  return Array.isArray(v) ? v : [];
}

/** True unless the event has switched this module off. Non-switchable pages are always enabled. */
export function isModuleEnabled(event, page) {
  if (!SWITCHABLE.has(page)) return true;
  return !disabledModules(event).includes(page);
}
