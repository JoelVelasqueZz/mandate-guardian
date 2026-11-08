import React, { useMemo, useState, useRef, useCallback } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  ColDef,
  ICellRendererParams,
  themeQuartz,
} from "ag-grid-community";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Clock,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  ExternalLink,
  CreditCard,
  Eye,
  Search,
  Download,
  Copy,
  Check,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import { AuditRecord, PaymentStatus } from "../types";

// Register all AG Grid Community modules
ModuleRegistry.registerModules([AllCommunityModule]);

// Customized native AG Grid Theme (eliminates error #239 and legacy CSS weight)
const guardianTheme = themeQuartz.withParams({
  fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif',
  fontSize: 13,
  headerBackgroundColor: '#F8FAFC',
  headerTextColor: '#0F172A',
  borderColor: '#E2E8F0',
  rowHoverColor: '#F8FAFF',
  selectedRowBackgroundColor: '#EEF6FF',
  accentColor: '#0070BA',
});

interface AuditGridProps {
  records: AuditRecord[];
  onSelectRecord: (record: AuditRecord) => void;
  onConfirmHuman: (id: string) => void;
  onPayWithPayPal: (id: string) => void;
  onAuthorize: (id: string) => void;
  onCapture: (id: string) => void;
  onVoid: (id: string) => void;
  onReconcile: (id: string) => void;
  onDemoOvercharge: (id: string) => void;
  onRefund: (id: string) => void;
}

