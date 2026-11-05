import React, { useCallback, useEffect, useState } from "react";
import { X, ShieldCheck, ShieldX, Swords, RefreshCw, Sparkles, Lock } from "lucide-react";
import { RedTeamReport, Verdict } from "../types";

interface RedTeamModalProps {
  onClose: () => void;
  aiAvailable: boolean;
  onRun: (useAi: boolean) => Promise<RedTeamReport>;
}

const verdictLabel: Record<Verdict, string> = {
  approve: "Approve",
  block: "Block",
  ask_human: "Ask a human",
};

export const RedTeamModal: React.FC<RedTeamModalProps> = ({ onClose, aiAvailable, onRun }) => {
  const [report, setReport] = useState<RedTeamReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useAi, setUseAi] = useState(false);

  const run = useCallback(
    async (withAi: boolean) => {
      setRunning(true);
      setError(null);
      try {
        setReport(await onRun(withAi));
      } catch (e) {
        setError(e instanceof Error ? e.message : "The red team could not run.");
      } finally {
        setRunning(false);
      }
    },
    [onRun],
  );

  // Deterministic and cheap, so it runs as soon as the window opens.
  useEffect(() => {
    run(false);
  }, [run]);

  const allHeld = report ? report.held === report.total : false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div role="dialog" aria-modal="true" aria-labelledby="redteam-title" className="bg-white rounded-3xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-start justify-between gap-4 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-rose-700 text-white flex items-center justify-center shadow-md shrink-0">
              <Swords className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3 id="redteam-title" className="text-lg font-extrabold text-slate-900">Red team: attacks on the live Guardian</h3>
              <p className="text-xs text-slate-600 mt-0.5 max-w-xl">
                Hostile proposals go through the same Guardian code the app uses, on an isolated copy with an offline test
                catalog. Your records and your money are never touched.
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close the red team window" className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pt-5">
          <div
            role="status"
            aria-live="polite"
            className={`rounded-2xl px-5 py-4 flex flex-wrap items-center justify-between gap-3 border ${
              !report ? "bg-slate-50 border-slate-200" : allHeld ? "bg-emerald-50 border-emerald-300" : "bg-rose-50 border-rose-300"
            }`}
          >
            <div className="flex items-center gap-3">
              {running ? (
                <RefreshCw className="w-6 h-6 text-slate-500 animate-spin" aria-hidden="true" />
              ) : allHeld ? (
                <ShieldCheck className="w-7 h-7 text-emerald-700" aria-hidden="true" />
              ) : (
                <ShieldX className="w-7 h-7 text-rose-700" aria-hidden="true" />
              )}
              <div>
                <div className="text-base font-black text-slate-950">
                  {running && !report
                    ? "Running the attacks..."
                    : report
                      ? `The Guardian held in ${report.held} of ${report.total} scenarios`
                      : "No result yet"}
                </div>
                {report && (
                  <div className="text-xs text-slate-700">
                    {allHeld
                      ? "Every attack ended the way your rules require."
                      : "At least one scenario ended differently from what the rules require."}
                    {report.aiUsed ? " The AI reviewer saw the injection attempts." : " Rules only: no model was involved."}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {aiAvailable && (
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useAi}
                    onChange={(e) => setUseAi(e.target.checked)}
                    className="rounded border-slate-400"
                  />
                  <span className="inline-flex items-center gap-1"><Sparkles className="w-3.5 h-3.5 text-indigo-700" aria-hidden="true" />Also show the injections to the AI reviewer</span>
                </label>
              )}
              <button
                onClick={() => run(useAi)}
                disabled={running}
                className="px-4 py-2 rounded-xl bg-paypal-navy hover:bg-slate-900 text-white font-bold text-xs shadow-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${running ? "animate-spin" : ""}`} aria-hidden="true" />
                <span>{running ? "Running..." : "Run again"}</span>
              </button>
            </div>
          </div>
          {error && <p role="alert" className="mt-3 text-xs font-semibold text-rose-800">{error}</p>}
        </div>

        <ul className="p-6 overflow-y-auto space-y-3 flex-1">
          {report?.results.map((r) => (
            <li
              key={r.id}
              className={`rounded-2xl border p-4 ${r.held ? "bg-white border-slate-200" : "bg-rose-50 border-rose-300"}`}
            >
              <div className="flex items-start gap-3">
                {r.held ? (
                  <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" aria-label="The Guardian held" />
                ) : (
                  <ShieldX className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" aria-label="The Guardian did not hold" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-extrabold text-slate-900">{r.name}</span>
                    {r.aiReviewed && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-900 bg-indigo-100 border border-indigo-300 px-2 py-0.5 rounded-full">
                        <Sparkles className="w-3 h-3" aria-hidden="true" /> AI reviewed
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-700 mt-0.5">{r.attack}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px] font-bold">
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 border border-slate-300">
                      Rules require: {verdictLabel[r.expected]}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full border ${
                        r.held ? "bg-emerald-100 text-emerald-950 border-emerald-300" : "bg-rose-100 text-rose-950 border-rose-300"
                      }`}
                    >
                      Guardian: {verdictLabel[r.actual]}
                    </span>
                    {r.failedRules.map((rule) => (
                      <span key={rule} className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-950 border border-amber-300 font-mono">
                        {rule}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </li>
          ))}
          {!report && running && <li className="text-xs text-slate-600">Sending hostile proposals to the Guardian...</li>}
        </ul>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center gap-2 text-[11px] text-slate-600">
          <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>
            The spending caps are code, not a prompt: a model cannot talk the Guardian out of a failed rule, and the AI reviewer
            can only make a verdict stricter.
          </span>
        </div>
      </div>
    </div>
  );
};
