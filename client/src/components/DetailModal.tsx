import React, { useState } from "react";
import {
  X,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Copy,
  Check,
  CreditCard,
  Sparkles,
  ShoppingBag,
  RotateCcw,
} from "lucide-react";
import { AuditRecord } from "../types";

interface DetailModalProps {
  record: AuditRecord | null;
  onClose: () => void;
  onConfirmHuman: (id: string) => void;
  onPayWithPayPal: (id: string) => void;
  onAuthorize: (id: string) => void;
  onCapture: (id: string) => void;
  onVoid: (id: string) => void;
  onReconcile: (id: string) => void;
  onDemoOvercharge: (id: string) => void;
  onRefund: (id: string) => void;
}

export const DetailModal: React.FC<DetailModalProps> = ({
  record,
  onClose,
  onConfirmHuman,
  onPayWithPayPal,
  onAuthorize,
  onCapture,
  onVoid,
  onReconcile,
  onDemoOvercharge,
  onRefund,
}) => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"audit" | "paypal" | "json">("audit");

  if (!record) return null;

  const { proposal, decision, status, paypal, reconciliation, demo } = record;

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(record, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden">
        {/* Modal Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-paypal-navy to-paypal-vibrant text-white flex items-center justify-center shadow-md">
              <ShieldCheck className="w-6 h-6 text-paypal-gold" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                  {proposal.id}
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-paypal-vibrant">
                  Expediente de Auditoría
                </span>
              </div>
              <h3 className="text-lg font-extrabold text-slate-900 line-clamp-1">
                {proposal.title}
              </h3>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 px-6 bg-slate-50/50">
          <button
            onClick={() => setActiveTab("audit")}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === "audit"
                ? "border-paypal-vibrant text-paypal-vibrant"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Auditoría Guardian & Reglas</span>
          </button>
          <button
            onClick={() => setActiveTab("paypal")}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === "paypal"
                ? "border-paypal-vibrant text-paypal-vibrant"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <CreditCard className="w-4 h-4" />
            <span>Trazabilidad PayPal & Conciliación</span>
          </button>
          <button
            onClick={() => setActiveTab("json")}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === "json"
                ? "border-paypal-vibrant text-paypal-vibrant"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <span className="font-mono">{`{ }`}</span>
            <span>JSON de Auditoría</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {activeTab === "audit" && (
            <>
              {/* Product Card Details */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-slate-500">Comercio Channel3:</span>
                    <span className="text-xs font-semibold text-slate-800 flex items-center gap-1">
                      <ShoppingBag className="w-3.5 h-3.5 text-indigo-500" />
                      {proposal.seller ?? "channel3.tech"}
                    </span>
                    {proposal.category && (
                      <span className="text-xs text-slate-400">&bull; {proposal.category}</span>
                    )}
                  </div>
                  <div className="text-xl font-black text-slate-900">
                    ${proposal.price.toFixed(2)} {proposal.currency}
                  </div>
                  {proposal.listedPrice && (
                    <div className="text-xs text-slate-500 mt-0.5">
                      Precio verificado en vivo de catálogo:{" "}
                      <strong className="text-emerald-700">${proposal.listedPrice.toFixed(2)}</strong>
                    </div>
                  )}
                </div>

                {proposal.url && (
                  <a
                    href={proposal.url}
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:text-paypal-vibrant hover:border-paypal-vibrant transition-all flex items-center gap-2 shadow-sm"
                  >
                    <span>Ver en Catálogo</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>

              {/* Mandate Buyer Agent Reasoning */}
              {proposal.reasoning && (
                <div className="p-4 rounded-2xl bg-indigo-50/50 border border-indigo-100">
                  <div className="flex items-center gap-2 mb-1.5 text-indigo-900 font-bold text-xs">
                    <Sparkles className="w-4 h-4 text-channel3-accent" />
                    <span>Razonamiento del Agente Comprador (Mandate)</span>
                  </div>
                  <p className="text-xs text-indigo-950/80 leading-relaxed">
                    "{proposal.reasoning}"
                  </p>
                </div>
              )}

              {/* Guardian Deterministic Rules Checklist */}
              {decision && (
                <div>
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">
                    Evaluación de Reglas Deterministas (Guardian)
                  </h4>
                  <div className="space-y-2">
                    {decision.findings.map((f, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded-xl border flex items-start gap-3 ${
                          f.ok ? "bg-emerald-50/60 border-emerald-100" : "bg-rose-50/60 border-rose-100"
                        }`}
                      >
                        {f.ok ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
                        )}
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs font-bold text-slate-800">
                              {f.rule}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                f.ok ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                              }`}
                            >
                              {f.ok ? "SUPERADA" : "FALLIDA"}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 mt-1">{f.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* AI Reviewer Summary */}
                  {decision.explanation && (
                    <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                        Explicación Auditora (Gemini / Reglas):
                      </span>
                      <p className="text-xs font-medium text-slate-800 leading-relaxed">
                        {decision.explanation}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {activeTab === "paypal" && (
            <div className="space-y-6">
              {/* PayPal Sandbox Status Overview */}
              <div className="p-5 rounded-2xl bg-gradient-to-br from-paypal-navy to-paypal-dark text-white shadow-md">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-paypal-gold" />
                    <span className="font-bold text-sm tracking-wide">PayPal Sandbox Transaction</span>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-black bg-paypal-gold text-paypal-navy">
                    {paypal?.intent ?? "CAPTURE"}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="text-slate-300 block text-[11px]">PayPal Order ID:</span>
                    <span className="font-mono font-bold">{paypal?.orderId ?? "Sin orden"}</span>
                  </div>
                  <div>
                    <span className="text-slate-300 block text-[11px]">Capture ID:</span>
                    <span className="font-mono font-bold">{paypal?.captureId ?? "Sin captura"}</span>
                  </div>
                  <div>
                    <span className="text-slate-300 block text-[11px]">Monto Bruto Cobrado:</span>
                    <span className="font-bold text-paypal-gold text-sm">
                      {paypal?.charged !== undefined ? `$${paypal.charged.toFixed(2)} USD` : "No cobrado"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Reconciliation Status */}
              <div className="p-5 rounded-2xl bg-white border border-slate-200">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                  Resultado de Conciliación Posterior al Cobro
                </h4>
                {reconciliation ? (
                  <div
                    className={`p-4 rounded-xl border flex items-start gap-3 ${
                      reconciliation.match ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"
                    }`}
                  >
                    {reconciliation.match ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <span className="font-bold text-xs text-slate-900 block mb-1">
                        {reconciliation.match ? "Conciliación Exitosa (100% Match)" : "Alerta de Discrepancia"}
                      </span>
                      <p className="text-xs text-slate-600">{reconciliation.detail}</p>
                      {demo?.simulated && (
                        <span className="mt-2 inline-block text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                          Simulated Scenario (ENABLE_DEMO_SCENARIO)
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">
                    Aún no se ha ejecutado la conciliación sobre esta transacción.
                  </p>
                )}
              </div>

              {/* Buyer Approval Link */}
              {paypal?.approveUrl && (
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <div className="text-xs text-slate-700">
                    <span className="font-bold block">Enlace de Aprobación del Comprador Sandbox:</span>
                    <span className="font-mono text-[11px] text-slate-500 truncate max-w-md block">
                      {paypal.approveUrl}
                    </span>
                  </div>
                  <a
                    href={paypal.approveUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 rounded-xl bg-paypal-gold hover:bg-paypal-goldHover text-paypal-navy font-bold text-xs shadow-sm transition-all shrink-0 flex items-center gap-1.5"
                  >
                    <span>Abrir Checkout</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
            </div>
          )}

          {activeTab === "json" && (
            <div className="relative">
              <button
                onClick={handleCopyJson}
                className="absolute right-3 top-3 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? "Copiado" : "Copiar JSON"}</span>
              </button>
              <pre className="p-4 rounded-2xl bg-slate-900 text-slate-200 text-xs font-mono overflow-x-auto max-h-[400px]">
                {JSON.stringify(record, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Modal Footer / Contextual Action Bar */}
        <div className="p-5 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Estado actual:</span>
            <span className="font-bold text-xs text-slate-800 uppercase tracking-wide">
              {status}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {status === "awaiting_human" && (
              <button
                onClick={() => {
                  onConfirmHuman(proposal.id);
                  onClose();
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition-all"
              >
                Aprobar como Humano
              </button>
            )}

            {status === "approved" && (
              <button
                onClick={() => {
                  onPayWithPayPal(proposal.id);
                  onClose();
                }}
                className="px-4 py-2 rounded-xl bg-paypal-gold hover:bg-paypal-goldHover text-paypal-navy font-black text-xs shadow-sm transition-all"
              >
                Pagar con PayPal Sandbox
              </button>
            )}

            {status === "awaiting_paypal" && paypal?.orderId && (
              <button
                onClick={() => {
                  const advance = paypal.intent === "AUTHORIZE" ? onAuthorize : onCapture;
                  advance(proposal.id);
                  onClose();
                }}
                className="px-4 py-2 rounded-xl bg-paypal-vibrant hover:bg-paypal-blue text-white font-bold text-xs shadow-sm transition-all"
              >
                {paypal.intent === "AUTHORIZE" ? "Verify & authorize" : "Capture order"}
              </button>
            )}

            {status === "authorized" && (
              <>
                <button
                  onClick={() => {
                    onCapture(proposal.id);
                    onClose();
                  }}
                  className="px-4 py-2 rounded-xl bg-paypal-vibrant hover:bg-paypal-blue text-white font-bold text-xs shadow-sm transition-all"
                >
                  Capturar Fondos
                </button>
                <button
                  onClick={() => {
                    onVoid(proposal.id);
                    onClose();
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs transition-all"
                >
                  Anular Autorización
                </button>
              </>
            )}

            {["captured", "capture_pending", "reconciled"].includes(status) && (
              <>
                {status !== "reconciled" && <button
                  onClick={() => {
                    onReconcile(proposal.id);
                    onClose();
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition-all"
                >
                  {status === "capture_pending" ? "Check capture" : "Reconciliar Captura"}
                </button>}
                {status !== "capture_pending" && <button
                  onClick={() => {
                    onDemoOvercharge(proposal.id);
                    onClose();
                  }}
                  className="px-4 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold text-xs transition-all"
                >
                  Simular Sobrecargo
                </button>}
              </>
            )}

            {((status === "alert" && paypal?.captureStatus === "COMPLETED") || status === "refund_pending") && (
              <button
                onClick={() => {
                  onRefund(proposal.id);
                  onClose();
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-sm transition-all flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{status === "refund_pending" ? "Check refund" : "Emitir Reembolso Completo"}</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-100 transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

