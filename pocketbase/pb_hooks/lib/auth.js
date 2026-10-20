// PIN based sessions for ECS.
//
// PINs are verified by the server (never in the browser),
// which then hands out a real PocketBase auth token (collection `ecs_users`). The
// collection API rules then enforce what that token may read/write:
//   role "admin"  -> everything
//   role "event"  -> only records whose event_id equals the token's event_id

const MAX_FAILURES = 10;           // failed PIN attempts ...
const WINDOW_MS = 10 * 60 * 1000;  // ... per client IP per 10 minutes

function safeEqual(a, b) {
  a = String(a == null ? "" : a);
  b = String(b == null ? "" : b);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function getConfig(key) {
  try {
    return $app.findFirstRecordByData("app_config", "key", key);
  } catch (_) {
    return null;
  }
}

function throttleBlocked(bucket) {
  let rec;
  try { rec = $app.findFirstRecordByData("ecs_login_attempts", "bucket", bucket); } catch (_) { return false; }
  const start = Date.parse(rec.getString("window_start") || "") || 0;
  if (Date.now() - start > WINDOW_MS) return false;
  return rec.getInt("failures") >= MAX_FAILURES;
}

function throttleFail(bucket) {
  const now = Date.now();
  let rec;
  try {
    rec = $app.findFirstRecordByData("ecs_login_attempts", "bucket", bucket);
    const start = Date.parse(rec.getString("window_start") || "") || 0;
    if (now - start > WINDOW_MS) {
      rec.set("failures", 1);
      rec.set("window_start", new Date(now).toISOString());
    } else {
      rec.set("failures", rec.getInt("failures") + 1);
    }
  } catch (_) {
    rec = new Record($app.findCollectionByNameOrId("ecs_login_attempts"));
    rec.set("bucket", bucket);
    rec.set("failures", 1);
    rec.set("window_start", new Date(now).toISOString());
  }
  $app.save(rec);
}

function throttleClear(bucket) {
  try { $app.delete($app.findFirstRecordByData("ecs_login_attempts", "bucket", bucket)); } catch (_) { /* none */ }
}

function sessionUser(role, eventId, label) {
  const email = role === "admin" ? "admin@ecs.local" : `event-${eventId}@ecs.local`;
  let user;
  try {
    user = $app.findAuthRecordByEmail("ecs_users", email);
  } catch (_) {
    user = new Record($app.findCollectionByNameOrId("ecs_users"));
    user.setEmail(email);
    user.setPassword($security.randomString(48));
    user.setVerified(true);
    user.set("role", role);
    user.set("event_id", role === "admin" ? "" : eventId);
  }
  user.set("label", label);
  $app.save(user);
  return user;
}

/** POST /api/ecs/login  {mode: "admin"|"event", eventId?, pin} */
function login(e) {
  const body = e.requestInfo().body || {};
  const mode = body.mode === "admin" ? "admin" : "event";
  const pin = String(body.pin == null ? "" : body.pin).trim();
  const bucket = "ip:" + e.realIP();

  if (throttleBlocked(bucket)) {
    return e.json(429, { message: "Too many incorrect PIN attempts. Try again in a few minutes." });
  }

  if (mode === "admin") {
    seedAdminPin();
    const cfg = getConfig("admin_pin");
    const adminPin = cfg ? String(cfg.getString("value")).trim() : "";
    if (!adminPin) return e.json(400, { message: "No admin PIN configured." });
    if (!safeEqual(pin, adminPin)) {
      throttleFail(bucket);
      return e.json(401, { message: "Incorrect admin PIN." });
    }
    throttleClear(bucket);
    const user = sessionUser("admin", "", "ADMIN");
    return e.json(200, { token: user.newAuthToken(), role: "admin", eventId: null, eventName: null });
  }

  const eventId = String(body.eventId || "");
  if (!eventId) return e.json(400, { message: "Please select an event." });
  let ev;
  try { ev = $app.findRecordById("events", eventId); } catch (_) { return e.json(404, { message: "Event not found." }); }
  const evPin = String(ev.getString("pin") || "").trim();
  if (evPin && !safeEqual(pin, evPin)) {
    throttleFail(bucket);
    return e.json(401, { message: "Incorrect event PIN." });
  }
  throttleClear(bucket);
  const user = sessionUser("event", ev.id, "EVENT " + ev.getString("name"));
  return e.json(200, { token: user.newAuthToken(), role: "event", eventId: ev.id, eventName: ev.getString("name") });
}

/** Invalidate outstanding tokens after a PIN change. */
function revokeSessions(role, eventId) {
  const email = role === "admin" ? "admin@ecs.local" : `event-${eventId}@ecs.local`;
  try {
    const user = $app.findAuthRecordByEmail("ecs_users", email);
    user.refreshTokenKey();
    $app.save(user);
  } catch (_) { /* never logged in */ }
}

/** Seed the admin PIN on a blank database from ECS_ADMIN_PIN (set by deploy/bootstrap.sh). */
function seedAdminPin() {
  const pin = $os.getenv("ECS_ADMIN_PIN");
  if (!pin || getConfig("admin_pin")) return;
  const rec = new Record($app.findCollectionByNameOrId("app_config"));
  rec.set("key", "admin_pin");
  rec.set("value", pin);
  rec.set("created_by", "bootstrap");
  $app.save(rec);
  console.log("[ecs] admin PIN seeded from ECS_ADMIN_PIN");
}

module.exports = { login, revokeSessions, seedAdminPin, safeEqual };
