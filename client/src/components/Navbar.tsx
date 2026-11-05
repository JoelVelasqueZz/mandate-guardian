import React from "react";
import { ShieldCheck, ShoppingBag, Database, Key, RefreshCw, Sparkles } from "lucide-react";
import { SystemHealth } from "../types";

interface NavbarProps {
  systemHealth: SystemHealth | null;
  demoKey: string;
  onOpenSettings: () => void;
  onRefresh: () => void;
  loading: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  systemHealth,
  demoKey,
  onOpenSettings,
  onRefresh,
  loading,
}) => {
  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-soft">
      <div className="max-w-[1720px] mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between">
        {/* Brand identity: PayPal + Channel3 + Mandate Guardian */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-paypal-navy to-paypal-vibrant shadow-md text-white font-bold">
            <ShieldCheck className="w-6 h-6 text-paypal-gold" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-black tracking-tight text-slate-950 flex items-center gap-1.5">
                <span>Mandate</span>
                <span className="text-slate-500 font-light" aria-hidden="true">&</span>
                <span className="text-paypal-vibrant">Guardian</span>
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-950 border border-blue-300">
                <span className="w-1.5 h-1.5 rounded-full bg-paypal-vibrant animate-pulse" aria-hidden="true"></span>
                PayPal Sandbox
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-950 border border-indigo-300">
                <ShoppingBag className="w-3 h-3 text-indigo-700" aria-hidden="true" />
                Channel3
              </span>
            </div>
            <p className="text-xs text-slate-600 font-semibold">
              Trust layer and independent auditor for AI shopping agents
            </p>
          </div>
        </div>

        {/* System telemetry badges */}
        <nav aria-label="System status" className="hidden xl:flex items-center gap-2">
          {/* Catalog indicator */}
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-slate-100 border border-slate-300 text-slate-800">
            <Database className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
            <span>Catalog:</span>
            <span className={`font-bold ${systemHealth?.catalog === "channel3" ? "text-emerald-800" : "text-amber-900"}`}>
              {systemHealth?.catalog === "channel3" ? "Channel3 (live)" : "Offline demo catalog"}
            </span>
          </div>

          {/* AI model indicator */}
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-slate-100 border border-slate-300 text-slate-800">
            <Sparkles className="w-3.5 h-3.5 text-indigo-700" aria-hidden="true" />
            <span>AI reviewer:</span>
            <span className={`font-bold ${systemHealth?.ai ? "text-indigo-900" : "text-slate-700"}`}>
              {systemHealth?.ai ? "Model enabled" : "Rules only"}
            </span>
          </div>

          {/* PayPal Demo Key Status */}
          <button
            onClick={onOpenSettings}
            aria-label="Open settings for the demo key used by payment actions"
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
              demoKey
                ? "bg-emerald-100 border-emerald-300 text-emerald-950 hover:bg-emerald-200"
                : "bg-amber-100 border-amber-300 text-amber-950 hover:bg-amber-200"
            }`}
            title="Set the demo key for payment actions"
          >
            <Key className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Demo Key:</span>
            <span className="font-bold">{demoKey ? "Set" : "Not set"}</span>
          </button>
        </nav>

        {/* Right side controls */}
        <div className="flex items-center gap-3">
          {/* Refresh action */}
          <button
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh the table and system status"
            className="p-2 rounded-xl text-slate-700 hover:text-slate-950 hover:bg-slate-100 border border-slate-300 transition-colors disabled:opacity-50"
            title="Refresh data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-paypal-vibrant" : ""}`} />
          </button>

        </div>
      </div>
    </header>
  );
};
