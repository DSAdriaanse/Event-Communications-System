import { useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
import { db, callFunction } from "@/api/ecs";
import { useEvent } from "@/components/EventContext";
import { Send, Download, ArrowLeft, FileText, CheckCircle } from "lucide-react";
import { createPageUrl } from "@/utils";

const PRIORITIES = ["Routine", "Welfare", "Priority", "Emergency"];

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
  "color", "background", "list", "bullet", "blockquote", "link",
];

const editorStyles = `
  .bulletin-editor .ql-toolbar.ql-snow {
    background: #1f2937; border: 1px solid #374151; border-bottom: none;
    border-radius: 8px 8px 0 0; padding: 8px;
  }
  .bulletin-editor .ql-toolbar.ql-snow .ql-stroke { stroke: #9ca3af; }
  .bulletin-editor .ql-toolbar.ql-snow .ql-fill { fill: #9ca3af; }
  .bulletin-editor .ql-toolbar.ql-snow .ql-picker { color: #9ca3af; }
  .bulletin-editor .ql-toolbar.ql-snow button:hover .ql-stroke,
  .bulletin-editor .ql-toolbar.ql-snow button.ql-active .ql-stroke { stroke: #22d3ee; }
  .bulletin-editor .ql-toolbar.ql-snow button:hover .ql-fill,
  .bulletin-editor .ql-toolbar.ql-snow button.ql-active .ql-fill { fill: #22d3ee; }
  .bulletin-editor .ql-toolbar.ql-snow .ql-picker-label:hover,
  .bulletin-editor .ql-toolbar.ql-snow .ql-picker-label.ql-active { color: #22d3ee; }
  .bulletin-editor .ql-toolbar.ql-snow .ql-picker-options { background: #1f2937; border: 1px solid #374151; }
  .bulletin-editor .ql-toolbar.ql-snow .ql-picker-item { color: #d1d5db; }
  .bulletin-editor .ql-toolbar.ql-snow .ql-picker-item:hover { color: #22d3ee; }
  .bulletin-editor .ql-container.ql-snow {
    background: #111827; border: 1px solid #374151;
    border-radius: 0 0 8px 8px; font-size: 14px;
  }
  .bulletin-editor .ql-editor { color: #e5e7eb; min-height: 220px; line-height: 1.7; }
  .bulletin-editor .ql-editor.ql-blank::before { color: #4b5563; font-style: italic; }
  .bulletin-editor .ql-editor h1,
  .bulletin-editor .ql-editor h2,
  .bulletin-editor .ql-editor h3 { color: #f9fafb; }
  .bulletin-editor .ql-editor a { color: #22d3ee; }
  .bulletin-editor .ql-editor blockquote {
    border-left: 4px solid #374151; color: #9ca3af; margin-left: 0; padding-left: 12px;
  }
`;

const PRIORITY_COLORS = {
  Routine: "border-gray-700",
  Welfare: "border-blue-600",
  Priority: "border-amber-600",
  Emergency: "border-red-600",
};

