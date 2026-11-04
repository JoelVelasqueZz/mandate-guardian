import React, { useState, useEffect, useCallback, Suspense, lazy } from "react";
import { Navbar } from "./components/Navbar";
import { SummaryCards } from "./components/SummaryCards";
import { MandateSection } from "./components/MandateSection";
import { AuditGrid } from "./components/AuditGrid";
import { AuditRecord, Mandate, Proposal, SystemHealth } from "./types";
import { INITIAL_MANDATES, INITIAL_RECORDS } from "./mockData";
import { api } from "./api";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

// Lazy load modals to optimize initial JavaScript payload and LCP
const DetailModal = lazy(() => import("./components/DetailModal").then((m) => ({ default: m.DetailModal })));
const SettingsModal = lazy(() => import("./components/SettingsModal").then((m) => ({ default: m.SettingsModal })));
const NewProposalModal = lazy(() => import("./components/NewProposalModal").then((m) => ({ default: m.NewProposalModal })));

export const App: React.FC = () => {
  const [isMockMode, setIsMockMode] = useState(() => {
    return !new URLSearchParams(window.location.search).has("checkout") &&
      sessionStorage.getItem("mg_api_mode") !== "true";
  });
  const [records, setRecords] = useState<AuditRecord[]>(isMockMode ? INITIAL_RECORDS : []);
  const [mandates, setMandates] = useState<Mandate[]>(isMockMode ? INITIAL_MANDATES : []);
  const [activeMandate, setActiveMandate] = useState<Mandate | undefined>(mandates[0]);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);

  // Keep the demo key in this tab through the Sandbox redirect.
  const [demoKey, setDemoKey] = useState(() => sessionStorage.getItem("mg_demo_key") ?? "");

  // UI state
  const [selectedRecord, setSelectedRecord] = useState<AuditRecord | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNewProposalOpen, setIsNewProposalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  const showToast = (type: "success" | "error" | "info", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const saveDemoKey = (key: string) => {
    setDemoKey(key);
    sessionStorage.setItem("mg_demo_key", key);
    showToast("success", "Demo API Key actualizada.");
  };

  // Fetch real data when in live API mode
  const fetchLiveData = useCallback(async () => {
    if (isMockMode) return;
    setLoading(true);
    try {
      const [health, recs, savedMandates] = await Promise.all([
        api.getHealth(), api.getRecords(), api.getMandates(),
      ]);
      setSystemHealth(health);
      setRecords(recs);
      setMandates(savedMandates);
      setActiveMandate((previous) => savedMandates.find((mandate) => mandate.id === previous?.id) ?? savedMandates[0]);
      showToast("info", "Datos actualizados desde el backend.");
    } catch {
      showToast("error", "No se pudo sincronizar con el backend.");
    } finally {
      setLoading(false);
    }
  }, [isMockMode]);

  useEffect(() => {
    if (!isMockMode) {
      fetchLiveData();
    }
  }, [isMockMode, fetchLiveData]);

  const changeMode = (mock: boolean) => {
    if (mock === isMockMode || loading) return;
    sessionStorage.setItem("mg_api_mode", String(!mock));
    setSelectedRecord(null);
    setRecords(mock ? INITIAL_RECORDS : []);
    setMandates(mock ? INITIAL_MANDATES : []);
    setActiveMandate(mock ? INITIAL_MANDATES[0] : undefined);
    setSystemHealth(null);
    setIsMockMode(mock);
  };

  const handleResetMocks = () => {
    setRecords(INITIAL_RECORDS);
    setMandates(INITIAL_MANDATES);
    setActiveMandate(INITIAL_MANDATES[0]);
    showToast("info", "Datos falsos restaurados a su estado inicial.");
  };

  // --- ACTIONS ---

  const handleConfirmHuman = async (id: string) => {
    setLoading(true);
    try {
      if (isMockMode) {
        setRecords((prev) =>
          prev.map((r) =>
            r.proposal.id === id ? { ...r, status: "approved", updatedAt: new Date().toISOString() } : r
          )
        );
        showToast("success", "Propuesta aprobada por confirmación humana.");
      } else {
        const updated = await api.confirmHuman(id, demoKey);
        setRecords((prev) => prev.map((r) => (r.proposal.id === id ? updated : r)));
        showToast("success", "Propuesta aprobada en el servidor.");
      }
    } catch (e: any) {
      showToast("error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePayWithPayPal = async (id: string) => {
    setLoading(true);
    try {
      if (isMockMode) {
        setRecords((prev) =>
          prev.map((r) => {
            if (r.proposal.id !== id) return r;
            return {
              ...r,
              status: "awaiting_paypal",
              paypal: {
                ...r.paypal,
                orderId: `SANDBOX-ORD-${Math.floor(100000 + Math.random() * 900000)}`,
                intent: "AUTHORIZE",
              },
              updatedAt: new Date().toISOString(),
            };
          })
        );
        showToast("info", "Simulated checkout created.");
      } else {
        const result = await api.payWithPayPal(id, demoKey);
        setRecords((prev) => prev.map((r) => (r.proposal.id === id ? result.record : r)));
        sessionStorage.setItem("mg_api_mode", "true");
        window.location.assign(result.approveUrl);
      }
    } catch (e: any) {
      showToast("error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAuthorize = async (id: string) => {
    setLoading(true);
    try {
      if (isMockMode) {
        setRecords((prev) =>
          prev.map((r) => {
            if (r.proposal.id !== id) return r;
            return {
              ...r,
              status: "authorized",
              paypal: {
                ...r.paypal,
                authorizationId: `AUTH-${Math.floor(10000 + Math.random() * 90000)}-V1`,
              },
              updatedAt: new Date().toISOString(),
            };
          })
        );
        showToast("success", "Fondos autorizados exitosamente en PayPal Sandbox (Plan A).");
      } else {
        const { order } = await api.getPayPalOrder(id, demoKey);
        if (!["APPROVED", "COMPLETED"].includes(order.status)) {
          showToast("info", "Approve the order in PayPal Sandbox first.");
          return;
        }
        const updated = await api.authorize(id, demoKey);
        setRecords((prev) => prev.map((r) => (r.proposal.id === id ? updated : r)));
        showToast("success", "Orden autorizada en PayPal.");
      }
    } catch (e: any) {
      showToast("error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCapture = async (id: string) => {
    setLoading(true);
    try {
      if (isMockMode) {
        setRecords((prev) =>
          prev.map((r) => {
            if (r.proposal.id !== id) return r;
            return {
              ...r,
              status: "captured",
              paypal: {
                ...r.paypal,
                captureId: `CAP-${Math.floor(10000 + Math.random() * 90000)}-OK`,
                captureStatus: "COMPLETED",
                charged: r.proposal.price,
                chargedCurrency: r.proposal.currency,
                capturedAt: new Date().toISOString(),
              },
              updatedAt: new Date().toISOString(),
            };
          })
        );
        showToast("success", "Pago capturado exitosamente en PayPal Sandbox.");
      } else {
        const updated = await api.capture(id, demoKey);
        setRecords((prev) => prev.map((r) => (r.proposal.id === id ? updated : r)));
        if (updated.status === "capture_pending") showToast("info", "PayPal capture is pending.");
        else if (updated.status === "alert") showToast("error", "PayPal capture needs review.");
        else showToast("success", "Pago capturado.");
      }
    } catch (e: any) {
      showToast("error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVoid = async (id: string) => {
    setLoading(true);
    try {
      if (isMockMode) {
        setRecords((prev) =>
          prev.map((r) =>
            r.proposal.id === id ? { ...r, status: "voided", updatedAt: new Date().toISOString() } : r
          )
        );
        showToast("info", "Autorización anulada (Void). Fondos liberados.");
      } else {
        const updated = await api.voidAuth(id, demoKey);
        setRecords((prev) => prev.map((r) => (r.proposal.id === id ? updated : r)));
        showToast("info", "Autorización anulada.");
      }
    } catch (e: any) {
      showToast("error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReconcile = async (id: string) => {
    setLoading(true);
    try {
      if (isMockMode) {
        setRecords((prev) =>
          prev.map((r) => {
            if (r.proposal.id !== id) return r;
            const charged = r.paypal?.charged ?? r.proposal.price;
            const match = Math.round(charged * 100) === Math.round(r.proposal.price * 100);
            return {
              ...r,
              status: match ? "reconciled" : "alert",
              reconciliation: {
                match,
                detail: match
                  ? `Monto capturado ($${charged.toFixed(2)} USD) coincide 1:1 con la propuesta aprobada.`
                  : `Discrepancia detectada: capturado $${charged.toFixed(2)} vs aprobado $${r.proposal.price.toFixed(2)}.`,
                source: "simulated",
              },
              updatedAt: new Date().toISOString(),
            };
          })
        );
        showToast("success", "Simulated capture reconciled.");
      } else {
        const updated = await api.reconcile(id, demoKey);
        setRecords((prev) => prev.map((r) => (r.proposal.id === id ? updated : r)));
        if (updated.status === "capture_pending") showToast("info", "PayPal capture is still pending.");
        else if (updated.status === "alert") showToast("error", "The captured amount or currency differs.");
        else showToast("success", "Conciliación realizada.");
      }
    } catch (e: any) {
      showToast("error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDemoOvercharge = async (id: string) => {
    setLoading(true);
    try {
      const rec = records.find((r) => r.proposal.id === id);
      const originalPrice = rec ? rec.proposal.price : 25;
      const overcharged = Number((originalPrice + 8.5).toFixed(2));

      if (isMockMode) {
        setRecords((prev) =>
          prev.map((r) => {
            if (r.proposal.id !== id) return r;
            return {
              ...r,
              status: "alert",
              demo: { simulated: true, charged: overcharged },
              reconciliation: {
                match: false,
                detail: `SIMULATED OVERCHARGE: The simulated charge is $${overcharged.toFixed(2)} USD pero el precio autorizado era $${r.proposal.price.toFixed(2)} USD (Exceso: +$${(overcharged - r.proposal.price).toFixed(2)}).`,
                source: "simulated",
              },
              updatedAt: new Date().toISOString(),
            };
          })
        );
        showToast("error", "Alerta activada: Discrepancia de sobrecargo simulado.");
      } else {
        const updated = await api.demoOvercharge(id, overcharged, demoKey);
        setRecords((prev) => prev.map((r) => (r.proposal.id === id ? updated : r)));
        showToast("error", "Sobrecargo simulado registrado en backend.");
      }
    } catch (e: any) {
      showToast("error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRefund = async (id: string) => {
    const record = records.find((row) => row.proposal.id === id);
    if (!record) return;
    if (record.status !== "refund_pending" && !window.confirm(
      `Refund the full captured amount (${record.paypal?.charged?.toFixed(2) ?? "unknown"} ${record.paypal?.chargedCurrency ?? record.proposal.currency})?`,
    )) return;
    setLoading(true);
    try {
      if (isMockMode) {
        setRecords((prev) =>
          prev.map((r) => {
            if (r.proposal.id !== id) return r;
            return {
              ...r,
              status: "refunded",
              paypal: {
                ...r.paypal,
                refundId: `REF-${Math.floor(10000 + Math.random() * 90000)}-COMPLETED`,
                refundStatus: "COMPLETED",
              },
              reconciliation: {
                match: true,
                detail: "Reembolso total completado y verificado en PayPal Sandbox.",
                source: "paypal_capture",
              },
              updatedAt: new Date().toISOString(),
            };
          })
        );
        showToast("success", "Reembolso completo procesado exitosamente.");
      } else {
        const updated = await api.refund(id, demoKey);
        setRecords((prev) => prev.map((r) => (r.proposal.id === id ? updated : r)));
        if (updated.status === "refund_pending") showToast("info", "PayPal refund is pending.");
        else if (updated.status === "refunded") showToast("success", "PayPal refund completed.");
        else showToast("error", "PayPal refund needs review.");
      }
    } catch (e: any) {
      showToast("error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateMandate = async (data: Omit<Mandate, "id">) => {
    setLoading(true);
    try {
      if (isMockMode) {
        const newMandate: Mandate = {
          ...data,
          id: `mandate-custom-${Date.now()}`,
        };
        setMandates((prev) => [newMandate, ...prev]);
        setActiveMandate(newMandate);
        showToast("success", "Nuevo mandato registrado.");
      } else {
        const created = await api.createMandate(data);
        setMandates((prev) => [created, ...prev]);
        setActiveMandate(created);
        showToast("success", "Mandato guardado en el servidor.");
      }
    } catch (e: any) {
      showToast("error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRunShop = async (mandateId: string, query?: string) => {
    setLoading(true);
    try {
      if (isMockMode) {
        // Realistic simulation of Mandate agent searching Channel3 and Guardian auditing
        const mockCatalogItem = {
          title: query || "Audífonos Inalámbricos Bluetooth con Cancelación de Ruido Activa",
          price: 38.0,
          seller: "audio-plus.channel3.shop",
          category: "Electronics",
          url: "https://trychannel3.com/products/c3-audio-plus",
        };
        const newRecord: AuditRecord = {
          proposal: {
            id: `prop-${Math.floor(1000 + Math.random() * 9000)}`,
            mandateId,
            productId: `c3-${Date.now()}`,
            title: mockCatalogItem.title,
            seller: mockCatalogItem.seller,
            category: mockCatalogItem.category,
            price: mockCatalogItem.price,
            listedPrice: mockCatalogItem.price,
            currency: "USD",
            estimatedDelivery: "2026-11-24",
            url: mockCatalogItem.url,
            reasoning: `Buscado por Mandate en Channel3 con query: "${query || activeMandate?.goal}". Cumple reglas de precio y stock.`,
          },
          decision: {
            proposalId: "",
            verdict: "approve",
            findings: [
              { rule: "currency", ok: true, detail: "Moneda USD válida." },
              { rule: "per_purchase_cap", ok: true, detail: `$38.00 está dentro del límite de $${activeMandate?.maxPerPurchase ?? 75}.00.` },
              { rule: "price_matches_listing", ok: true, detail: "El precio coincide exactamente con Channel3 ($38.00)." },
            ],
            explanation: "Aprobado por el Auditor Guardian. Cumple todas las reglas deterministas.",
          },
          status: "approved",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        newRecord.decision!.proposalId = newRecord.proposal.id;
        setRecords((prev) => [newRecord, ...prev]);
        showToast("success", "El Agente Mandate encontró una oferta en Channel3 y Guardian la aprobó.");
      } else {
        const res = await api.runShop(mandateId, query);
        if (res.record) {
          setRecords((prev) => [res.record!, ...prev]);
          showToast("success", "Propuesta generada por Mandate y auditada por Guardian.");
        } else {
          showToast("info", "Mandate ejecutó la búsqueda pero no se generó propuesta.");
        }
      }
    } catch (e: any) {
      showToast("error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleParseNaturalLanguage = async (text: string): Promise<Partial<Mandate> | null> => {
    try {
      if (isMockMode) {
        return {
          goal: text,
          currency: "USD",
          maxPerPurchase: 40,
          maxMonthly: 120,
          requireHumanAbove: 30,
          deliverBy: "2026-11-20",
          allowedCategories: ["Gifts", "Home & Kitchen", "Fashion"],
        };
      } else {
        const res = await api.parseMandate(text);
        return res.mandate || null;
      }
    } catch (e: any) {
      showToast("error", e.message);
      return null;
    }
  };

  const handleSubmitNewProposal = async (proposalData: Omit<Proposal, "id">) => {
    setLoading(true);
    try {
      if (isMockMode && activeMandate) {
        const id = `prop-${Math.floor(1000 + Math.random() * 9000)}`;
        const mandate = activeMandate;
        const perCapOk = proposalData.price <= mandate.maxPerPurchase;
        const verdict = !perCapOk ? "block" : (mandate.requireHumanAbove && proposalData.price > mandate.requireHumanAbove ? "ask_human" : "approve");
        const status = verdict === "approve" ? "approved" : verdict === "block" ? "blocked" : "awaiting_human";

        const newRec: AuditRecord = {
          proposal: {
            ...proposalData,
            id,
            listedPrice: proposalData.price,
          },
          decision: {
            proposalId: id,
            verdict,
            findings: [
              { rule: "currency", ok: true, detail: "USD." },
              {
                rule: "per_purchase_cap",
                ok: perCapOk,
                detail: perCapOk
                  ? `$${proposalData.price} está dentro del tope de $${mandate.maxPerPurchase}.`
                  : `Precio de $${proposalData.price} excede el tope de $${mandate.maxPerPurchase}.`,
              },
            ],
            explanation: verdict === "approve"
              ? "Propuesta aprobada por Guardian."
              : verdict === "block"
                ? "Bloqueado por violar topes del mandato."
                : "Requiere confirmación humana por umbral de valor.",
          },
          status,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        setRecords((prev) => [newRec, ...prev]);
        showToast("success", `Propuesta auditada por Guardian: Veredicto [${verdict.toUpperCase()}].`);
      } else {
        const rec = await api.submitProposal(proposalData);
        setRecords((prev) => [rec, ...prev]);
        showToast("success", "Propuesta sometida y evaluada por Guardian.");
      }
    } catch (e: any) {
      showToast("error", e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col font-sans">
      {/* Top Toast Alerts */}
      {toast && (
        <div role="status" aria-live="polite" className="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-elevated text-xs font-bold transition-all animate-in slide-in-from-top-3 bg-white border border-slate-300">
          {toast.type === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-700" />}
          {toast.type === "error" && <AlertCircle className="w-4 h-4 text-rose-700" />}
          {toast.type === "info" && <Info className="w-4 h-4 text-paypal-vibrant" />}
          <span className="text-slate-900">{toast.message}</span>
          <button onClick={() => setToast(null)} aria-label="Cerrar notificación" className="ml-2 text-slate-500 hover:text-slate-800">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Navbar with brand identity & toggles */}
      <Navbar
        isMockMode={isMockMode}
        setIsMockMode={changeMode}
        systemHealth={systemHealth}
        demoKey={demoKey}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onRefresh={fetchLiveData}
        onResetMocks={handleResetMocks}
        loading={loading}
      />

      {/* Main Container */}
      <main className="max-w-[1720px] mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full">
        {/* KPI Summary Cards */}
        <SummaryCards records={records} activeMandate={activeMandate} />

        {/* Active Mandate Rules & Shopping Agent Runner */}
        <MandateSection
          mandates={mandates}
          activeMandate={activeMandate}
          onSelectMandate={setActiveMandate}
          onCreateMandate={handleCreateMandate}
          onRunShop={handleRunShop}
          onParseNaturalLanguage={handleParseNaturalLanguage}
          isMockMode={isMockMode}
          loading={loading}
        />

        {/* Core Component: AG Grid Audit Dashboard Table */}
        <AuditGrid
          records={records}
          onSelectRecord={setSelectedRecord}
          onOpenNewProposal={() => activeMandate
            ? setIsNewProposalOpen(true)
            : showToast("info", "Create a mandate before submitting a proposal.")}
          onConfirmHuman={handleConfirmHuman}
          onPayWithPayPal={handlePayWithPayPal}
          onAuthorize={handleAuthorize}
          onCapture={handleCapture}
          onVoid={handleVoid}
          onReconcile={handleReconcile}
          onDemoOvercharge={handleDemoOvercharge}
          onRefund={handleRefund}
          isMockMode={isMockMode}
        />
      </main>

      {/* Footer */}
      <footer className="mt-auto py-5 border-t border-slate-200 bg-white text-xs text-slate-600">
        <div className="max-w-[1720px] mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900">Mandate & Guardian</span>
            <span aria-hidden="true">&bull;</span>
            <span>PayPal AI Hackathon 2026</span>
            <span aria-hidden="true">&bull;</span>
            <span className="text-slate-600">Powered by PayPal Sandbox & Channel3 API</span>
          </div>
          <div className="flex items-center gap-3 text-slate-600 font-medium">
            <span>The agent that spends is not the one that watches.</span>
          </div>
        </div>
      </footer>

      {/* Modals wrapped in Suspense for optimal lazy loading */}
      <Suspense fallback={null}>
        {selectedRecord && (
          <DetailModal
            record={selectedRecord}
            onClose={() => setSelectedRecord(null)}
            onConfirmHuman={handleConfirmHuman}
            onPayWithPayPal={handlePayWithPayPal}
            onAuthorize={handleAuthorize}
            onCapture={handleCapture}
            onVoid={handleVoid}
            onReconcile={handleReconcile}
            onDemoOvercharge={handleDemoOvercharge}
            onRefund={handleRefund}
          />
        )}

        {isSettingsOpen && (
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            demoKey={demoKey}
            onSaveDemoKey={saveDemoKey}
          />
        )}

        {isNewProposalOpen && (
          <NewProposalModal
            isOpen={isNewProposalOpen}
            onClose={() => setIsNewProposalOpen(false)}
            activeMandate={activeMandate}
            isMockMode={isMockMode}
            onSubmit={handleSubmitNewProposal}
          />
        )}
      </Suspense>
    </div>
  );
};
