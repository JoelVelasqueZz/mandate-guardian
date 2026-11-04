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
                Configuración de Acceso Sandbox
              </h3>
              <p className="text-xs text-slate-500">Credenciales del entorno PayPal & API</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              DEMO_API_KEY (Token de Autorización de Pagos)
            </label>
            <p className="text-xs text-slate-500 mb-3">
              Requerido por las rutas de pago (<code>/pay</code>, <code>/authorize</code>, <code>/capture</code>, <code>/refund</code>).
              Se envía como <code>Authorization: Bearer &lt;DEMO_API_KEY&gt;</code>.
            </p>
            <div className="relative">
              <input
                type="text"
                value={val}
                onChange={(e) => setVal(e.target.value)}
                placeholder="Ingresa tu DEMO_API_KEY..."
                className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-paypal-vibrant"
              />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-900 space-y-2">
            <div className="flex items-center gap-1.5 font-bold text-paypal-vibrant">
              <ShieldCheck className="w-4 h-4" />
              <span>Seguridad del Frontend</span>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Las credenciales de PayPal (<code>PAYPAL_CLIENT_ID</code> y <code>PAYPAL_CLIENT_SECRET</code>) se mantienen exclusivamente en el servidor backend en <code>.env</code>. La <code>DEMO_API_KEY</code> sirve como llave de guardia para que el frontend invoque las operaciones de sandbox de forma segura.
            </p>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-paypal-vibrant hover:bg-paypal-blue text-white font-bold text-xs shadow-md transition-all flex items-center gap-1.5"
            >
              {saved ? <Check className="w-4 h-4" /> : null}
              <span>{saved ? "Guardado" : "Guardar Clave"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

