import { useState } from "react";
import { db } from "@/api/ecs";
import { X, Upload, AlertCircle } from "lucide-react";

export default function BibImportModal({ eventId, onClose, onImported }) {
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState([]);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(null);

  const parseCSV = (text) => {
    const lines = text.trim().split("\n").filter(l => l.trim());
    if (lines.length < 2) return [];
    const header = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\s+/g, "_").replace(/"/g, ""));
    const bibIdx = header.findIndex(h => h.includes("bib"));
    const nameIdx = header.findIndex(h => h.includes("name"));
    if (bibIdx === -1 || nameIdx === -1) return null;
    return lines.slice(1).map(line => {
      const cols = line.split(",").map(c => c.trim().replace(/"/g, ""));
      return { bib_number: cols[bibIdx], runner_name: cols[nameIdx] };
    }).filter(r => r.bib_number && r.runner_name);
  };

  const handleTextChange = (text) => {
    setCsvText(text);
    setError("");
    setPreview([]);
    if (!text.trim()) return;
    const rows = parseCSV(text);
    if (rows === null) { setError('CSV must have columns named "bib" and "name" (case insensitive).'); return; }
    setPreview(rows);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => handleTextChange(ev.target.result);
    reader.readAsText(file);
  };

  const doImport = async () => {
    setImporting(true);
    let created = 0, updated = 0;
    const existing = await db.participants.filter({ event_id: eventId });
    const existingMap = new Map(existing.map(p => [p.bib_number, p]));
    for (const row of preview) {
      const match = existingMap.get(row.bib_number);
      if (match) {
        await db.participants.update(match.id, { runner_name: row.runner_name });
        updated++;
      } else {
        await db.participants.create({ event_id: eventId, bib_number: row.bib_number, runner_name: row.runner_name, status: "Active" });
        created++;
      }
    }
    setDone({ created, updated });
    setImporting(false);
    onImported();
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">Import Participants (CSV)</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-xs text-gray-400">CSV must contain a <code className="bg-gray-800 px-1 rounded">bib</code> column and a <code className="bg-gray-800 px-1 rounded">name</code> column. Additional columns are ignored.</p>

          <div className="flex gap-3">
            <label className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-300 cursor-pointer transition-all">
              <Upload className="w-3.5 h-3.5" /> Choose File
              <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
            </label>
            <span className="text-xs text-gray-600 self-center">or paste below</span>
          </div>

          <textarea
            value={csvText}
            onChange={e => handleTextChange(e.target.value)}
            placeholder={"bib,name\n1,Jane Doe\n2,John Smith"}
            rows={5}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none resize-none"
          />

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
            </div>
          )}

          {preview.length > 0 && !done && (
            <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
              {preview.length} participants ready to import. First few: {preview.slice(0, 3).map(r => `#${r.bib_number} ${r.runner_name}`).join(", ")}{preview.length > 3 ? "..." : ""}
            </div>
          )}

          {done && (
            <div className="text-xs text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded-lg px-3 py-2">
              Import complete: {done.created} added, {done.updated} updated (name only).
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Close</button>
          {!done && (
            <button onClick={doImport} disabled={preview.length === 0 || importing}
              className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-gray-950 font-semibold rounded-lg text-sm">
              {importing ? "Importing..." : `Import ${preview.length} Participants`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}