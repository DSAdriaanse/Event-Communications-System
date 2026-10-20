/// <reference path="../pb_data/types.d.ts" />
//
// Per-event module switches.
//   events.disabled_modules  JSON array of module keys (page names, e.g. ["BibTracker","Documents"]).
// An empty/missing list means every module is enabled. Only admins may change it: event sessions can
// already edit parts of their own event (briefing, ConOps), so the update rule is extended to forbid it.

migrate((app) => {
  const events = app.findCollectionByNameOrId("events");
  if (!events.fields.getByName("disabled_modules")) {
    events.fields.add(new JSONField({ name: "disabled_modules", maxSize: 20000 }));
  }
  events.updateRule = '@request.auth.id != "" && (@request.auth.role = "admin" || (id = @request.auth.event_id && @request.body.pin:isset = false && @request.body.name:isset = false && @request.body.status:isset = false && @request.body.disabled_modules:isset = false))';
  app.save(events);
}, (app) => {
  const events = app.findCollectionByNameOrId("events");
  events.fields.removeByName("disabled_modules");
  events.updateRule = '@request.auth.id != "" && (@request.auth.role = "admin" || (id = @request.auth.event_id && @request.body.pin:isset = false && @request.body.name:isset = false && @request.body.status:isset = false))';
  app.save(events);
});
