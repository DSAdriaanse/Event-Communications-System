/**
 * ECS Event Time Utility
 *
 * All timestamps are stored in UTC. This module provides consistent
 * display formatting using the per-event timezone setting.
 * The parseAsUTC helper ensures timestamps are always treated as UTC
 * even when the real-time subscription returns them without a 'Z' suffix.
 */

// Map of IANA timezone names to common abbreviations for both standard and daylight time.
const TZ_ABBR = {
  "America/Los_Angeles": { std: "PST", dst: "PDT" },
  "America/Denver":      { std: "MST", dst: "MDT" },
  "America/Phoenix":     { std: "MST", dst: "MST" }, // Arizona does not observe DST
  "America/Chicago":     { std: "CST", dst: "CDT" },
  "America/New_York":    { std: "EST", dst: "EDT" },
  "America/Anchorage":   { std: "AKST", dst: "AKDT" },
  "Pacific/Honolulu":    { std: "HST", dst: "HST" },
  "UTC":                 { std: "UTC", dst: "UTC" },
};

export const TIMEZONE_OPTIONS = [
  { value: "America/Los_Angeles", label: "Pacific (PST/PDT)" },
  { value: "America/Denver",      label: "Mountain (MST/MDT)" },
  { value: "America/Phoenix",     label: "Arizona (MST, no DST)" },
  { value: "America/Chicago",     label: "Central (CST/CDT)" },
  { value: "America/New_York",    label: "Eastern (EST/EDT)" },
  { value: "America/Anchorage",   label: "Alaska (AKST/AKDT)" },
  { value: "Pacific/Honolulu",    label: "Hawaii (HST)" },
  { value: "UTC",                 label: "UTC" },
];

/**
 * Parses an ISO timestamp string as UTC, regardless of whether it
 * includes a 'Z' suffix or timezone offset.  This prevents the browser
 * from interpreting bare ISO strings (e.g. "2026-06-29T12:00:00.000")
 * as local time — which is what happens when the real-time subscription
 * delivers entity data without the trailing 'Z'.
 */
export function parseAsUTC(isoStr) {
  if (!isoStr) return null;
  const str = String(isoStr);
  // Already has timezone info (Z or +/-HH:MM offset)?
  if (/[Zz]$/.test(str) || /[+-]\d{2}:?\d{2}$/.test(str)) {
    return new Date(str);
  }
  // Bare ISO string — treat as UTC
  return new Date(str + "Z");
}

/**
 * Returns the timezone abbreviation for a given IANA tz string and date.
 * Falls back to the short offset string (e.g. "GMT-7") if not in our map.
 */
export function getTzAbbr(tz, date = new Date()) {
  const map = TZ_ABBR[tz];
  if (map) {
    // Detect DST by comparing Jan and Jul offsets
    const jan = new Date(date.getFullYear(), 0, 1);
    const jul = new Date(date.getFullYear(), 6, 1);
    const janOffset = getOffset(tz, jan);
    const julOffset = getOffset(tz, jul);
    const isDST = getOffset(tz, date) !== Math.max(janOffset, julOffset);
    return isDST ? map.dst : map.std;
  }
  // Fallback: use Intl to get short name
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
      .formatToParts(date);
    return parts.find(p => p.type === "timeZoneName")?.value || tz;
  } catch {
    return tz;
  }
}

function getOffset(tz, date) {
  const utc = date.getTime();
  const tzDate = new Date(date.toLocaleString("en-US", { timeZone: tz }));
  return Math.round((utc - tzDate.getTime()) / 60000);
}

/**
 * Format a UTC ISO string as a time string in the event's timezone.
 * e.g. "14:35 MST"
 */
export function formatEventTime(isoStr, tz = "America/Phoenix", showTz = true) {
  if (!isoStr) return "—";
  const date = parseAsUTC(isoStr);
  if (!date || isNaN(date.getTime())) return isoStr;
  const timeStr = date.toLocaleTimeString("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (!showTz) return timeStr;
  return `${timeStr} ${getTzAbbr(tz, date)}`;
}

/**
 * Format a UTC ISO string as a full date+time string in the event's timezone.
 * e.g. "Apr 15 14:35 MST"
 */
export function formatEventDateTime(isoStr, tz = "America/Phoenix", showTz = true) {
  if (!isoStr) return "—";
  const date = parseAsUTC(isoStr);
  if (!date || isNaN(date.getTime())) return isoStr;
  const dateStr = date.toLocaleDateString("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
  });
  const timeStr = date.toLocaleTimeString("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (!showTz) return `${dateStr} ${timeStr}`;
  return `${dateStr} ${timeStr} ${getTzAbbr(tz, date)}`;
}

/**
 * Format a UTC ISO string as a short date in the event's timezone.
 * e.g. "Apr 15"
 */
export function formatEventDate(isoStr, tz = "America/Phoenix") {
  if (!isoStr) return "—";
  const date = parseAsUTC(isoStr);
  if (!date || isNaN(date.getTime())) return isoStr;
  return date.toLocaleDateString("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}