import { useEffect } from "react";
import { useEvent } from "@/components/EventContext";
import { FolderOpen, ExternalLink } from "lucide-react";

export default function Documents() {
  const { activeEvent } = useEvent();
  const url = activeEvent?.documents_url;

  useEffect(() => {
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [url]);

  if (!activeEvent) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center text-gray-600">
          <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Select an event to access documents.</p>
        </div>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center text-gray-600 max-w-sm">
          <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm text-gray-400">No document repository configured for this event.</p>
          <p className="text-xs text-gray-600 mt-2">An admin can set the Documents URL in the Events settings.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center text-gray-400 max-w-sm space-y-4">
        <div className="w-14 h-14 rounded-full bg-cyan-500/10 flex items-center justify-center mx-auto">
          <ExternalLink className="w-6 h-6 text-cyan-400" />
        </div>
        <p className="text-sm">Opening document repository in a new tab…</p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-semibold rounded-lg text-sm transition-all"
        >
          <ExternalLink className="w-4 h-4" /> Open Documents
        </a>
      </div>
    </div>
  );
}