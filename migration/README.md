# Legacy data import (Base44)

Only needed when bringing data over from the old Base44 deployment. Safe to delete afterwards.

Put the CSV files exported from the Base44 dashboard (`Event_export.csv`, `Operator_export.csv`, ...) in
`migration/base44-export/` (git-ignored: it contains personal data) and either pass the folder to the
bootstrap script (`--import-dir`) or run the importer by hand:

```bash
node migration/import-base44.mjs --dir migration/base44-export \
     --url http://127.0.0.1:8090 --email <superuser> --password '<password>'
```

* Original record ids and created/updated timestamps are preserved, so all references stay valid.
* Re-runnable: records whose id already exists are skipped.
* The Base44 admin PIN is **not** imported (the PIN chosen at install time stays); add `--with-admin-pin` to import it.
* `--dry-run` parses everything and writes nothing.
* Documents are links; any pointing at Base44 file storage (`EventDocument.file_url`) die with the Base44 app. Download
  those files while it is reachable, host them elsewhere and update the links under Documents.
