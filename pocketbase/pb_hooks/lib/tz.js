// Minimal timezone support for server-side report generation.
//
// PocketBase's JS engine (goja) has no Intl / timeZone support, so the handful of IANA zones
// offered in the UI (see app/src/lib/eventTime.js) are implemented here with the US DST rules.
// Unknown zones fall back to UTC and are labelled as such.

const ZONES = {
  "America/Los_Angeles": { std: -8, dst: true },
  "America/Denver": { std: -7, dst: true },
  "America/Phoenix": { std: -7, dst: false },
  "America/Chicago": { std: -6, dst: true },
  "America/New_York": { std: -5, dst: true },
  "America/Anchorage": { std: -9, dst: true },
  "Pacific/Honolulu": { std: -10, dst: false },
  "UTC": { std: 0, dst: false },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function nthSunday(year, month, n) {
  // month 0-based; returns day-of-month of the nth Sunday
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + (n - 1) * 7;
}

/** UTC offset in hours for the instant `ms` in zone `tz`. */
function offsetHours(ms, tz) {
  const z = ZONES[tz] || ZONES.UTC;
  if (!z.dst) return z.std;
  const y = new Date(ms).getUTCFullYear();
  // DST starts 2nd Sunday March 02:00 local standard, ends 1st Sunday Nov 02:00 local daylight
  const start = Date.UTC(y, 2, nthSunday(y, 2, 2), 2) - z.std * 3600000;
  const end = Date.UTC(y, 10, nthSunday(y, 10, 1), 2) - (z.std + 1) * 3600000;
  return ms >= start && ms < end ? z.std + 1 : z.std;
}

function parts(input, tz) {
  const d = parseUTC(input);
  if (!d) return null;
  const local = new Date(d.getTime() + offsetHours(d.getTime(), tz) * 3600000);
  return {
    y: local.getUTCFullYear(), mo: local.getUTCMonth(), d: local.getUTCDate(),
    h: local.getUTCHours(), mi: local.getUTCMinutes(), s: local.getUTCSeconds(),
  };
}

const pad = (n) => (n < 10 ? "0" : "") + n;

/** Same rule as the UI: bare ISO strings and PocketBase "YYYY-MM-DD HH:MM:SS.mmmZ" are UTC. */
function parseUTC(input) {
  if (input == null || input === "") return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  let s = String(input).trim().replace(" ", "T");
  if (!/[Zz]$/.test(s) && !/[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** "Aug 1, 06:30" */
function fmtTz(iso, tz) {
  const p = parts(iso, tz || "UTC");
  if (!p) return iso ? String(iso) : "—";
  return `${MONTHS[p.mo]} ${p.d}, ${pad(p.h)}:${pad(p.mi)}`;
}

/** "06:30" */
function fmtTimeTz(iso, tz) {
  const p = parts(iso, tz || "UTC");
  if (!p) return iso ? String(iso) : "—";
  return `${pad(p.h)}:${pad(p.mi)}`;
}

/** "8/1/2026, 6:30:00 AM"  (en-US default date+time) */
function fmtFull(iso, tz) {
  const p = parts(iso, tz || "UTC");
  if (!p) return iso ? String(iso) : "";
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${p.mo + 1}/${p.d}/${p.y}, ${h12}:${pad(p.mi)}:${pad(p.s)} ${p.h < 12 ? "AM" : "PM"}`;
}

const nowTz = (tz) => fmtTz(new Date(), tz);
const nowFull = (tz) => fmtFull(new Date(), tz);

module.exports = { parseUTC, fmtTz, fmtTimeTz, fmtFull, nowTz, nowFull, offsetHours };
