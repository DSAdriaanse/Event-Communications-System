#!/usr/bin/env node
// Apply PocketBase settings through the admin API. Configuration comes from the environment so no
// secret ends up on a command line:
//   PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD           (required)
//   PB_APP_URL                 public https://host used in links
//   PB_TRUSTED_PROXY=1         trust X-Forwarded-For (only when a reverse proxy sits in front!)
//   PB_SMTP_HOST/PORT/USER/PASS/TLS(1|0), PB_SENDER_NAME, PB_SENDER_ADDRESS
const url = (process.env.PB_URL || "http://127.0.0.1:8090").replace(/\/+$/, "");
const e = process.env;
const call = async (method, path, body, token) => {
  const r = await fetch(url + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${typeof j === "string" ? j : JSON.stringify(j)}`);
  return j;
};
const auth = await call("POST", "/api/collections/_superusers/auth-with-password", { identity: e.PB_SUPERUSER_EMAIL, password: e.PB_SUPERUSER_PASSWORD });
const patch = {};
if (e.PB_APP_URL || e.PB_SENDER_NAME || e.PB_SENDER_ADDRESS) {
  patch.meta = {};
  if (e.PB_APP_URL) patch.meta.appURL = e.PB_APP_URL;
  if (e.PB_SENDER_NAME) patch.meta.senderName = e.PB_SENDER_NAME;
  if (e.PB_SENDER_ADDRESS) patch.meta.senderAddress = e.PB_SENDER_ADDRESS;
}
if (e.PB_TRUSTED_PROXY === "1") patch.trustedProxy = { headers: ["X-Forwarded-For"], useLeftmostIP: true };
if (e.PB_SMTP_HOST) {
  patch.smtp = {
    enabled: true, host: e.PB_SMTP_HOST, port: Number(e.PB_SMTP_PORT || 587),
    username: e.PB_SMTP_USER || "", password: e.PB_SMTP_PASS || "",
    tls: e.PB_SMTP_TLS === "1", authMethod: e.PB_SMTP_USER ? "PLAIN" : "",
  };
}
if (!Object.keys(patch).length) { console.log("nothing to change"); process.exit(0); }
await call("PATCH", "/api/settings", patch, auth.token);
console.log("settings updated:", Object.keys(patch).join(", "));
