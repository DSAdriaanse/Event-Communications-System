import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useEvent } from "@/components/EventContext";
import { useAuth } from "@/components/PinGate";
import { Save, Loader2, BookOpen } from "lucide-react";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";

const quillModules = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline", "strike"],
    [{ color: [] }, { background: [] }],
    [{ list: "ordered" }, { list: "bullet" }],
    ["blockquote"],
    ["link"],
    ["clean"],
  ],
};

const quillFormats = [
  "header", "bold", "italic", "underline", "strike",
  "color", "background",
  "list", "bullet",
  "blockquote",
  "link",
];

const editorStyles = `
  .conops-editor .ql-toolbar.ql-snow {
    background: #1f2937;
    border: 1px solid #374151;
    border-bottom: none;
    border-radius: 8px 8px 0 0;
    padding: 8px;
  }
  .conops-editor .ql-toolbar.ql-snow .ql-stroke { stroke: #9ca3af; }
  .conops-editor .ql-toolbar.ql-snow .ql-fill { fill: #9ca3af; }
  .conops-editor .ql-toolbar.ql-snow .ql-picker { color: #9ca3af; }
  .conops-editor .ql-toolbar.ql-snow button:hover .ql-stroke,
  .conops-editor .ql-toolbar.ql-snow button.ql-active .ql-stroke { stroke: #22d3ee; }
  .conops-editor .ql-toolbar.ql-snow button:hover .ql-fill,
  .conops-editor .ql-toolbar.ql-snow button.ql-active .ql-fill { fill: #22d3ee; }
  .conops-editor .ql-toolbar.ql-snow .ql-picker-label:hover,
  .conops-editor .ql-toolbar.ql-snow .ql-picker-label.ql-active { color: #22d3ee; }
  .conops-editor .ql-toolbar.ql-snow .ql-picker-options {
    background: #1f2937;
    border: 1px solid #374151;
  }
  .conops-editor .ql-toolbar.ql-snow .ql-picker-item { color: #d1d5db; }
  .conops-editor .ql-toolbar.ql-snow .ql-picker-item:hover { color: #22d3ee; }
  .conops-editor .ql-container.ql-snow {
    background: #111827;
    border: 1px solid #374151;
    border-radius: 0 0 8px 8px;
    font-size: 14px;
  }
  .conops-editor .ql-editor {
    color: #e5e7eb;
    min-height: 300px;
    line-height: 1.7;
  }
  .conops-editor .ql-editor.ql-blank::before {
    color: #4b5563;
    font-style: italic;
  }
  .conops-editor .ql-editor h1,
  .conops-editor .ql-editor h2,
  .conops-editor .ql-editor h3 { color: #f9fafb; }
  .conops-editor .ql-editor a { color: #22d3ee; }
  .conops-editor .ql-editor blockquote {
    border-left: 4px solid #374151;
    color: #9ca3af;
    margin-left: 0;
    padding-left: 12px;
  }
`;

function RichSection({ title, description, fieldKey, value, onChange, canEdit, saving, saved, onSave }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
        {canEdit && (
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-2 px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 text-gray-950 font-semibold rounded-lg text-sm transition-all"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </button>
        )}
      </div>
      <div className="p-4">
        {canEdit ? (
          <div className="conops-editor">
            <ReactQuill
              theme="snow"
              value={value}
              onChange={onChange}
              modules={quillModules}
              formats={quillFormats}
              placeholder="Enter content here…"
            />
          </div>
        ) : (
          <div
            className="prose prose-invert max-w-none text-gray-200 ql-editor"
            style={{ minHeight: 120 }}
            dangerouslySetInnerHTML={{ __html: value || "<p style='color:#4b5563;font-style:italic'>No content yet.</p>" }}
          />
        )}
      </div>
    </div>
  );
}

export default function ConOps() {
  const { activeEvent, activeEventId, loadEvents } = useEvent();
  const { canEdit } = useAuth();

  const [comms, setComms] = useState("");
  const [savingComms, setSavingComms] = useState(false);
  const [savedComms, setSavedComms] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const commsTimer = useRef(null);

  useEffect(() => {
    if (activeEvent) {
      setComms(activeEvent.conops_comms || "");
      setLoaded(true);
    }
  }, [activeEvent?.id]);

  const saveComms = async (html) => {
    if (!activeEventId) return;
    setSavingComms(true);
    setSavedComms(false);
    await base44.entities.Event.update(activeEventId, { conops_comms: html });
    await loadEvents();
    setSavingComms(false);
    setSavedComms(true);
    setTimeout(() => setSavedComms(false), 2500);
  };

  const handleCommsChange = (html) => {
    setComms(html);
    if (!canEdit) return;
    clearTimeout(commsTimer.current);
    commsTimer.current = setTimeout(() => saveComms(html), 1500);
  };

  if (!activeEventId) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center text-gray-600">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Select an event to view ConOps.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <style>{editorStyles}</style>
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Concept of Operations</h1>
          <p className="text-gray-500 text-sm mt-1">{activeEvent?.name} — Operational planning documents</p>
        </div>

        {loaded && (
          <RichSection
            title="Communications ConOps"
            description="How the frequency plan will work and how communications will be executed. Exported to ICS 205A Section 3."
            fieldKey="conops_comms"
            value={comms}
            onChange={handleCommsChange}
            canEdit={canEdit}
            saving={savingComms}
            saved={savedComms}
            onSave={() => { clearTimeout(commsTimer.current); saveComms(comms); }}
          />
        )}
      </div>
    </div>
  );
}