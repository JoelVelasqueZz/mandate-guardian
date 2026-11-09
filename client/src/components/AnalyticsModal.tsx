import React, { useEffect, useMemo, useRef } from "react";
import { createAiHarness, directLlmRunner, AgStudioAiModule, enableStudioDevValidations } from "ag-studio";
import type { AgAiHarnessSetup, AgStudioApi } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { X, BarChart3, Sparkles } from "lucide-react";
import { AuditEvent, AuditRecord } from "../types";
import { geminiAdapter } from "../studio/geminiAdapter";
import { buildRows, buildStudioData } from "../studio/data";
import { initialReport } from "../studio/dashboard";

interface AnalyticsModalProps {
  records: AuditRecord[];
  events: AuditEvent[];
  demoKey: string;
  aiEnabled: boolean;
  onClose: () => void;
}

if (import.meta.env.DEV) enableStudioDevValidations();

const LICENSE_KEY = import.meta.env.VITE_AG_STUDIO as string | undefined;

const ANALYST_PROMPT = `You are the Guardian Analyst, the analytics assistant of Mandate & Guardian.
The data describes purchases an AI buyer agent proposed and what the independent Guardian decided before any PayPal payment: approve, block, or ask a human. It also holds each rule the Guardian checked and the hash-chained audit events.
Answer in plain English and keep answers short. Always query the data before you state a number. Build charts and tiles with the widget tools when a picture answers the question better than a sentence.
Money the Guardian blocked before it moved is "stopped_value". An overcharge is a PayPal charge higher than the approved price. Never invent rows, and say so when the data is empty.
When you use delegate_to, "type" is an object that names the agent, for example {"id":"widget"}, never a plain string.
You can read the dashboard data and arrange widgets. You cannot approve, pay, capture or refund anything, and you must not claim you did.`;

const ANOMALY_PROMPT = `You are the Anomaly Watch agent. Look for what a human reviewer should see first in the Guardian's data: a rule that fails again and again, a seller or category with several blocks, overcharges, proposals waiting for a human, or a verdict mix that changed.
Query the data, then add one or two widgets that make the finding obvious (a tile or a small chart), and finish with two sentences naming what you found and which proposals it concerns. If nothing stands out, say that plainly and add no widget.`;

/**
 * Guardian Analytics: an AG Studio report over the live audit data, with a Gemini assistant.
 * The assistant is a custom lead agent ("Guardian Analyst") that can delegate to Studio's own data and widget
 * agents and to a second custom agent, "Anomaly Watch". The Gemini key stays on the server.
 */
