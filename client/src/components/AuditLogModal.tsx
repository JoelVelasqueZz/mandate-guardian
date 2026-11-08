import React, { useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { ColDef, ICellRendererParams, RowClassParams, themeQuartz } from "ag-grid-community";
import { X, Link2, ShieldCheck, ShieldX, Search, Download, RefreshCw } from "lucide-react";
import { AuditEvent, ChainCheck } from "../types";

interface AuditLogModalProps {
  events: AuditEvent[];
  chain: ChainCheck | null;
  onVerify: () => Promise<void>;
  onClose: () => void;
}

const theme = themeQuartz.withParams({
  fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif',
  fontSize: 12,
  headerBackgroundColor: "#F8FAFC",
  headerTextColor: "#0F172A",
  borderColor: "#E2E8F0",
  rowHoverColor: "#F8FAFF",
  accentColor: "#0070BA",
});

/** Colors follow how far a payment has got: grey while pending, blue once money moved, green when it checks out. */
function chipStyle(type: string): string {
  if (type.endsWith("reviewed")) return "bg-slate-100 text-slate-900 border-slate-300";
  if (type.endsWith("approved") || type.endsWith("reconciled")) return "bg-emerald-100 text-emerald-950 border-emerald-300";
  if (type.endsWith("authorized") || type.endsWith("captured")) return "bg-blue-100 text-blue-950 border-blue-300";
  if (type.endsWith("alert") || type.endsWith("blocked")) return "bg-rose-100 text-rose-950 border-rose-300";
  if (type.endsWith("refunded") || type.endsWith("voided")) return "bg-amber-100 text-amber-950 border-amber-300";
  return "bg-indigo-50 text-indigo-950 border-indigo-200";
}

type Row = Partial<AuditEvent> & { total?: boolean };

export const AuditLogModal: React.FC<AuditLogModalProps> = ({ events, chain, onVerify, onClose }) => {
  const gridRef = useRef<AgGridReact<Row>>(null);
  const seen = useRef(0);
  const [filter, setFilter] = useState("");
  const [verifying, setVerifying] = useState(false);

  const columnDefs = useMemo<ColDef<Row>[]>(
    () => [
      { headerName: "#", field: "seq", width: 80, valueFormatter: (p) => (p.data?.total ? "" : `#${p.value}`), sort: "desc" },
      {
        headerName: "Time",
        field: "at",
        width: 110,
        valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleTimeString() : ""),
      },
      {
        headerName: "Event",
        field: "type",
        width: 190,
        cellStyle: { display: "flex", alignItems: "center" },
        cellRenderer: (p: ICellRendererParams<Row>) =>
          p.data?.total ? (
            <span className="font-bold text-slate-900">{p.value}</span>
          ) : (
            <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold border ${chipStyle(String(p.value ?? ""))}`}>
              {p.value}
            </span>
          ),
      },
      { headerName: "Proposal", field: "proposalId", width: 120, valueFormatter: (p) => (p.value ? String(p.value).slice(0, 8) : ""), cellClass: "font-mono" },
      { headerName: "What happened", field: "detail", flex: 2, minWidth: 260, tooltipField: "detail" },
      {
        headerName: "Chained to",
        width: 120,
        valueGetter: (p) => (p.data?.total || p.data?.seq === undefined ? "" : p.data.seq === 0 ? "genesis" : `#${p.data.seq - 1}`),
        cellClass: "font-mono",
      },
      {
        headerName: "Hash",
        field: "hash",
        width: 170,
        valueFormatter: (p) => (p.value ? `${String(p.value).slice(0, 16)}...` : ""),
        tooltipField: "hash",
        cellClass: "font-mono",
      },
    ],
    [],
  );

  // The bottom row is a live total: how many events and whether the chain still verifies.
  const pinnedBottom = useMemo<Row[]>(
    () => [
      {
        total: true,
        type: `${events.length} events`,
        detail: chain ? (chain.ok ? "Chain verified: every event links to the one before it." : `Chain BROKEN at event #${chain.brokenAt}.`) : "Chain not checked.",
        hash: chain?.headHash,
      },
    ],
    [events.length, chain],
  );

  // New events flash when they arrive, so a payment step is visible as it is written to the log.
  useEffect(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    if (events.length > seen.current && seen.current > 0) {
      const nodes = events.slice(seen.current).map((e) => api.getRowNode(e.hash)).filter((n) => n != null);
      if (nodes.length) api.flashCells({ rowNodes: nodes as never[], columns: ["seq", "type", "detail"] });
    }
    seen.current = events.length;
  }, [events]);

  const rowClass = (p: RowClassParams<Row>) => {
    if (p.node.rowPinned) return "font-bold bg-slate-50";
    return chain && !chain.ok && chain.brokenAt !== undefined && (p.data?.seq ?? 0) >= chain.brokenAt ? "bg-rose-50" : "";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div role="dialog" aria-modal="true" aria-labelledby="auditlog-title" className="bg-white rounded-3xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-start justify-between gap-4 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-paypal-navy to-paypal-vibrant text-white flex items-center justify-center shadow-md shrink-0">
              <Link2 className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3 id="auditlog-title" className="text-lg font-extrabold text-slate-900">Audit log</h3>
              <p className="text-xs text-slate-600 mt-0.5 max-w-2xl">
                Every Guardian decision and every payment step, each carrying the hash of the event before it. Edit or delete
                one and every row after it turns red.
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close the audit log" className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pt-4 flex flex-wrap items-center justify-between gap-3">
          <div
            role="status"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border ${
              !chain ? "bg-slate-50 border-slate-200 text-slate-700" : chain.ok ? "bg-emerald-50 border-emerald-300 text-emerald-950" : "bg-rose-50 border-rose-300 text-rose-950"
            }`}
          >
            {chain && !chain.ok ? <ShieldX className="w-4 h-4" aria-hidden="true" /> : <ShieldCheck className="w-4 h-4" aria-hidden="true" />}
            <span>{!chain ? "Not checked" : chain.ok ? `Verified, ${chain.length} events` : `Broken at event #${chain.brokenAt}`}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                type="text"
                aria-label="Search the audit log"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search events..."
                className="text-xs bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3 py-2 w-48 text-slate-900 placeholder-slate-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-paypal-vibrant"
              />
            </div>
            <button
              onClick={async () => {
                setVerifying(true);
                try {
                  await onVerify();
                } finally {
                  setVerifying(false);
                }
              }}
              disabled={verifying}
              className="px-3 py-2 rounded-xl bg-paypal-navy hover:bg-slate-900 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${verifying ? "animate-spin" : ""}`} aria-hidden="true" />
              <span>Verify now</span>
            </button>
            <button
              onClick={() => gridRef.current?.api.exportDataAsCsv({ fileName: "mandate-guardian-audit-log.csv" })}
              aria-label="Export the audit log to CSV"
              title="Export to CSV"
              className="p-2 rounded-xl text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 flex-1 min-h-0">
          <div className="w-full h-[420px]">
            <AgGridReact<Row>
              ref={gridRef}
              theme={theme}
              rowData={events}
              columnDefs={columnDefs}
              getRowId={(p) => String(p.data.hash)}
              pinnedBottomRowData={pinnedBottom}
              quickFilterText={filter}
              getRowClass={rowClass}
              animateRows
              rowHeight={40}
              tooltipShowDelay={300}
              pagination
              paginationPageSize={20}
              suppressCellFocus
              defaultColDef={{ sortable: true, filter: true, resizable: true }}
              overlayNoRowsTemplate="No events yet. Run the buyer agent to write the first one."
            />
          </div>
        </div>
      </div>
    </div>
  );
};
