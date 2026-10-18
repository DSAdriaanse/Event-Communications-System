import { useState, useEffect, useRef } from "react";
import { db } from "@/api/ecs";
import { useEvent } from "@/components/EventContext";
import { useAuth } from "@/components/PinGate";
import { Save, Loader2, MessageSquareText } from "lucide-react";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";

const quillModules = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline", "strike"],
    [{ color: [] }, { background: [] }],
    [{ list: "ordered" }, { list: "bullet" }],
    ["blockquote"],
    ["link", "image"],
    ["clean"],
  ],
};

const quillFormats = [
  "header", "bold", "italic", "underline", "strike",
  "color", "background",
  "list", "bullet",
  "blockquote",
  "link", "image",
];

export default function Discussion() {
  const { activeEvent, activeEventId, loadEvents } = useEvent();
  const { canEdit } = useAuth();
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    if (activeEvent) {
      setContent(activeEvent.discussion || "");
      setLoaded(true);
    }
  }, [activeEvent?.id]);

  const save = async (html) => {
    if (!activeEventId) return;
    setSaving(true);
    setSaved(false);
    await db.events.update(activeEventId, { discussion: html });
    await loadEvents();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleChange = (html) => {
    setContent(html);
    if (!canEdit) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(html), 1500);
  };

  const handleManualSave = () => {
    clearTimeout(saveTimer.current);
    save(content);
  };

  if (!activeEventId) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center text-gray-600">
          <MessageSquareText className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Select an event to view the discussion.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <style>{`
        .discussion-editor .ql-toolbar.ql-snow {
          background: #1f2937;
          border: 1px solid #374151;
          border-bottom: none;
          border-radius: 8px 8px 0 0;
          padding: 8px;
        }
        .discussion-editor .ql-toolbar.ql-snow .ql-stroke { stroke: #9ca3af; }
        .discussion-editor .ql-toolbar.ql-snow .ql-fill { fill: #9ca3af; }
        .discussion-editor .ql-toolbar.ql-snow .ql-picker { color: #9ca3af; }
        .discussion-editor .ql-toolbar.ql-snow button:hover .ql-stroke,
        .discussion-editor .ql-toolbar.ql-snow button.ql-active .ql-stroke { stroke: #22d3ee; }
        .discussion-editor .ql-toolbar.ql-snow button:hover .ql-fill,
        .discussion-editor .ql-toolbar.ql-snow button.ql-active .ql-fill { fill: #22d3ee; }
        .discussion-editor .ql-toolbar.ql-snow .ql-picker-label:hover,
        .discussion-editor .ql-toolbar.ql-snow .ql-picker-label.ql-active { color: #22d3ee; }
        .discussion-editor .ql-toolbar.ql-snow .ql-picker-options {
          background: #1f2937;
          border: 1px solid #374151;
        }
        .discussion-editor .ql-toolbar.ql-snow .ql-picker-item { color: #d1d5db; }
        .discussion-editor .ql-toolbar.ql-snow .ql-picker-item:hover { color: #22d3ee; }
        .discussion-editor .ql-container.ql-snow {
          background: #111827;
          border: 1px solid #374151;
          border-radius: 0 0 8px 8px;
          font-size: 14px;
        }
        .discussion-editor .ql-editor {
          color: #e5e7eb;
          min-height: 400px;
          line-height: 1.7;
        }
        .discussion-editor .ql-editor.ql-blank::before {
          color: #4b5563;
          font-style: italic;
        }
        .discussion-editor .ql-editor h1,
        .discussion-editor .ql-editor h2,
        .discussion-editor .ql-editor h3 { color: #f9fafb; }
        .discussion-editor .ql-editor a { color: #22d3ee; }
        .discussion-editor .ql-editor blockquote {
          border-left: 4px solid #374151;
          color: #9ca3af;
          margin-left: 0;
          padding-left: 12px;
        }
        .discussion-editor .ql-editor img {
          max-width: 100%;
          border-radius: 6px;
          margin: 8px 0;
        }
      `}</style>

      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Briefing</h1>
            <p className="text-gray-500 text-sm mt-1">{activeEvent?.name} — Situational Awareness &amp; Briefing</p>
          </div>
          {canEdit && (
            <button
              onClick={handleManualSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 text-gray-950 font-semibold rounded-lg text-sm transition-all"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
            </button>
          )}
        </div>

        <p className="text-xs text-gray-600">
          Situational awareness, safety remarks, weather forecasts, course conditions.{canEdit ? " Auto-saves as you type." : ""}
        </p>

        {loaded && (
          canEdit ? (
            <div className="discussion-editor">
              <ReactQuill
                theme="snow"
                value={content}
                onChange={handleChange}
                modules={quillModules}
                formats={quillFormats}
                placeholder="Enter situational awareness briefing — current event state, safety remarks, anticipated weather, course conditions..."
              />
            </div>
          ) : (
            <div
              className="bg-gray-900 border border-gray-800 rounded-xl p-6 prose prose-invert max-w-none text-gray-200 ql-editor"
              style={{ minHeight: 200 }}
              dangerouslySetInnerHTML={{ __html: content || "<p style='color:#4b5563;font-style:italic'>No briefing content yet.</p>" }}
            />
          )
        )}
      </div>
    </div>
  );
}