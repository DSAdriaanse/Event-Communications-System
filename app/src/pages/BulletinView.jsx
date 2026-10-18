import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useParams } from "react-router-dom";
import { ArrowLeft, FileText, Loader2, Printer } from "lucide-react";
import { formatEventTime, getTzAbbr } from "@/lib/eventTime";

const PRIORITY_COLORS = {
  Routine: { border: "border-gray-700", badge: "bg-gray-800 text-gray-300", text: "text-gray-400" },
  Welfare: { border: "border-blue-700", badge: "bg-blue-900/50 text-blue-300", text: "text-blue-400" },
  Priority: { border: "border-amber-700", badge: "bg-amber-900/50 text-amber-300", text: "text-amber-400" },
  Emergency: { border: "border-red-700", badge: "bg-red-900/60 text-red-200", text: "text-red-400" },
};

export default function BulletinView() {
  const { id } = useParams();
  const [bulletin, setBulletin] = useState(null);
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    base44.entities.Bulletin.get(id).then(async (b) => {
      setBulletin(b);
      if (b?.event_id) {
        try {
          const ev = await base44.entities.Event.filter({ id: b.event_id }).then(r => r[0]);
          setEvent(ev);
        } catch { /* ignore */ }
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
      </div>
    );
  }

  if (!bulletin) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Bulletin not found.</p>
        </div>
      </div>
    );
  }

  const tz = event?.timezone || "America/Phoenix";
  const colors = PRIORITY_COLORS[bulletin.priority] || PRIORITY_COLORS.Routine;

  const handlePrint = () => window.print();

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between print:hidden">
        <button onClick={() => window.close()} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm">
          <ArrowLeft className="w-4 h-4" /> Close
        </button>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <FileText className="w-3.5 h-3.5" /> ICS 213 General Message
        </div>
        <button onClick={handlePrint} className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg text-xs font-medium transition-all">
          <Printer className="w-3.5 h-3.5" /> Print
        </button>
      </div>

      {/* Bulletin content */}
      <div className="max-w-2xl mx-auto p-6 print:max-w-none print:p-0">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden print:border-0 print:bg-white print:rounded-none">
          {/* Header */}
          <div className="bg-gray-800/50 px-5 py-3 border-b border-gray-800 print:bg-white print:border-gray-300">
            <span className="text-xs font-bold text-gray-400 print:text-gray-600 uppercase tracking-widest">ICS 213 — General Message (Bulletin)</span>
            {event && <p className="text-xs text-gray-500 mt-1 print:text-gray-500">{event.name}</p>}
          </div>

          {/* Fields grid */}
          <div className="px-5 py-5 space-y-4 print:px-0 print:py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500 print:text-gray-500 mb-1 block">1. To</label>
                <div className="text-sm text-white print:text-black font-medium">{bulletin.to || "All Operators"}</div>
              </div>
              <div>
                <label className="text-xs text-gray-500 print:text-gray-500 mb-1 block">2. From</label>
                <div className="text-sm text-white print:text-black font-medium">{bulletin.from_name || "—"}</div>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 print:text-gray-500 mb-1 block">3. Subject</label>
              <div className="text-lg text-white print:text-black font-bold">{bulletin.subject}</div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="text-xs text-gray-500 print:text-gray-500 mb-1 block">4. Date</label>
                <div className="text-sm text-white print:text-black">{bulletin.date || "—"}</div>
              </div>
              <div>
                <label className="text-xs text-gray-500 print:text-gray-500 mb-1 block">Time</label>
                <div className="text-sm text-white print:text-black">{bulletin.time || "—"}</div>
              </div>
              <div>
                <label className="text-xs text-gray-500 print:text-gray-500 mb-1 block">5. Msg #</label>
                <div className="text-sm text-white print:text-black font-mono">{bulletin.message_number || "—"}</div>
              </div>
              <div>
                <label className="text-xs text-gray-500 print:text-gray-500 mb-1 block">6. Priority</label>
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors.badge} print:border ${colors.border}`}>{bulletin.priority}</span>
              </div>
            </div>

            {/* Message body */}
            <div>
              <label className="text-xs text-gray-500 print:text-gray-500 mb-1 block">7. Message</label>
              <div
                className="text-sm text-gray-200 print:text-black leading-relaxed prose prose-sm prose-invert max-w-none print:text-black border border-gray-800 print:border-gray-300 rounded-lg p-4 min-h-[120px] bulletin-message-render"
                dangerouslySetInnerHTML={{ __html: bulletin.message || "<em>No message content</em>" }}
              />
            </div>

            {/* Approved by */}
            {bulletin.approved_by && (
              <div>
                <label className="text-xs text-gray-500 print:text-gray-500 mb-1 block">8. Approved By / Signature</label>
                <div className="text-sm text-white print:text-black font-medium border-b border-dotted border-gray-700 print:border-gray-400 pb-1">{bulletin.approved_by}</div>
              </div>
            )}

            {/* Reply */}
            {bulletin.reply && (
              <div>
                <label className="text-xs text-gray-500 print:text-gray-500 mb-1 block">Reply</label>
                <div className="text-sm text-gray-300 print:text-gray-700">{bulletin.reply}</div>
                {bulletin.reply_by && <div className="text-xs text-gray-500 mt-1">— {bulletin.reply_by}</div>}
              </div>
            )}

            {/* Footer */}
            <div className="pt-4 border-t border-gray-800 print:border-gray-300 flex items-center justify-between text-xs text-gray-500 print:text-gray-500">
              <span>Issued {formatEventTime(bulletin.created_date, tz)} {getTzAbbr(tz)}</span>
              {bulletin.sent_count != null && <span>{bulletin.sent_count} email(s) sent</span>}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .bulletin-message-render p { margin: 0.5em 0; }
        .bulletin-message-render h1, .bulletin-message-render h2, .bulletin-message-render h3 { font-weight: bold; margin: 0.6em 0 0.3em; }
        .bulletin-message-render ul, .bulletin-message-render ol { padding-left: 1.5em; margin: 0.4em 0; }
        .bulletin-message-render blockquote { border-left: 3px solid #374151; padding-left: 12px; color: #9ca3af; margin: 0.5em 0; }
        .bulletin-message-render a { color: #22d3ee; text-decoration: underline; }
        @media print {
          .bulletin-message-render { color: #000 !important; }
          .bulletin-message-render a { color: #000 !important; }
        }
      `}</style>
    </div>
  );
}