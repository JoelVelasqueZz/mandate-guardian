import React from "react";
import { Bot, ShieldCheck, CreditCard, FileCheck2, Rocket, Info } from "lucide-react";

interface GettingStartedProps {
  onUseExample: () => void;
  onOpenRedTeam: () => void;
  loading: boolean;
  catalogIsDemo: boolean;
}

const steps = [
  { icon: Bot, title: "Mandate proposes", text: "The buyer agent searches the catalog and can only propose a purchase. It has no way to pay." },
  { icon: ShieldCheck, title: "Guardian decides", text: "Rules written as code approve, block or ask you. The Guardian reads the real price itself and signs its approval." },
  { icon: CreditCard, title: "PayPal pays", text: "Only a signed approval can create a PayPal Sandbox order. You approve as the buyer." },
  { icon: FileCheck2, title: "Guardian reconciles", text: "After the charge, the amount PayPal took is compared with what was approved, and a refund is recommended if it differs." },
];

export const GettingStarted: React.FC<GettingStartedProps> = ({ onUseExample, onOpenRedTeam, loading, catalogIsDemo }) => (
  <section aria-labelledby="getting-started-heading" className="bg-white rounded-2xl border border-slate-200/90 shadow-soft mb-6 overflow-hidden">
    <div className="p-5 sm:p-6 flex flex-wrap items-start justify-between gap-4 bg-gradient-to-r from-paypal-navy to-paypal-dark text-white">
      <div className="max-w-2xl">
        <h2 id="getting-started-heading" className="text-xl font-black tracking-tight">The agent that spends is not the one that watches</h2>
        <p className="text-sm text-slate-200 mt-1">
          Set the rules once. A shopping agent buys inside them, and an independent auditor checks every purchase before PayPal
          moves any money.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onUseExample}
          disabled={loading}
          className="px-4 py-2.5 rounded-xl bg-paypal-gold hover:bg-paypal-goldHover text-paypal-navy font-black text-xs shadow-md transition-all flex items-center gap-2 disabled:opacity-60"
        >
          <Rocket className="w-4 h-4" aria-hidden="true" />
          <span>Start with an example mandate</span>
        </button>
        <button
          onClick={onOpenRedTeam}
          className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/30 transition-colors"
        >
          Try to fool the Guardian
        </button>
      </div>
    </div>

    <ol className="grid grid-cols-1 md:grid-cols-4 gap-px bg-slate-200">
      {steps.map(({ icon: Icon, title, text }, i) => (
        <li key={title} className="bg-white p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-6 h-6 rounded-full bg-paypal-light text-paypal-vibrant text-[11px] font-black flex items-center justify-center">{i + 1}</span>
            <Icon className="w-4 h-4 text-paypal-vibrant" aria-hidden="true" />
            <span className="text-xs font-extrabold text-slate-900">{title}</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">{text}</p>
        </li>
      ))}
    </ol>

    <div className="px-5 py-3 bg-amber-50 border-t border-amber-200 text-[11px] text-amber-950 flex items-start gap-2">
      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
      <span>
        This is a PayPal Sandbox demo: no real money moves. Records live in the server's memory and reset when it restarts or sleeps
        {catalogIsDemo ? ", and products come from a labeled offline demo catalog" : ""}.
      </span>
    </div>
  </section>
);
