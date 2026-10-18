// PocketBase client for ECS. The UI is served by PocketBase itself, so the API lives on the same origin.
import PocketBase, { AsyncAuthStore } from 'pocketbase';

const KEY = 'ecs_pb_auth';

const store = new AsyncAuthStore({
  save: async (serialized) => {
    try { sessionStorage.setItem(KEY, serialized); } catch { /* private mode */ }
  },
  clear: async () => {
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  },
  initial: (() => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } })(),
});

export const pb = new PocketBase(window.location.origin, store);
pb.autoCancellation(false);

/** Server-verified PIN login. mode: "admin" | "event". Returns {role,eventId,eventName}. */
export async function ecsLogin({ mode, eventId, pin }) {
  const res = await fetch('/api/ecs/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode, eventId, pin }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || `Login failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  pb.authStore.save(body.token, null);
  return body;
}

/** Events visible on the login screens (no PINs, no briefing text). */
export async function fetchPublicEvents() {
  const res = await fetch('/api/ecs/public-events');
  if (!res.ok) throw new Error(`Could not load events (${res.status})`);
  return res.json();
}

export const isSignedIn = () => pb.authStore.isValid;
export const signOut = () => pb.authStore.clear();

export default pb;
