import React, { useState } from "react";
import { X, Key, ShieldCheck, Check, AlertCircle } from "lucide-react";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  demoKey: string;
  onSaveDemoKey: (key: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  demoKey,
  onSaveDemoKey,
}) => {
  const [val, setVal] = useState(demoKey);
  const [saved, setSaved] = useState(false);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveDemoKey(val.trim());
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-paypal-navy text-white flex items-center justify-center font-bold">
              <Key className="w-5 h-5 text-paypal-gold" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Payment access
              </h3>
              <p className="text-xs text-slate-500">Demo key for the PayPal Sandbox actions</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              DEMO_API_KEY
            </label>
            <p className="text-xs text-slate-500 mb-3">
              Required by the payment routes (<code>/pay</code>, <code>/authorize</code>, <code>/capture</code>, <code>/refund</code>).
              Enter the value you set in the server's <code>.env</code>. It is sent as <code>Authorization: Bearer &lt;DEMO_API_KEY&gt;</code>
              and kept only in this browser tab's session storage.
            </p>
            <div className="relative">
              <input
                type="password"
                autoComplete="off"
                value={val}
                onChange={(e) => setVal(e.target.value)}
                placeholder="Paste your DEMO_API_KEY"
                className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-paypal-vibrant"
              />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-900 space-y-2">
            <div className="flex items-center gap-1.5 font-bold text-paypal-vibrant">
              <ShieldCheck className="w-4 h-4" />
              <span>Frontend security</span>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              The PayPal credentials (<code>PAYPAL_CLIENT_ID</code> and <code>PAYPAL_CLIENT_SECRET</code>) stay on the server in <code>.env</code> and never reach the browser. The demo key is a shared access key for this demo, not a user login. Do not expose this app publicly with real keys.
            </p>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-paypal-vibrant hover:bg-paypal-blue text-white font-bold text-xs shadow-md transition-all flex items-center gap-1.5"
            >
              {saved ? <Check className="w-4 h-4" /> : null}
              <span>{saved ? "Saved" : "Save key"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

