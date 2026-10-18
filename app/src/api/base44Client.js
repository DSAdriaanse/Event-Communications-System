// Compatibility layer: keeps the original `base44.entities.X.list/filter/get/create/update/delete/subscribe`
// and `base44.functions.invoke` call sites working, backed by PocketBase.
import pb from './pb';

const COLLECTIONS = {
  Event: 'events',
  AideStation: 'aide_stations',
  Frequency: 'frequencies',
  Operator: 'operators',
  Assignment: 'assignments',
  EventLog: 'event_logs',
  ResourceRequest: 'resource_requests',
  Participant: 'participants',
  ParticipantStatusUpdate: 'participant_status_updates',
  EventDocument: 'event_documents',
  Bulletin: 'bulletins',
  AppConfig: 'app_config',
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
    /** Returns an unsubscribe function (synchronously), like the Base44 SDK. */
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

const entities = new Proxy({}, {
  get(target, name) {
    if (typeof name !== 'string' || !COLLECTIONS[name]) return undefined;
    return (target[name] ||= entity(name));
  },
});

const functions = {
  async invoke(fn, params) {
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
  },
};

const auth = {
  me: async () => { throw new Error('Not applicable: ECS uses PIN sessions'); },
  isAuthenticated: async () => pb.authStore.isValid,
  logout: () => pb.authStore.clear(),
  redirectToLogin: () => { window.location.href = '/'; },
};

export const base44 = { entities, functions, auth };
export default base44;
