import React, { useState } from "react";
import { X, Plus, ShieldCheck } from "lucide-react";
import { Mandate, Proposal } from "../types";

interface NewProposalModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeMandate?: Mandate;
  onSubmit: (proposal: Omit<Proposal, "id">) => Promise<void>;
}

export const NewProposalModal: React.FC<NewProposalModalProps> = ({
  isOpen,
  onClose,
  activeMandate,
  onSubmit,
}) => {
  const [title, setTitle] = useState("Teclado Mecánico Ergonómico Bluetooth");
  const [price, setPrice] = useState<number>(45.0);
  const [category, setCategory] = useState("Electronics");
  const [seller, setSeller] = useState("keychron-partner.channel3.shop");
  const [reasoning, setReasoning] = useState("Seleccionado por Mandate para setup ergonómico bajo presupuesto.");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || price <= 0 || !activeMandate) return;
    setIsSubmitting(true);
    try {
      await onSubmit({
        mandateId: activeMandate.id,
        title,
        price: Number(price),
        currency: "USD",
        category,
        seller,
        reasoning,
        url: "https://trychannel3.com/products/demo-item",
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-paypal-navy text-white flex items-center justify-center font-bold">
              <ShieldCheck className="w-5 h-5 text-paypal-gold" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Someter Propuesta a Auditoría Guardian
              </h3>
              <p className="text-xs text-slate-500">
                Mandato activo: <strong>{activeMandate?.goal.slice(0, 32)}...</strong>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Título del Producto / Oferta *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-paypal-vibrant"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Precio Propuesto ($ USD) *
              </label>
              <input
                type="number"
                step="0.01"
                required
                min={0.01}
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
                className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-paypal-vibrant"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Categoría
              </label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-paypal-vibrant"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Comercio / Vendedor Channel3
            </label>
            <input
              type="text"
              value={seller}
              onChange={(e) => setSeller(e.target.value)}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-paypal-vibrant"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Razonamiento del Agente Comprador
            </label>
            <textarea
              rows={2}
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value)}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-paypal-vibrant"
            />
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
              disabled={isSubmitting}
              className="px-5 py-2.5 rounded-xl bg-paypal-vibrant hover:bg-paypal-blue text-white font-bold text-xs shadow-md transition-all flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>{isSubmitting ? "Auditando con Guardian..." : "Someter Propuesta"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