export const AuditGrid: React.FC<AuditGridProps> = ({
  records,
  onSelectRecord,
  onConfirmHuman,
  onPayWithPayPal,
  onAuthorize,
  onCapture,
  onVoid,
  onReconcile,
  onDemoOvercharge,
  onRefund,
}) => {
  const gridRef = useRef<AgGridReact<AuditRecord>>(null);
  const [quickFilterText, setQuickFilterText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "action" | "paid" | "alerts">("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filtered rows for tabs
  const filteredData = useMemo(() => {
    if (statusFilter === "action") {
      return records.filter((r) => ["awaiting_human", "awaiting_paypal", "capture_pending", "refund_pending"].includes(r.status));
    }
    if (statusFilter === "paid") {
      return records.filter((r) => ["approved", "authorized", "captured", "reconciled"].includes(r.status));
    }
    if (statusFilter === "alerts") {
      return records.filter((r) => ["blocked", "alert", "refunded"].includes(r.status));
    }
    return records;
  }, [records, statusFilter]);

  const onExportCsv = useCallback(() => {
    gridRef.current?.api.exportDataAsCsv({
      fileName: `mandate-guardian-audit-${new Date().toISOString().slice(0, 10)}.csv`,
    });
  }, []);

  // AG Grid Column Definitions
  const columnDefs = useMemo<ColDef<AuditRecord>[]>(() => {
    return [
      {
        headerName: "Proposal ID",
        field: "proposal.id",
        width: 135,
        pinned: "left",
        cellRenderer: (params: ICellRendererParams<AuditRecord>) => {
          const id = params.data?.proposal.id ?? "";
          const shortId = id.length > 12 ? `${id.slice(0, 10)}...` : id;
          const isCopied = copiedId === id;
          return (
            <div className="flex items-center gap-1.5 font-mono text-xs text-slate-700">
              <span className="font-semibold text-slate-900" title={id}>{shortId}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  copyToClipboard(id);
                }}
                className="text-slate-500 hover:text-paypal-vibrant p-1 rounded transition-colors"
                title={`Copy full ID: ${id}`}
                aria-label={`Copy the full proposal ID ${id}`}
              >
                {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          );
        },
      },
      {
        headerName: "Product and merchant",
        field: "proposal.title",
        minWidth: 280,
        flex: 2,
        cellRenderer: (params: ICellRendererParams<AuditRecord>) => {
          const p = params.data?.proposal;
          if (!p) return null;
          return (
            <div className="flex flex-col justify-center py-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 text-xs hover:text-paypal-vibrant transition-colors line-clamp-1" title={p.title}>
                  {p.title}
                </span>
                {p.url && (
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-slate-500 hover:text-channel3-accent shrink-0 p-0.5"
                    title={`Open ${p.title} at the merchant`}
                    aria-label={`Open the listing for ${p.title}`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-600 mt-0.5">
                <span className="inline-flex items-center gap-1 font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                  <ShoppingBag className="w-3 h-3 text-indigo-600" />
                  {p.seller ?? "Unknown merchant"}
                </span>
                {p.category && (
                  <span className="text-slate-600">&bull; {p.category}</span>
                )}
              </div>
            </div>
          );
        },
      },
      {
        headerName: "Price and verification",
        field: "proposal.price",
        width: 165,
        cellRenderer: (params: ICellRendererParams<AuditRecord>) => {
          const p = params.data?.proposal;
          if (!p) return null;
          const matchListing = p.listedPrice !== undefined && Math.round(p.listedPrice * 100) === Math.round(p.price * 100);
          return (
            <div className="flex flex-col justify-center py-1">
              <span className="font-extrabold text-xs text-slate-900">
                ${p.price.toFixed(2)} {p.currency}
              </span>
              {p.listedPrice !== undefined && (
                <span
                  className={`text-[11px] font-bold inline-flex items-center gap-1 ${
                    matchListing ? "text-emerald-800" : "text-rose-800"
                  }`}
                  title={matchListing ? "The proposed price matches the price the server read from the catalog" : "The proposed price differs from the catalog price"}
                >
                  {matchListing ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                  <span>Listed: ${p.listedPrice.toFixed(2)}</span>
                </span>
              )}
            </div>
          );
        },
      },
      {
        headerName: "Status",
        field: "status",
        width: 180,
        cellRenderer: (params: ICellRendererParams<AuditRecord>) => {
          const status = params.data?.status as PaymentStatus;
          const badges: Record<PaymentStatus, { label: string; bg: string; text: string; border: string; icon: any }> = {
            approved: { label: "Approved", bg: "bg-emerald-100/90", text: "text-emerald-950", border: "border-emerald-300", icon: ShieldCheck },
            reconciled: { label: "Reconciled", bg: "bg-emerald-100", text: "text-emerald-950", border: "border-emerald-400", icon: CheckCircle2 },
            captured: { label: "Captured", bg: "bg-blue-100", text: "text-blue-950", border: "border-blue-300", icon: Check },
            authorized: { label: "Authorized", bg: "bg-indigo-100", text: "text-indigo-950", border: "border-indigo-300", icon: CreditCard },
            awaiting_paypal: { label: "Awaiting buyer approval", bg: "bg-amber-100", text: "text-amber-950", border: "border-amber-300", icon: Clock },
            awaiting_human: { label: "Needs a human", bg: "bg-orange-100", text: "text-orange-950", border: "border-orange-300", icon: Clock },
            blocked: { label: "Blocked", bg: "bg-rose-100", text: "text-rose-950", border: "border-rose-300", icon: ShieldX },
            alert: { label: "Mismatch alert", bg: "bg-rose-200", text: "text-rose-950", border: "border-rose-400", icon: AlertTriangle },
            refunded: { label: "Refunded", bg: "bg-slate-200", text: "text-slate-900", border: "border-slate-400", icon: RotateCcw },
            capture_pending: { label: "Capture pending", bg: "bg-amber-100", text: "text-amber-950", border: "border-amber-300", icon: Clock },
            refund_pending: { label: "Refund pending", bg: "bg-amber-100", text: "text-amber-950", border: "border-amber-300", icon: Clock },
            voided: { label: "Voided", bg: "bg-slate-200", text: "text-slate-800", border: "border-slate-300", icon: RotateCcw },
            proposed: { label: "Proposed", bg: "bg-slate-100", text: "text-slate-800", border: "border-slate-300", icon: Clock },
          };
          const b = badges[status] || badges.proposed;
          const Icon = b.icon;
          return (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${b.bg} ${b.text} ${b.border}`}>
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{b.label}</span>
            </span>
          );
        },
      },
      {
        headerName: "Guardian verdict",
        field: "decision.verdict",
        width: 195,
        cellRenderer: (params: ICellRendererParams<AuditRecord>) => {
          const d = params.data?.decision;
          if (!d) return <span className="text-slate-500 text-xs">Not reviewed</span>;
          const passedRules = d.findings.filter((f) => f.ok).length;
          const totalRules = d.findings.length;
          // The Guardian asked a person and the person said yes: show that, not the original question.
          const humanApproved = d.verdict === "ask_human" && !["awaiting_human", "blocked"].includes(params.data?.status ?? "");
          return (
            <div className="flex flex-col justify-center py-1">
              <div className="flex items-center gap-1.5">
                {d.verdict === "approve" && (
                  <span className="flex items-center gap-1 text-emerald-800 font-bold text-xs">
                    <ShieldCheck className="w-3.5 h-3.5" /> Approved
                  </span>
                )}
                {d.verdict === "block" && (
                  <span className="flex items-center gap-1 text-rose-800 font-bold text-xs">
                    <ShieldX className="w-3.5 h-3.5" /> Blocked
                  </span>
                )}
                {d.verdict === "ask_human" && (
                  <span className="flex items-center gap-1 text-amber-900 font-bold text-xs">
                    <ShieldAlert className="w-3.5 h-3.5" /> {humanApproved ? "Human approved" : "Ask a human"}
                  </span>
                )}
                <span className="text-[11px] text-slate-600 font-bold">
                  ({passedRules}/{totalRules} rules)
                </span>
              </div>
              {d.explanation && (
                <span className="text-[11px] text-slate-600 truncate flex items-center gap-1 mt-0.5" title={d.explanation}>
                  <Sparkles className="w-3 h-3 text-indigo-600 shrink-0" />
                  <span className="truncate">{d.explanation}</span>
                </span>
              )}
            </div>
          );
        },
      },
      {
        headerName: "PayPal order",
        field: "paypal.orderId",
        width: 175,
        cellRenderer: (params: ICellRendererParams<AuditRecord>) => {
          const pp = params.data?.paypal;
          if (!pp?.orderId) {
            return <span className="text-slate-500 text-xs font-semibold">Not started</span>;
          }
          return (
            <div className="flex flex-col justify-center py-1 font-mono text-[11px]">
              <div className="flex items-center gap-1 text-slate-900 font-bold">
                <span className="truncate" title={pp.orderId}>{pp.orderId.slice(0, 14)}...</span>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-slate-600">
                <span className="px-1.5 py-0.2 rounded bg-slate-200/90 font-sans font-bold text-slate-800">
                  {pp.intent ?? "CAPTURE"}
                </span>
                {pp.charged !== undefined && (
                  <span className="font-sans font-bold text-paypal-vibrant">
                    Charged: ${pp.charged.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          );
        },
      },
      {
        headerName: "Reconciliation",
        field: "reconciliation.detail",
        minWidth: 195,
        flex: 1,
        cellRenderer: (params: ICellRendererParams<AuditRecord>) => {
          const r = params.data?.reconciliation;
          const demo = params.data?.demo;
          if (!r) {
            return <span className="text-slate-500 text-xs font-medium">Not reconciled yet</span>;
          }
          return (
            <div className="flex items-center gap-1.5 py-1">
              {r.match ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-950 bg-emerald-100 px-2.5 py-0.5 rounded-full border border-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Exact match</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-950 bg-rose-100 px-2.5 py-0.5 rounded-full border border-rose-300" title={r.detail}>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>{demo ? "Simulated overcharge" : "Mismatch"}</span>
                </span>
              )}
            </div>
          );
        },
      },
      {
        headerName: "Actions",
        width: 235,
        pinned: "right",
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams<AuditRecord>) => {
          const record = params.data;
          if (!record) return null;
          const s = record.status;

          return (
            <div className="flex items-center gap-1.5 py-1">
              {/* Contextual actions */}
              {s === "awaiting_human" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onConfirmHuman(record.proposal.id);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[11px] shadow-sm transition-all"
                  title="Approve this proposal as a human"
                  aria-label={`Approve ${record.proposal.title} as a human`}
                >
                  Approve
                </button>
              )}

              {s === "approved" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onPayWithPayPal(record.proposal.id);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-paypal-gold hover:bg-paypal-goldHover text-slate-950 font-black text-[11px] shadow-sm transition-all flex items-center gap-1 border border-amber-300"
                  title="Create the PayPal Sandbox order and open the buyer approval page"
                  aria-label={`Pay for ${record.proposal.title} with PayPal Sandbox`}
                >
                  <span>Pay with PayPal</span>
                </button>
              )}

              {s === "awaiting_paypal" && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onPayWithPayPal(record.proposal.id);
                    }}
                    className="px-2 py-1 rounded-lg bg-paypal-gold hover:bg-paypal-goldHover text-slate-950 font-bold text-[11px] shadow-sm transition-all"
                    title="Open the PayPal Sandbox checkout again"
                    aria-label={`Open the PayPal checkout for ${record.proposal.title}`}
                  >
                    Open checkout
                  </button>
                  {record.paypal?.orderId && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const advance = record.paypal?.intent === "AUTHORIZE" ? onAuthorize : onCapture;
                        advance(record.proposal.id);
                      }}
                      className="px-2 py-1 rounded-lg bg-paypal-vibrant hover:bg-paypal-blue text-white font-bold text-[11px] shadow-sm transition-all"
                      title="Check that the buyer approved the order, then continue"
                    >
                      {record.paypal.intent === "AUTHORIZE" ? "Verify & authorize" : "Capture order"}
                    </button>
                  )}
                </>
              )}

              {s === "authorized" && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCapture(record.proposal.id);
                    }}
                    className="px-2 py-1 rounded-lg bg-paypal-vibrant hover:bg-paypal-blue text-white font-bold text-[11px] shadow-sm transition-all"
                    title="Capture the authorized funds"
                    aria-label={`Capture the authorized funds for ${record.proposal.title}`}
                  >
                    Capture
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onVoid(record.proposal.id);
                    }}
                    className="px-2 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-900 font-bold text-[11px] transition-all"
                    title="Void the authorization"
                    aria-label={`Void the authorization for ${record.proposal.title}`}
                  >
                    Void
                  </button>
                </>
              )}

              {["captured", "capture_pending", "reconciled"].includes(s) && (
                <>
                  {s !== "reconciled" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onReconcile(record.proposal.id);
                      }}
                      className="px-2 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[11px] shadow-sm transition-all"
                      title="Compare the captured amount with the approved price"
                      aria-label={`Reconcile the capture for ${record.proposal.title}`}
                    >
                      {s === "capture_pending" ? "Check capture" : "Reconcile"}
                    </button>
                  )}
                  {s !== "capture_pending" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDemoOvercharge(record.proposal.id);
                      }}
                      className="px-2 py-1 rounded-lg bg-amber-200 hover:bg-amber-300 text-amber-950 font-bold text-[11px] transition-all"
                      title="Record a labeled, simulated overcharge (needs ENABLE_DEMO_SCENARIO=true on the server)"
                      aria-label={`Simulate an overcharge on ${record.proposal.title}`}
                    >
                      Simulate +$
                    </button>
                  )}
                </>
              )}

              {((s === "alert" && record.paypal?.captureStatus === "COMPLETED") || s === "refund_pending") && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRefund(record.proposal.id);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-bold text-[11px] shadow-sm transition-all flex items-center gap-1"
                  title="Issue a full refund of the captured amount"
                  aria-label={`Issue a full refund for ${record.proposal.title}`}
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{s === "refund_pending" ? "Check refund" : "Refund"}</span>
                </button>
              )}

              {/* View details button (always available) */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectRecord(record);
                }}
                className="p-1.5 rounded-lg text-slate-600 hover:text-paypal-vibrant hover:bg-slate-100 transition-colors"
                title="View the audit details"
                aria-label={`View the audit details for ${record.proposal.title}`}
              >
                <Eye className="w-4 h-4" />
              </button>
            </div>
          );
        },
      },
    ];
  }, [copiedId, onConfirmHuman, onPayWithPayPal, onAuthorize, onCapture, onVoid, onReconcile, onDemoOvercharge, onRefund, onSelectRecord]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-soft overflow-hidden flex flex-col">
      {/* Table Toolbar */}
      <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-slate-50/50 to-white">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status quick filter pills */}
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              statusFilter === "all"
                ? "bg-paypal-navy text-white shadow-sm"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            All ({records.length})
          </button>
          <button
            onClick={() => setStatusFilter("action")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              statusFilter === "action"
                ? "bg-amber-600 text-white shadow-sm"
                : "bg-amber-100 text-amber-950 border border-amber-300 hover:bg-amber-200"
            }`}
          >
            Needs action (
            {records.filter((r) => ["awaiting_human", "awaiting_paypal", "capture_pending", "refund_pending"].includes(r.status)).length}
            )
          </button>
          <button
            onClick={() => setStatusFilter("paid")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              statusFilter === "paid"
                ? "bg-emerald-700 text-white shadow-sm"
                : "bg-emerald-100 text-emerald-950 border border-emerald-300 hover:bg-emerald-200"
            }`}
          >
            Approved and paid (
            {records.filter((r) => ["approved", "authorized", "captured", "reconciled"].includes(r.status)).length}
            )
          </button>
          <button
            onClick={() => setStatusFilter("alerts")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              statusFilter === "alerts"
                ? "bg-rose-700 text-white shadow-sm"
                : "bg-rose-100 text-rose-950 border border-rose-300 hover:bg-rose-200"
            }`}
          >
            Alerts and blocked (
            {records.filter((r) => ["blocked", "alert", "refunded"].includes(r.status)).length}
            )
          </button>
        </div>

        {/* Search and export */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          {/* Quick search input */}
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              type="text"
              aria-label="Search the audit table"
              value={quickFilterText}
              onChange={(e) => setQuickFilterText(e.target.value)}
              placeholder="Search proposal, merchant, status..."
              className="w-full text-xs bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-slate-900 placeholder-slate-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-paypal-vibrant"
            />
          </div>

          {/* Export CSV button */}
          <button
            onClick={onExportCsv}
            aria-label="Export the audit records to CSV"
            className="p-2 rounded-xl text-slate-700 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors shrink-0"
            title="Export to CSV"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* AG Grid React Container with Native Theming API (no legacy CSS conflict) */}
      <div className="w-full h-[520px]">
        <AgGridReact<AuditRecord>
          ref={gridRef}
          theme={guardianTheme}
          rowData={filteredData}
          columnDefs={columnDefs}
          quickFilterText={quickFilterText}
          rowHeight={58}
          headerHeight={44}
          animateRows={true}
          pagination={true}
          paginationPageSize={10}
          paginationPageSizeSelector={[10, 20, 50]}
          onRowClicked={(event) => event.data && onSelectRecord(event.data)}
          rowClass="cursor-pointer"
          suppressCellFocus={true}
          defaultColDef={{
            sortable: true,
            filter: true,
            resizable: true,
          }}
        />
      </div>

      {/* Grid footer note */}
      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/70 text-[11px] text-slate-600 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-800">Deterministic rules:</span>
          <span>currency, per_purchase_cap, monthly_cap, category, delivery_date, price_verified, price_matches_listing</span>
        </div>
        <div className="flex items-center gap-1.5 font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
          <span>PayPal Sandbox only</span>
        </div>
      </div>
    </div>
  );
};