function buildICS213PrintHtml({ bulletin, eventName, issuedBy }) {
  const CSS = `
    body { font-family: Arial, sans-serif; font-size: 11pt; color: #111; max-width: 780px; margin: 0 auto; padding: 20px; }
    h2 { margin: 0 0 4px; font-size: 16pt; color: #0891b2; }
    .subtitle { font-size: 10pt; color: #444; margin-bottom: 16px; }
    .header-block { border: 2px solid #1a1a2e; border-radius: 4px; margin-bottom: 16px; overflow: hidden; }
    .header-title { background: #1a1a2e; color: #fff; padding: 6px 12px; font-size: 12pt; font-weight: bold; letter-spacing: 0.05em; }
    .field-row { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid #ccc; }
    .field-row.single { grid-template-columns: 1fr; }
    .field { padding: 6px 10px; border-right: 1px solid #ccc; }
    .field:last-child { border-right: none; }
    .field .label { font-size: 8pt; color: #888; margin-bottom: 2px; }
    .field .value { font-size: 11pt; font-weight: bold; min-height: 18px; }
    .message-box { border: 2px solid #1a1a2e; border-radius: 4px; padding: 12px; min-height: 120px; font-size: 11pt; line-height: 1.6; white-space: pre-wrap; margin-bottom: 16px; }
    .sig-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    .sig-box { border: 1px solid #ccc; border-radius: 4px; padding: 8px 12px; }
    .sig-box .label { font-size: 8pt; color: #888; }
    .sig-box .value { font-size: 10pt; min-height: 20px; border-bottom: 1px dotted #999; margin-top: 4px; }
    .issued-by { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; font-size: 10pt; }
    .footer { margin-top: 20px; font-size: 9pt; color: #666; border-top: 1px solid #ddd; padding-top: 8px; }
  `;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ICS 213 — ${bulletin.subject}</title>
<style>${CSS}</style></head><body>
<h2>ICS 213 — General Message (Bulletin)</h2>
<div class="subtitle">SWCRS Event Communications Suite · ${eventName}</div>
<div class="issued-by">📢 <strong>Issued by:</strong> ${issuedBy} · ${new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' })}</div>
<div class="header-block">
  <div class="header-title">ICS 213 — GENERAL MESSAGE</div>
  <div class="field-row">
    <div class="field"><div class="label">1. To</div><div class="value">${bulletin.to || 'All Operators'}</div></div>
    <div class="field"><div class="label">2. From</div><div class="value">${bulletin.from_name || ''}</div></div>
  </div>
  <div class="field-row">
    <div class="field"><div class="label">3. Subject</div><div class="value">${bulletin.subject}</div></div>
    <div class="field"><div class="label">4. Date / Time</div><div class="value">${bulletin.date || ''} ${bulletin.time || ''}</div></div>
  </div>
  <div class="field-row">
    <div class="field"><div class="label">5. Message Number</div><div class="value">${bulletin.message_number || '—'}</div></div>
    <div class="field"><div class="label">6. Priority</div><div class="value">${bulletin.priority}</div></div>
  </div>
</div>
<div class="message-box">${bulletin.message}</div>
<div class="sig-row">
  <div class="sig-box"><div class="label">Approved By / Signature</div><div class="value">${bulletin.approved_by || ''}</div></div>
  <div class="sig-box"><div class="label">Reply</div><div class="value">${bulletin.reply || ''}</div></div>
</div>
<div class="footer">SWCRS Event Communications Suite — ICS 213 General Message · Generated ${new Date().toLocaleString()}</div>
</body></html>`;
}

export default function IssueBulletin() {
  const navigate = useNavigate();
  const { activeEvent, activeEventId } = useEvent();
  const now = new Date();
  const defaultDate = now.toLocaleDateString('en-US', { timeZone: 'America/Phoenix' });
  const defaultTime = now.toLocaleTimeString('en-US', { timeZone: 'America/Phoenix', hour: '2-digit', minute: '2-digit', hour12: false });

  const [form, setForm] = useState({
    to: "All Operators",
    from_name: "",
    subject: "",
    date: defaultDate,
    time: defaultTime,
    message_number: "",
    priority: "Routine",
    message: "",
    approved_by: "",
  });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null); // { sent, bulletin }

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleIssue = async () => {
    if (!form.subject.trim() || !form.message.trim()) return;
    setSending(true);

    // 1. Save bulletin record
    const bulletin = await db.bulletins.create({
      ...form,
      event_id: activeEventId,
    });

    // 2. Send email via sendICSEmail function (BULLETIN type)
    let sent = 0;
    const emailRes = await callFunction('sendICSEmail', {
      event_id: activeEventId,
      form_type: 'BULLETIN',
      bulletin_id: bulletin.id,
      subject: form.subject,
      message: form.message,
      from_name: form.from_name,
      to: form.to,
      priority: form.priority,
      date: form.date,
      time: form.time,
      message_number: form.message_number,
      approved_by: form.approved_by,
    });
    sent = emailRes.data?.sent || 0;

    // 3. Post to EventLog so it appears in Communications feed
    const logContent = `📋 Bulletin Issued: "${form.subject}"${form.message_number ? ` [#${form.message_number}]` : ''} — issued by ${form.from_name || 'NCO'}
Sent to ${sent} operator(s) via email.`;
    const logEntry = await db.eventLogs.create({
      event_id: activeEventId,
      type: "system_event",
      content: logContent,
      priority: form.priority,
      message_type: "General",
    });

    // 4. Update bulletin with sent count and log id
    await db.bulletins.update(bulletin.id, { sent_count: sent, event_log_id: logEntry.id });

    setResult({ sent, bulletin: { ...bulletin, ...form } });
    setSending(false);
  };

  const downloadPDF = () => {
    if (!result) return;
    const html = buildICS213PrintHtml({
      bulletin: result.bulletin,
      eventName: activeEvent?.name || '',
      issuedBy: form.from_name || 'NCO',
    });
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.print();
  };

  if (result) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="bg-gray-900 border border-gray-700 rounded-2xl max-w-md w-full p-8 text-center space-y-5">
          <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto">
            <CheckCircle className="w-8 h-8 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-white text-xl font-bold">Bulletin Issued</h2>
            <p className="text-gray-400 text-sm mt-1">"{result.bulletin.subject}"</p>
            <p className="text-emerald-400 text-sm mt-2 font-medium">{result.sent} operator email{result.sent !== 1 ? "s" : ""} sent · Logged to Communications</p>
          </div>
          <div className="flex flex-col gap-3">
            <button onClick={downloadPDF}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-all">
              <Download className="w-4 h-4" /> Download / Print ICS 213
            </button>
            <button onClick={() => navigate(createPageUrl("Communications"))}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-gray-950 rounded-lg text-sm font-semibold transition-all">
              <FileText className="w-4 h-4" /> View in Communications Log
            </button>
            <button onClick={() => { setResult(null); setForm(f => ({ ...f, subject: "", message: "", approved_by: "", message_number: "" })); }}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Issue another bulletin</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <style>{editorStyles}</style>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(createPageUrl("Communications"))}
            className="p-2 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition-all">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-white text-xl font-bold">Issue General Bulletin</h1>
            <p className="text-gray-500 text-xs">ICS 213 General Message · {activeEvent?.name || "No event selected"}</p>
          </div>
        </div>

        {/* Form */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="bg-gray-800/50 px-5 py-3 border-b border-gray-800">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">ICS 213 — General Message</span>
          </div>
          <div className="px-5 py-5 space-y-4">
            {/* Row 1: To / From */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">1. To</label>
                <input value={form.to} onChange={e => set("to", e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">2. From (Callsign / Name)</label>
                <input value={form.from_name} onChange={e => set("from_name", e.target.value)} placeholder="W1ABC / John Smith"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
              </div>
            </div>
            {/* Row 2: Subject */}
            <div>
              <label className="text-xs text-gray-400 mb-1 block">3. Subject *</label>
              <input value={form.subject} onChange={e => set("subject", e.target.value)} placeholder="Brief subject of this bulletin"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
            </div>
            {/* Row 3: Date / Time / Msg# / Priority */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">4. Date</label>
                <input value={form.date} onChange={e => set("date", e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Time</label>
                <input value={form.time} onChange={e => set("time", e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">5. Msg #</label>
                <input value={form.message_number} onChange={e => set("message_number", e.target.value)} placeholder="e.g. 001"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">6. Priority</label>
                <select value={form.priority} onChange={e => set("priority", e.target.value)}
                  className={`w-full bg-gray-800 border rounded-lg px-3 py-2 text-sm text-white focus:outline-none ${PRIORITY_COLORS[form.priority]}`}>
                  {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
            </div>
            {/* Message */}
            <div>
              <label className="text-xs text-gray-400 mb-1 block">7. Message *</label>
              <div className="bulletin-editor">
                <ReactQuill
                  theme="snow"
                  value={form.message}
                  onChange={val => set("message", val)}
                  modules={quillModules}
                  formats={quillFormats}
                  placeholder="Enter the full bulletin message here…"
                />
              </div>
            </div>
            {/* Approved by */}
            <div>
              <label className="text-xs text-gray-400 mb-1 block">8. Approved By / Signature</label>
              <input value={form.approved_by} onChange={e => set("approved_by", e.target.value)} placeholder="Net Control callsign or name"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
            </div>
          </div>
          <div className="px-5 py-4 border-t border-gray-800 flex items-center justify-between gap-4 bg-gray-900">
            <p className="text-xs text-gray-500">Will email all operators with addresses on file &amp; post to the Communications log.</p>
            <button onClick={handleIssue} disabled={sending || !form.subject.trim() || !form.message.trim()}
              className="flex items-center gap-2 px-6 py-2.5 bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 disabled:text-gray-500 text-gray-950 font-semibold rounded-lg text-sm transition-all whitespace-nowrap">
              <Send className="w-4 h-4" />
              {sending ? "Issuing..." : "Issue Bulletin"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}