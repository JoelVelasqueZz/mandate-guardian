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
  Plus,
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
  onOpenNewProposal: () => void;
  onConfirmHuman: (id: string) => void;
  onPayWithPayPal: (id: string) => void;
  onAuthorize: (id: string) => void;
  onCapture: (id: string) => void;
  onVoid: (id: string) => void;
  onReconcile: (id: string) => void;
  onDemoOvercharge: (id: string) => void;
  onRefund: (id: string) => void;
  isMockMode: boolean;
}

export const AuditGrid: React.FC<AuditGridProps> = ({
  records,
  onSelectRecord,
  onOpenNewProposal,
  onConfirmHuman,
  onPayWithPayPal,
  onAuthorize,
  onCapture,
  onVoid,
  onReconcile,
  onDemoOvercharge,
  onRefund,
  isMockMode,
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
      return records.filter((r) => ["awaiting_human", "awaiting_paypal", "capture_pending"].includes(r.status));
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
        headerName: "ID Propuesta",
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
                title={`Copiar ID completo: ${id}`}
                aria-label={`Copiar ID completo de la propuesta ${id}`}
              >
                {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          );
        },
      },
      {
        headerName: "Producto & Comercio Channel3",
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
                    title={`Ver ${p.title} en catálogo Channel3`}
                    aria-label={`Abrir ficha de ${p.title} en el catálogo de Channel3`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-600 mt-0.5">
                <span className="inline-flex items-center gap-1 font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                  <ShoppingBag className="w-3 h-3 text-indigo-600" />
                  {p.seller ?? "Channel3 Direct"}
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
        headerName: "Precio & Verificación",
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
                  title={matchListing ? "El precio coincide con el catálogo Channel3 en vivo" : "Discrepancia con el precio del catálogo"}
                >
                  {matchListing ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                  <span>Listado: ${p.listedPrice.toFixed(2)}</span>
                </span>
              )}
            </div>
          );
        },
      },
      {
        headerName: "Estado Actual",
        field: "status",
        width: 180,
        cellRenderer: (params: ICellRendererParams<AuditRecord>) => {
          const status = params.data?.status as PaymentStatus;
          const badges: Record<PaymentStatus, { label: string; bg: string; text: string; border: string; icon: any }> = {
            approved: { label: "Aprobado", bg: "bg-emerald-100/90", text: "text-emerald-950", border: "border-emerald-300", icon: ShieldCheck },
            reconciled: { label: "Reconciliado 100%", bg: "bg-emerald-100", text: "text-emerald-950", border: "border-emerald-400", icon: CheckCircle2 },
            captured: { label: "Capturado", bg: "bg-blue-100", text: "text-blue-950", border: "border-blue-300", icon: Check },
            authorized: { label: "Autorizado (Plan A)", bg: "bg-indigo-100", text: "text-indigo-950", border: "border-indigo-300", icon: CreditCard },
            awaiting_paypal: { label: "En Checkout PayPal", bg: "bg-amber-100", text: "text-amber-950", border: "border-amber-300", icon: Clock },
            awaiting_human: { label: "Requiere Humano", bg: "bg-orange-100", text: "text-orange-950", border: "border-orange-300", icon: Clock },
            blocked: { label: "Bloqueado", bg: "bg-rose-100", text: "text-rose-950", border: "border-rose-300", icon: ShieldX },
            alert: { label: "Alerta Discrepancia", bg: "bg-rose-200", text: "text-rose-950", border: "border-rose-400", icon: AlertTriangle },
            refunded: { label: "Reembolsado", bg: "bg-slate-200", text: "text-slate-900", border: "border-slate-400", icon: RotateCcw },
            capture_pending: { label: "Captura Pendiente", bg: "bg-amber-100", text: "text-amber-950", border: "border-amber-300", icon: Clock },
            refund_pending: { label: "Reembolso Pend.", bg: "bg-amber-100", text: "text-amber-950", border: "border-amber-300", icon: Clock },
            voided: { label: "Anulado (Void)", bg: "bg-slate-200", text: "text-slate-800", border: "border-slate-300", icon: RotateCcw },
            proposed: { label: "Propuesta Inicial", bg: "bg-slate-100", text: "text-slate-800", border: "border-slate-300", icon: Clock },
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
        headerName: "Veredicto Guardian & IA",
        field: "decision.verdict",
        width: 195,
        cellRenderer: (params: ICellRendererParams<AuditRecord>) => {
          const d = params.data?.decision;
          if (!d) return <span className="text-slate-500 text-xs">Sin evaluar</span>;
          const passedRules = d.findings.filter((f) => f.ok).length;
          const totalRules = d.findings.length;
          return (
            <div className="flex flex-col justify-center py-1">
              <div className="flex items-center gap-1.5">
                {d.verdict === "approve" && (
                  <span className="flex items-center gap-1 text-emerald-800 font-bold text-xs">
                    <ShieldCheck className="w-3.5 h-3.5" /> Aprobado
                  </span>
                )}
                {d.verdict === "block" && (
                  <span className="flex items-center gap-1 text-rose-800 font-bold text-xs">
                    <ShieldX className="w-3.5 h-3.5" /> Bloqueado
                  </span>
                )}
                {d.verdict === "ask_human" && (
                  <span className="flex items-center gap-1 text-amber-900 font-bold text-xs">
                    <ShieldAlert className="w-3.5 h-3.5" /> Confirmar
                  </span>
                )}
                <span className="text-[11px] text-slate-600 font-bold">
                  ({passedRules}/{totalRules} reglas)
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
        headerName: "Trazabilidad PayPal",
        field: "paypal.orderId",
        width: 175,
        cellRenderer: (params: ICellRendererParams<AuditRecord>) => {
          const pp = params.data?.paypal;
          if (!pp?.orderId) {
            return <span className="text-slate-500 text-xs font-semibold">No iniciado</span>;
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
                    Cobro: ${pp.charged.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          );
        },
      },
      {
        headerName: "Conciliación Auditora",
        field: "reconciliation.detail",
        minWidth: 195,
        flex: 1,
        cellRenderer: (params: ICellRendererParams<AuditRecord>) => {
          const r = params.data?.reconciliation;
          const demo = params.data?.demo;
          if (!r) {
            return <span className="text-slate-500 text-xs font-medium">Pendiente de cobro</span>;
          }
          return (
            <div className="flex items-center gap-1.5 py-1">
              {r.match ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-950 bg-emerald-100 px-2.5 py-0.5 rounded-full border border-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Exacto (1:1)</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-950 bg-rose-100 px-2.5 py-0.5 rounded-full border border-rose-300" title={r.detail}>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>{demo ? "Sobrecargo Demo" : "Discrepancia"}</span>
                </span>
              )}
            </div>
          );
        },
      },
      {
        headerName: "Acciones Contextuales",
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
                  title="Aprobar humanamente esta propuesta"
                  aria-label={`Aprobar manualmente propuesta ${record.proposal.title}`}
                >
                  Aprobar
                </button>
              )}

              {s === "approved" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onPayWithPayPal(record.proposal.id);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-paypal-gold hover:bg-paypal-goldHover text-slate-950 font-black text-[11px] shadow-sm transition-all flex items-center gap-1 border border-amber-300"
                  title="Generar orden y abrir link de aprobación en PayPal Sandbox"
                  aria-label={`Pagar ${record.proposal.title} con PayPal Sandbox`}
                >
                  <span>Pagar PayPal</span>
                </button>
              )}

              {s === "awaiting_paypal" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCapture(record.proposal.id);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-paypal-vibrant hover:bg-paypal-blue text-white font-bold text-[11px] shadow-sm transition-all"
                  title="Capturar orden aprobada en PayPal"
                  aria-label={`Capturar orden PayPal para ${record.proposal.title}`}
                >
                  Capturar
                </button>
              )}

              {s === "authorized" && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCapture(record.proposal.id);
                    }}
                    className="px-2 py-1 rounded-lg bg-paypal-vibrant hover:bg-paypal-blue text-white font-bold text-[11px] shadow-sm transition-all"
                    title="Capturar fondos autorizados"
                    aria-label={`Capturar fondos autorizados de ${record.proposal.title}`}
                  >
                    Capturar
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onVoid(record.proposal.id);
                    }}
                    className="px-2 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-900 font-bold text-[11px] transition-all"
                    title="Anular autorización (Void hold)"
                    aria-label={`Anular autorización de ${record.proposal.title}`}
                  >
                    Void
                  </button>
                </>
              )}

              {s === "captured" && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onReconcile(record.proposal.id);
                    }}
                    className="px-2 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[11px] shadow-sm transition-all"
                    title="Conciliar monto capturado en PayPal vs propuesta"
                    aria-label={`Conciliar captura de ${record.proposal.title}`}
                  >
                    Conciliar
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDemoOvercharge(record.proposal.id);
                    }}
                    className="px-2 py-1 rounded-lg bg-amber-200 hover:bg-amber-300 text-amber-950 font-bold text-[11px] transition-all"
                    title="Simular sobrecargo para disparar alerta del auditor"
                    aria-label={`Simular sobrecargo en ${record.proposal.title}`}
                  >
                    Simular +$
                  </button>
                </>
              )}

              {s === "alert" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRefund(record.proposal.id);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-bold text-[11px] shadow-sm transition-all flex items-center gap-1"
                  title="Emitir reembolso completo del monto capturado en PayPal"
                  aria-label={`Emitir reembolso completo para ${record.proposal.title}`}
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reembolsar</span>
                </button>
              )}

              {/* View details button (always available) */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectRecord(record);
                }}
                className="p-1.5 rounded-lg text-slate-600 hover:text-paypal-vibrant hover:bg-slate-100 transition-colors"
                title="Ver auditoría y detalles JSON completos"
                aria-label={`Ver expediente y detalles de auditoría para ${record.proposal.title}`}
              >
                <Eye className="w-4 h-4" />
              </button>
            </div>
          );
        },
      },
    ];
  }, [copiedId, onConfirmHuman, onPayWithPayPal, onCapture, onVoid, onReconcile, onDemoOvercharge, onRefund, onSelectRecord]);

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
            Todos ({records.length})
          </button>
          <button
            onClick={() => setStatusFilter("action")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              statusFilter === "action"
                ? "bg-amber-600 text-white shadow-sm"
                : "bg-amber-100 text-amber-950 border border-amber-300 hover:bg-amber-200"
            }`}
          >
            Requiere Acción (
            {records.filter((r) => ["awaiting_human", "awaiting_paypal"].includes(r.status)).length}
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
            Aprobados & Pagados (
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
            Alertas & Bloqueados (
            {records.filter((r) => ["blocked", "alert", "refunded"].includes(r.status)).length}
            )
          </button>
        </div>

        {/* Search, New Proposal, Export */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          {/* Quick search input */}
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              type="text"
              aria-label="Buscar en la tabla de auditoría"
              value={quickFilterText}
              onChange={(e) => setQuickFilterText(e.target.value)}
              placeholder="Buscar propuesta, vendedor, estado..."
              className="w-full text-xs bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-slate-900 placeholder-slate-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-paypal-vibrant"
            />
          </div>

          {/* New manual proposal button */}
          <button
            onClick={onOpenNewProposal}
            aria-label="Crear y someter nueva propuesta de compra"
            className="px-3.5 py-2 rounded-xl bg-paypal-vibrant hover:bg-paypal-blue text-white font-bold text-xs shadow-sm transition-all flex items-center gap-1.5 shrink-0"
            title="Someter propuesta personalizada para auditar con Guardian"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden md:inline">Nueva Propuesta</span>
          </button>

          {/* Export CSV button */}
          <button
            onClick={onExportCsv}
            aria-label="Exportar registros de auditoría a CSV"
            className="p-2 rounded-xl text-slate-700 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors shrink-0"
            title="Exportar registros a CSV"
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
          <span className="font-bold text-slate-800">Reglas deterministas activas:</span>
          <span>per_purchase_cap, monthly_cap, allowed_categories, delivery_deadline, price_matches_listing</span>
        </div>
        <div className="flex items-center gap-1.5 font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
          <span>AG Grid Theming API &bull; PayPal Sandbox Testbed</span>
        </div>
      </div>
    </div>
  );
};
