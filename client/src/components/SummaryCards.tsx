import React from "react";
import { DollarSign, ShieldAlert, CheckCircle, Clock, AlertTriangle, ArrowUpRight, RotateCcw } from "lucide-react";
import { AuditRecord, Mandate } from "../types";

interface SummaryCardsProps {
  records: AuditRecord[];
  activeMandate?: Mandate;
}

export const SummaryCards: React.FC<SummaryCardsProps> = ({ records, activeMandate }) => {
  // Financial metrics
  const monthlyCap = activeMandate?.maxMonthly ?? 400;
  
  // Calculate spent this month from captured or approved records
  const spentThisMonth = records.reduce((acc, r) => {
    if (["approved", "awaiting_paypal", "authorized", "capture_pending", "captured", "reconciled", "alert"].includes(r.status)) {
      return acc + (r.paypal?.charged ?? r.proposal.price);
    }
    return acc;
  }, 0);

  const budgetPercent = Math.min(Math.round((spentThisMonth / monthlyCap) * 100), 100);

  // Status breakdown
  const approvedCount = records.filter(r => ["approved", "authorized", "captured", "reconciled"].includes(r.status)).length;
  const blockedCount = records.filter(r => r.status === "blocked").length;
  const awaitingHumanCount = records.filter(r => r.status === "awaiting_human").length;
  const awaitingPaypalCount = records.filter(r => r.status === "awaiting_paypal").length;
  const alertsCount = records.filter(r => r.status === "alert").length;
  const reconciledCount = records.filter(r => r.status === "reconciled").length;
  const refundedCount = records.filter(r => r.status === "refunded").length;

  return (
    <section aria-label="Métricas y resumen del estado de auditoría" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* 1. Monthly Budget Guardian Cap */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-soft relative overflow-hidden group hover:shadow-card transition-shadow">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Presupuesto Mensual Mandato
          </span>
          <span className="w-8 h-8 rounded-lg bg-blue-100 text-paypal-vibrant flex items-center justify-center font-bold">
            <DollarSign className="w-4 h-4" />
          </span>
        </div>
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-2xl font-black text-slate-950 tracking-tight">
            ${spentThisMonth.toFixed(2)}
          </span>
          <span className="text-xs font-bold text-slate-600">
            / ${monthlyCap.toFixed(2)} USD
          </span>
        </div>
        {/* Progress bar with accessible label */}
        <div
          className="w-full bg-slate-200 rounded-full h-2 overflow-hidden mb-2"
          role="progressbar"
          aria-label="Porcentaje de presupuesto mensual consumido"
          aria-valuenow={budgetPercent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${
              budgetPercent > 90 ? "bg-rose-700" : budgetPercent > 70 ? "bg-amber-600" : "bg-paypal-vibrant"
            }`}
            style={{ width: `${budgetPercent}%` }}
          />
        </div>
        <div className="flex justify-between items-center text-[11px] text-slate-700 font-semibold">
          <span>{budgetPercent}% consumido</span>
          <span className="font-bold text-paypal-vibrant">Tope: ${activeMandate?.maxPerPurchase ?? 75}/compra</span>
        </div>
      </div>

      {/* 2. Guardian Rules Verdicts */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-soft relative overflow-hidden group hover:shadow-card transition-shadow">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Auditoría Guardian
          </span>
          <span className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
            <CheckCircle className="w-4 h-4" />
          </span>
        </div>
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-2xl font-black text-slate-950 tracking-tight">
            {approvedCount}
          </span>
          <span className="text-xs font-bold text-emerald-950 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-300">
            Aprobadas
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-800 mt-3 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-slate-700 font-semibold">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-700" /> Bloqueadas:
            </span>
            <span className="font-extrabold text-slate-950">{blockedCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-slate-700 font-semibold">
              <Clock className="w-3.5 h-3.5 text-amber-700" /> A confirmar:
            </span>
            <span className="font-extrabold text-amber-900">{awaitingHumanCount}</span>
          </div>
        </div>
      </div>

      {/* 3. PayPal Sandbox Pipeline */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-soft relative overflow-hidden group hover:shadow-card transition-shadow">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Pipeline PayPal Sandbox
          </span>
          <span className="w-8 h-8 rounded-lg bg-indigo-100 text-channel3-accent flex items-center justify-center font-bold">
            <ArrowUpRight className="w-4 h-4" />
          </span>
        </div>
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-2xl font-black text-slate-950 tracking-tight">
            {records.filter(r => r.paypal?.orderId).length}
          </span>
          <span className="text-xs font-bold text-indigo-950 bg-indigo-100 px-2 py-0.5 rounded-full border border-indigo-300">
            Órdenes Activas
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-800 mt-3 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <span className="text-slate-700 font-semibold">En Checkout:</span>
            <span className="font-extrabold text-amber-900">{awaitingPaypalCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-700 font-semibold">Capturadas:</span>
            <span className="font-extrabold text-paypal-vibrant">
              {records.filter(r => r.status === "captured" || r.status === "reconciled").length}
            </span>
          </div>
        </div>
      </div>

      {/* 4. Reconciliation & Safety Alerts */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-soft relative overflow-hidden group hover:shadow-card transition-shadow">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Conciliación & Alertas
          </span>
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold ${
            alertsCount > 0 ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"
          }`}>
            {alertsCount > 0 ? <AlertTriangle className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
          </span>
        </div>
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-2xl font-black text-slate-950 tracking-tight">
            {reconciledCount}
          </span>
          <span className="text-xs font-bold text-emerald-950 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-300">
            100% Conciliadas
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-800 mt-3 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-slate-700 font-semibold">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-700" /> Discrepancia:
            </span>
            <span className={`font-extrabold ${alertsCount > 0 ? "text-rose-800" : "text-slate-900"}`}>
              {alertsCount}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-700 font-semibold">Reembolsadas:</span>
            <span className="font-extrabold text-slate-900">{refundedCount}</span>
          </div>
        </div>
      </div>
    </section>
  );
};