export const AnalyticsModal: React.FC<AnalyticsModalProps> = ({ records, events, demoKey, aiEnabled, onClose }) => {
  const keyRef = useRef(demoKey);
  keyRef.current = demoKey;
  const recordsRef = useRef(records);
  recordsRef.current = records;

  const data = useMemo(() => buildStudioData(buildRows(records, events)), [records, events]);

  const ai = useMemo<AgAiHarnessSetup | undefined>(() => {
    if (!aiEnabled) return undefined;
    return ({ api: coreApi }) => {
      const api = coreApi as unknown as AgStudioApi; // the harness is only built for a full Studio, which has defineAiTool
      return createAiHarness(api, ({ builtIn }) => {
        const adapter = geminiAdapter({ endpoint: "/api/ai/turn", getDemoKey: () => keyRef.current });

        // A tool only this app has: the Guardian's own reasoning for a purchase, which is not a table column.
        const explainDecision = api.defineAiTool({
          name: "explainGuardianDecision",
          description: "Returns the Guardian's written decision for a proposal: verdict, explanation and each failed rule with its hint. Use it to answer why a purchase was blocked or sent to a human.",
          params: (s) => s.object({ titleContains: s.string() }),
          execute: (args, ctx) => {
            const needle = args.titleContains.toLowerCase();
            const hit = recordsRef.current.filter((r) => r.proposal.title.toLowerCase().includes(needle)).slice(0, 3);
            if (!hit.length) return ctx.error(`No proposal title contains "${args.titleContains}".`);
            return ctx.success(
              hit
                .map((r) => {
                  const failed = (r.decision?.findings ?? []).filter((f) => !f.ok).map((f) => `${f.rule}: ${f.detail}${f.hint ? ` (to pass: ${f.hint})` : ""}`);
                  return `${r.proposal.title} - ${r.decision?.verdict ?? "unreviewed"}. ${r.decision?.explanation ?? ""}${failed.length ? ` Failed rules: ${failed.join("; ")}` : ""}`;
                })
                .join("\n"),
            );
          },
        });

        // Both custom agents start from one of Studio's own agents, so they keep its prompt and its full toolset
        // (query, charts, layout, plans) and add what is specific to the Guardian on top.
        const { lead, widget } = builtIn;
        const analyst = directLlmRunner({
          ...lead,
          adapter,
          id: "analyst",
          name: "Guardian Analyst",
          description: "Answers questions about the Guardian's decisions and builds charts from the audit data.",
          instructions: (ctx, params) => `${ANALYST_PROMPT}\n\n${lead.instructions?.(ctx, params) ?? ""}`,
          tools: (ctx, params) => [
            ...(lead.tools?.(ctx, params) ?? []).filter((t) => t.name !== "delegate_to"),
            explainDecision,
            ctx.tools.delegateTo(["anomaly", "data", "page", "planning", "widget"]),
          ],
        });

        const anomaly = directLlmRunner({
          ...widget,
          adapter,
          id: "anomaly",
          name: "Anomaly Watch",
          description: "Scans the audit data for what a human reviewer should look at first and adds a widget that shows it.",
          schema: (s) => s.undefined(),
          instructions: (ctx) => `${ANOMALY_PROMPT}\n\n${widget.instructions?.(ctx, undefined as never) ?? ""}`,
          tools: (ctx) => [...(widget.tools?.(ctx, undefined as never) ?? []), ctx.studio.executeQuery(), explainDecision],
        });

        return {
          agents: [
            analyst,
            anomaly,
            ...Object.values(builtIn).filter((d) => d.id !== "lead").map((definition) => directLlmRunner({ ...definition, adapter })),
          ],
          primary: "analyst",
          promptStarters: [
            { label: "What did the Guardian stop?", prompt: "How much money did the Guardian stop before payment, and which purchases were they? Show it as a chart." },
            { label: "Which rule blocks most?", prompt: "Which rule fails most often? Add a bar chart of failed findings by rule." },
            { label: "Scan for anomalies", prompt: "Scan the audit data for anything a human reviewer should look at first." },
            { label: "Why was it blocked?", prompt: "Pick the largest blocked purchase and explain why the Guardian blocked it, and what would have let it pass." },
          ],
        };
      });
    };
  }, [aiEnabled]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div role="dialog" aria-modal="true" aria-labelledby="analytics-title" className="bg-white rounded-3xl w-full max-w-[1500px] h-[92vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-4 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-paypal-navy to-paypal-vibrant text-white flex items-center justify-center shadow-md shrink-0">
              <BarChart3 className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3 id="analytics-title" className="text-lg font-extrabold text-slate-900">Guardian analytics</h3>
              <p className="text-xs text-slate-600 mt-0.5 max-w-3xl">
                Build charts from the live audit data, or ask the assistant. It reads these tables and arranges widgets, and it cannot approve, pay or refund anything.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border ${aiEnabled ? "bg-indigo-100 text-indigo-950 border-indigo-300" : "bg-slate-100 text-slate-700 border-slate-300"}`}>
              <Sparkles className="w-3 h-3" aria-hidden="true" />
              {aiEnabled ? (demoKey ? "Assistant ready" : "Set the demo key to use the assistant") : "Assistant off: no AI model on the server"}
            </span>
            <button onClick={onClose} aria-label="Close the analytics" className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <AgStudioProvider licenseKey={LICENSE_KEY} modules={aiEnabled ? [AgStudioAiModule] : []}>
            <AgStudio data={data} ai={ai} mode="edit" panels={{ edit: { left: ["ai"], right: ["edit", "data"] } }} initialState={initialReport} style={{ height: "100%", width: "100%" }} />
          </AgStudioProvider>
        </div>
      </div>
    </div>
  );
};
