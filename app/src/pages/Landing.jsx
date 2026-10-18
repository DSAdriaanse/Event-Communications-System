import { Link, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { createPageUrl } from "@/utils";
import { Radio, Users, MapPin, MessageSquare, Zap, ClipboardList, FileText, Shield } from "lucide-react";

const features = [
  { icon: Radio, label: "Frequencies", desc: "Manage radio channels, tones & modes", page: "Frequencies" },
  { icon: MapPin, label: "Incident Map", desc: "Live GPS map of all stations", page: "IncidentMap" },
  { icon: Users, label: "Operators", desc: "Track ham operators & license classes", page: "Operators" },
  { icon: MessageSquare, label: "Communications", desc: "Net traffic log with priority tiers", page: "Communications" },
  { icon: ClipboardList, label: "Assignments", desc: "Assign operators to stations & roles", page: "Assignments" },
  { icon: FileText, label: "ICS Reports", desc: "Export ICS 201/204/205A/213/309", page: "EventReport" },
];

export default function Landing() {
  const navigate = useNavigate();

  useEffect(() => {
    // When running as an installed PWA (standalone), redirect to the mobile volunteer entry
    if (window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches) {
      navigate("/VolunteerMobile", { replace: true });
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Hero */}
      <div className="flex flex-col items-center justify-center flex-1 px-6 py-20 text-center relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan-500/5 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/4 w-[300px] h-[300px] bg-blue-500/5 rounded-full blur-3xl" />
        </div>

        {/* Logo */}
        <div className="relative mb-8">
          <div className="absolute inset-0 bg-cyan-400/20 rounded-full blur-2xl scale-150" />
          <img
            src="/logo.svg"
            alt="SWCRS Logo"
            className="relative w-36 h-36 object-contain drop-shadow-2xl"
          />
        </div>

        {/* Title */}
        <div className="relative space-y-3 mb-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="w-8 h-px bg-cyan-500/40" />
            <span className="text-xs text-cyan-500 font-medium tracking-[0.2em] uppercase">Southwest Community Radio System</span>
            <span className="w-8 h-px bg-cyan-500/40" />
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight leading-tight">
            ECS<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400">
              Event Communications System
            </span>
          </h1>
          <p className="text-gray-400 text-lg max-w-xl mx-auto mt-4">
            Integrated communications management tool for events — operators, stations, frequencies, and real-time traffic.
          </p>
        </div>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row items-center gap-4 mt-10">
          <Link
            to={createPageUrl("Dashboard")}
            className="flex items-center gap-2 px-8 py-3.5 bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-bold rounded-xl text-sm transition-all shadow-lg shadow-cyan-500/20 hover:shadow-cyan-400/30 hover:scale-105"
          >
            <Shield className="w-4 h-4" />
            Enter Operations Dashboard
          </Link>
          <Link
            to={createPageUrl("Events")}
            className="flex items-center gap-2 px-8 py-3.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white font-semibold rounded-xl text-sm transition-all"
          >
            Manage Events
          </Link>
        </div>

        {/* Signal bars decoration */}
        <div className="flex items-end gap-1 mt-16 opacity-20">
          {[3, 5, 7, 9, 7, 5, 3].map((h, i) => (
            <div key={i} className="w-1 bg-cyan-400 rounded-full" style={{ height: `${h * 4}px` }} />
          ))}
        </div>
      </div>

      {/* Feature grid */}
      <div className="border-t border-gray-800 bg-gray-900/50 px-6 py-16">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-center text-white font-semibold text-lg mb-10">Everything you need for event comms</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {features.map(({ icon: Icon, label, desc, page }) => (
              <Link
                key={page}
                to={createPageUrl(page)}
                className="group bg-gray-800/50 hover:bg-gray-800 border border-gray-700/50 hover:border-cyan-500/30 rounded-xl p-5 transition-all"
              >
                <div className="w-9 h-9 rounded-lg bg-cyan-500/10 flex items-center justify-center mb-3 group-hover:bg-cyan-500/20 transition-colors">
                  <Icon className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="text-sm font-semibold text-white mb-1">{label}</div>
                <div className="text-xs text-gray-500">{desc}</div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-800 py-6 text-center">
        <p className="text-xs text-gray-600">SWCRS Event Communications System · Southwest Community Radio System · AZ / NM</p>
      </div>
    </div>
  );
}