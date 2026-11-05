import React, { useState, useEffect, useCallback, Suspense, lazy } from "react";
import { Navbar } from "./components/Navbar";
import { SummaryCards } from "./components/SummaryCards";
import { MandateSection } from "./components/MandateSection";
import { AuditGrid } from "./components/AuditGrid";
import { AuditRecord, Mandate, SystemHealth } from "./types";
import { api } from "./api";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

// Lazy load modals to keep the initial JavaScript payload small
const DetailModal = lazy(() => import("./components/DetailModal").then((m) => ({ default: m.DetailModal })));
const SettingsModal = lazy(() => import("./components/SettingsModal").then((m) => ({ default: m.SettingsModal })));

const DEMO_KEY_STORAGE = "mg_demo_key";

/** The demo key is typed by the operator and kept only in this browser tab's session. */
function loadDemoKey(): string {
  try {
    return sessionStorage.getItem(DEMO_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export const App: React.FC = () => {
  // All data comes from the backend. Nothing here is simulated.
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [activeMandate, setActiveMandate] = useState<Mandate | undefined>(undefined);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [demoKey, setDemoKey] = useState<string>(loadDemoKey);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  const showToast = (type: "success" | "error" | "info", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const saveDemoKey = (key: string) => {
    setDemoKey(key);
    try {
      if (key) sessionStorage.setItem(DEMO_KEY_STORAGE, key);
      else sessionStorage.removeItem(DEMO_KEY_STORAGE);
    } catch {
      // Storage can be blocked; the key then lives only in memory.
    }
    showToast("success", key ? "Demo key saved for this browser session." : "Demo key cleared.");
  };

  const refresh = useCallback(async (quiet = false) => {
    setLoading(true);
    try {
      const [health, recs] = await Promise.all([api.getHealth(), api.getRecords()]);
      setSystemHealth(health);
      setRecords(recs);
      if (!quiet) showToast("info", "Data refreshed from the server.");
    } catch {
      setSystemHealth(null);
      showToast("error", "Could not reach the server. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh(true);
  }, [refresh]);

  const selectedRecord = records.find((r) => r.proposal.id === selectedId) ?? null;

  const replaceRecord = (updated: AuditRecord) =>
    setRecords((prev) => prev.map((r) => (r.proposal.id === updated.proposal.id ? updated : r)));

  /** Runs one server action, shows the outcome and keeps the loading flag honest. */
  const act = async (run: () => Promise<void>) => {
    setLoading(true);
    try {
      await run();
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const needsKey = () => {
    if (demoKey) return false;
    showToast("error", "Payment actions need the demo key. Open Settings and enter your DEMO_API_KEY.");
    setIsSettingsOpen(true);
    return true;
  };

  const handleConfirmHuman = (id: string) =>
    act(async () => {
      replaceRecord(await api.confirmHuman(id));
      showToast("success", "Proposal confirmed by a human.");
    });

  const handlePayWithPayPal = (id: string) => {
    if (needsKey()) return;
    return act(async () => {
      const result = await api.payWithPayPal(id, demoKey);
      replaceRecord(result.record);
      showToast("info", "PayPal Sandbox order created. Approve it as the buyer in the new tab.");
      if (result.approveUrl) window.open(result.approveUrl, "_blank", "noopener");
    });
  };

  const handleAuthorize = (id: string) => {
    if (needsKey()) return;
    return act(async () => {
      replaceRecord(await api.authorize(id, demoKey));
      showToast("success", "Order authorized in PayPal Sandbox.");
    });
  };

  const handleCapture = (id: string) => {
    if (needsKey()) return;
    return act(async () => {
      replaceRecord(await api.capture(id, demoKey));
      showToast("success", "Payment captured in PayPal Sandbox.");
    });
  };

  const handleVoid = (id: string) => {
    if (needsKey()) return;
    return act(async () => {
      replaceRecord(await api.voidAuth(id, demoKey));
      showToast("info", "Authorization voided.");
    });
  };

  const handleReconcile = (id: string) => {
    if (needsKey()) return;
    return act(async () => {
      replaceRecord(await api.reconcile(id, demoKey));
      showToast("success", "Reconciled against the PayPal capture.");
    });
  };

  const handleDemoOvercharge = (id: string) => {
    if (needsKey()) return;
    const rec = records.find((r) => r.proposal.id === id);
    if (!rec) return;
    const overcharged = Number((rec.proposal.price + 8.5).toFixed(2));
    return act(async () => {
      replaceRecord(await api.demoOvercharge(id, overcharged, demoKey));
      showToast("error", "Simulated overcharge recorded (clearly labeled as a simulation).");
    });
  };

  const handleRefund = (id: string) => {
    if (needsKey()) return;
    return act(async () => {
      replaceRecord(await api.refund(id, demoKey));
      showToast("success", "Refund processed in PayPal Sandbox.");
    });
  };

  const handleCreateMandate = (data: Omit<Mandate, "id">) =>
    act(async () => {
      const created = await api.createMandate(data);
      setMandates((prev) => [created, ...prev]);
      setActiveMandate(created);
      showToast("success", "Mandate saved on the server.");
    });

  const handleRunShop = (mandateId: string, query?: string) =>
    act(async () => {
      const res = await api.runShop(mandateId, query);
      if (res.record) {
        setRecords((prev) => [res.record!, ...prev]);
        showToast("success", "Mandate proposed a purchase and Guardian reviewed it.");
      } else {
        showToast("info", "Mandate searched but found nothing to propose.");
      }
    });

  const handleParseNaturalLanguage = async (text: string): Promise<Partial<Mandate> | null> => {
    try {
      const res = await api.parseMandate(text);
      if (res.questions && res.questions.length > 0) showToast("info", res.questions.join(" "));
      return res.draft ?? null;
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Could not read the mandate.");
      return null;
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col font-sans">
      {toast && (
        <div role="status" aria-live="polite" className="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-elevated text-xs font-bold transition-all animate-in slide-in-from-top-3 bg-white border border-slate-300">
          {toast.type === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-700" />}
          {toast.type === "error" && <AlertCircle className="w-4 h-4 text-rose-700" />}
          {toast.type === "info" && <Info className="w-4 h-4 text-paypal-vibrant" />}
          <span className="text-slate-900">{toast.message}</span>
          <button onClick={() => setToast(null)} aria-label="Close notification" className="ml-2 text-slate-500 hover:text-slate-800">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <Navbar
        systemHealth={systemHealth}
        demoKey={demoKey}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onRefresh={() => refresh()}
        loading={loading}
      />

      <main className="max-w-[1720px] mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full">
        <SummaryCards records={records} activeMandate={activeMandate} />

        <MandateSection
          mandates={mandates}
          activeMandate={activeMandate}
          onSelectMandate={setActiveMandate}
          onCreateMandate={handleCreateMandate}
          onRunShop={handleRunShop}
          onParseNaturalLanguage={handleParseNaturalLanguage}
          aiAvailable={Boolean(systemHealth?.ai)}
          loading={loading}
        />

        <AuditGrid
          records={records}
          onSelectRecord={(r) => setSelectedId(r.proposal.id)}
          onConfirmHuman={handleConfirmHuman}
          onPayWithPayPal={handlePayWithPayPal}
          onAuthorize={handleAuthorize}
          onCapture={handleCapture}
          onVoid={handleVoid}
          onReconcile={handleReconcile}
          onDemoOvercharge={handleDemoOvercharge}
          onRefund={handleRefund}
        />
      </main>

      <footer className="mt-auto py-5 border-t border-slate-200 bg-white text-xs text-slate-600">
        <div className="max-w-[1720px] mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900">Mandate & Guardian</span>
            <span aria-hidden="true">&bull;</span>
            <span>PayPal AI Hackathon 2026</span>
            <span aria-hidden="true">&bull;</span>
            <span className="text-slate-600">PayPal Sandbox payments. Product data from {systemHealth?.catalog === "channel3" ? "Channel3" : "a labeled offline demo catalog"}.</span>
          </div>
          <div className="flex items-center gap-3 text-slate-600 font-medium">
            <span>The agent that spends is not the one that watches.</span>
          </div>
        </div>
      </footer>

      <Suspense fallback={null}>
        {selectedRecord && (
          <DetailModal
            record={selectedRecord}
            onClose={() => setSelectedId(null)}
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
      </Suspense>
    </div>
  );
};
