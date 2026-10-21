// ECS data layer over PocketBase.
//   db.<collection>.list(sort, limit) / filter(query, sort, limit) / get(id) / create / update / delete / subscribe(cb)
//   callFunction(name, params)  -> POST /api/functions/<name>
// Records are returned as plain objects with ISO "T...Z" timestamps.
import pb from './pb';

const COLLECTIONS = {
  events: 'events',
  aideStations: 'aide_stations',
  frequencies: 'frequencies',
  operators: 'operators',
  assignments: 'assignments',
  eventLogs: 'event_logs',
  resourceRequests: 'resource_requests',
  participants: 'participants',
  participantStatusUpdates: 'participant_status_updates',
  eventDocuments: 'event_documents',
  bulletins: 'bulletins',
  appConfig: 'app_config',
};

const PB_DATE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SERVER_FIELDS = ['collectionId', 'collectionName', 'expand'];
const READONLY_ON_WRITE = ['id', 'created_date', 'updated_date', 'created_by', 'has_pin', ...SERVER_FIELDS];

/** PocketBase returns "YYYY-MM-DD HH:MM:SS.mmmZ"; the UI expects ISO "T". */
function norm(rec) {
  if (!rec) return rec;
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    if (SERVER_FIELDS.includes(k)) continue;
    out[k] = typeof v === 'string' && PB_DATE.test(v) ? v.replace(' ', 'T') : v;
  }
  return out;
}

function cleanBody(data, creating) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (READONLY_ON_WRITE.includes(k) && !(creating && k === 'id' && v)) continue;
    out[k] = v === undefined ? null : v;
  }
  return out;
}

function buildFilter(query) {
  const parts = [];
  const params = {};
  Object.entries(query || {}).forEach(([k, v], i) => {
    if (v === undefined) return;
    parts.push(`${k} = {:p${i}}`);
    params[`p${i}`] = v;
  });
  return pb.filter(parts.join(' && '), params);
}

function entity(name) {
  const col = COLLECTIONS[name];
  const c = () => pb.collection(col);

  const fetchList = async (filter, sort, limit) => {
    const opts = { sort: sort || undefined, filter: filter || undefined };
    if (limit) {
      const r = await c().getList(1, Number(limit), { ...opts, skipTotal: true });
      return r.items.map(norm);
    }
    return (await c().getFullList({ ...opts, batch: 500 })).map(norm);
  };

  return {
    list: (sort, limit) => fetchList('', sort, limit),
    filter: (query, sort, limit) => fetchList(buildFilter(query), sort, limit),
    get: async (id) => norm(await c().getOne(id)),
    create: async (data) => norm(await c().create(cleanBody(data, true))),
    update: async (id, data) => norm(await c().update(id, cleanBody(data, false))),
    delete: async (id) => { await c().delete(id); return { success: true }; },
    bulkCreate: async (rows) => Promise.all((rows || []).map((r) => c().create(cleanBody(r, true)).then(norm))),
    /** Realtime: returns an unsubscribe function synchronously. callback({type, id, data}) */
    subscribe(callback) {
      let off = null;
      let dead = false;
      c().subscribe('*', (e) => {
        try { callback({ type: e.action, id: e.record?.id, data: norm(e.record) }); } catch (err) { console.error(err); }
      }).then((fn) => { if (dead) fn(); else off = fn; }).catch((err) => console.warn('realtime subscribe failed', err));
      return () => { dead = true; if (off) off(); };
    },
  };
}

export const db = new Proxy({}, {
  get(target, name) {
    if (typeof name !== 'string' || !COLLECTIONS[name]) return undefined;
    return (target[name] ||= entity(name));
  },
});

/** Call a server function (POST /api/functions/<name>). Resolves to { data, status }; rejects with err.response on HTTP errors. */
export async function callFunction(fn, params) {
  const res = await fetch(`/api/functions/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(pb.authStore.token ? { authorization: pb.authStore.token } : {}) },
    body: JSON.stringify(params || {}),
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error((data && (data.error || data.message)) || `Request failed (${res.status})`);
    err.response = { status: res.status, data };
    throw err;
  }
  return { data, status: res.status };
}

/** Admin-only server routes (/api/ecs/admin/...). Resolves to the parsed JSON; rejects with a readable message. */
export async function adminRequest(method, path) {
  const res = await fetch(`/api/ecs/admin/${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(pb.authStore.token ? { authorization: pb.authStore.token } : {}) },
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new Error((data && (data.error || data.message)) || `Request failed (${res.status})`);
  return data;
}
