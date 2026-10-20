# Legacy data import (Base44)

Only needed when bringing data over from the old Base44 deployment. Safe to delete afterwards.

Use the Base44 app's "Export all data" button. It downloads one JSON file. Put it in
`migration/base44-export/` (git-ignored: it contains personal data and the event PINs) and run the importer from any
computer with Node 18 or later (the installer no longer runs it for you):

```bash
node migration/import-base44.mjs --json migration/base44-export/export.json \
     --url https://ecs.example.org --email <superuser> --password '<password>' --dry-run   # then without --dry-run
```

A folder of per-table CSV files (`Event_export.csv`, `Operator_export.csv`, ...) works too: use `--dir migration/base44-export`
instead of `--json`.

* Original record ids and created/updated timestamps are preserved, so all references stay valid.
* Re-runnable: records whose id already exists are skipped.
* The Base44 admin PIN is **not** imported (the PIN chosen at install time stays); add `--with-admin-pin` to import it.
* `--dry-run` parses everything and writes nothing. Run it first and check the counts against the old app.
* Empty numbers (latitude, longitude, quantity) are stored as 0, which the app treats as "not set".
* Orphans are skipped by default and listed at the end of the run: a record whose event is not in the export, or whose link (station, frequency, operator, participant, log entry) points at a record that is not in the export. A record that pointed at a skipped one is skipped too. In your own export this is two bulletins whose log entry was deleted in Base44. Pass `--keep-orphans` to import records with dead links anyway (a record whose event is missing is always skipped, because the database requires the event).
* The JSON export names the secrets the old app used (`APRS_FI_API_KEY`, `BREVO_API_KEY`) without their values. Enter them again on the new server.
* Users in the export are not imported: ECS signs in with PINs.
* Documents are links; any pointing at Base44 file storage (`EventDocument.file_url`) die with the Base44 app. Download
  those files while it is reachable, host them elsewhere and update the links under Documents.
