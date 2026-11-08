import React, { useState } from "react";
import { Sparkles, Shield, ShoppingBag, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { Mandate } from "../types";

interface MandateSectionProps {
  mandates: Mandate[];
  activeMandate?: Mandate;
  onSelectMandate: (m: Mandate) => void;
  onCreateMandate: (data: Omit<Mandate, "id">) => Promise<void>;
  onRunShop: (mandateId: string, query?: string) => Promise<void>;
  onParseNaturalLanguage: (text: string) => Promise<Partial<Mandate> | null>;
  aiAvailable: boolean;
  loading: boolean;
}

export const MandateSection: React.FC<MandateSectionProps> = ({
  mandates,
  activeMandate,
  onSelectMandate,
  onCreateMandate,
  onRunShop,
  onParseNaturalLanguage,
  aiAvailable,
  loading,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"runner" | "create">("runner");

  // Shop runner state
  const [searchQuery, setSearchQuery] = useState("");
  const [isShopping, setIsShopping] = useState(false);

  // Natural language & form state
  const [nlText, setNlText] = useState("");
  const [isParsing, setIsParsing] = useState(false);

  // Form fields
  const [goal, setGoal] = useState("");
  const [maxPerPurchase, setMaxPerPurchase] = useState<number>(50);
  const [maxMonthly, setMaxMonthly] = useState<number>(200);
  const [requireHumanAbove, setRequireHumanAbove] = useState<number | "">("");
  const [deliverBy, setDeliverBy] = useState("");
  const [categories, setCategories] = useState("");

  const handleParseNl = async () => {
    if (!nlText.trim()) return;
    setIsParsing(true);
    try {
      const parsed = await onParseNaturalLanguage(nlText);
      if (parsed) {
        if (parsed.goal) setGoal(parsed.goal);
        if (parsed.maxPerPurchase) setMaxPerPurchase(parsed.maxPerPurchase);
        if (parsed.maxMonthly) setMaxMonthly(parsed.maxMonthly);
        if (parsed.requireHumanAbove) setRequireHumanAbove(parsed.requireHumanAbove);
        if (parsed.deliverBy) setDeliverBy(parsed.deliverBy);
        if (parsed.allowedCategories) setCategories(parsed.allowedCategories.join(", "));
      }
    } finally {
      setIsParsing(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal) return;
    await onCreateMandate({
      goal,
      currency: "USD",
      maxPerPurchase: Number(maxPerPurchase),
      maxMonthly: Number(maxMonthly),
      requireHumanAbove: requireHumanAbove !== "" ? Number(requireHumanAbove) : undefined,
      deliverBy: deliverBy || undefined,
      allowedCategories: categories
        ? categories.split(",").map((c) => c.trim()).filter(Boolean)
        : [],
    });
    setGoal("");
    setActiveTab("runner");
  };

  const handleShop = async () => {
    if (!activeMandate) return;
    setIsShopping(true);
    try {
      await onRunShop(activeMandate.id, searchQuery || undefined);
      setSearchQuery("");
    } finally {
      setIsShopping(false);
    }
  };

  return (
    <section aria-labelledby="mandate-section-heading" className="bg-white rounded-2xl border border-slate-200/90 shadow-soft mb-6 overflow-hidden transition-all">
      {/* Mandate Bar Header */}
      <div className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-slate-50/60 to-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-paypal-navy text-white flex items-center justify-center font-bold shadow-sm">
            <Shield className="w-5 h-5 text-paypal-gold" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span id="mandate-section-heading" className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Active mandate
              </span>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-950 border border-emerald-300">
                Deterministic rules
              </span>
            </div>
            <h2 className="text-base font-extrabold text-slate-900 line-clamp-1">
              {activeMandate ? activeMandate.goal : "No mandate selected. Create one below."}
            </h2>
          </div>
        </div>

        {/* Quick parameters summary */}
        <div className="flex flex-wrap items-center gap-2">
          {activeMandate && (
            <div className="hidden md:flex items-center gap-2 text-xs text-slate-700 bg-slate-100/90 px-3 py-1.5 rounded-xl border border-slate-200">
              <span className="font-medium">
                Per-purchase cap: <strong className="text-slate-950">${activeMandate.maxPerPurchase}</strong>
              </span>
              <span className="text-slate-400" aria-hidden="true">|</span>
              <span className="font-medium">
                Monthly cap: <strong className="text-slate-950">${activeMandate.maxMonthly}</strong>
              </span>
              {activeMandate.requireHumanAbove && (
                <>
                  <span className="text-slate-400" aria-hidden="true">|</span>
                  <span className="font-medium text-amber-900">
                    Ask a human above <strong className="text-amber-950">${activeMandate.requireHumanAbove}</strong>
                  </span>
                </>
              )}
            </div>
          )}

          {/* Accessible Mandate dropdown with associated label */}
          {mandates.length > 1 && (
            <div className="flex items-center gap-1.5">
              <label htmlFor="active-mandate-select" className="sr-only">
                Select the active mandate
              </label>
              <select
                id="active-mandate-select"
                aria-label="Select the active mandate"
                value={activeMandate?.id}
                onChange={(e) => {
                  const found = mandates.find((m) => m.id === e.target.value);
                  if (found) onSelectMandate(found);
                }}
                className="text-xs font-bold bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-paypal-vibrant"
              >
                {mandates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.goal.slice(0, 32)}... (${m.maxPerPurchase})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Expand/Collapse toggle */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            aria-expanded={isOpen}
            aria-label={isOpen ? "Hide the mandate controls" : "Show the mandate controls"}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-paypal-vibrant bg-paypal-light hover:bg-blue-100/70 border border-blue-200/80 transition-colors"
          >
            <span>{isOpen ? "Hide controls" : "Run agent / New mandate"}</span>
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Collapsible Panel */}
      {isOpen && (
        <div className="p-5 border-t border-slate-100 bg-slate-50/50">
          {/* Sub tabs */}
          <div className="flex border-b border-slate-200 mb-5" role="tablist">
            <button
              role="tab"
              aria-selected={activeTab === "runner"}
              onClick={() => setActiveTab("runner")}
              className={`pb-2.5 px-4 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
                activeTab === "runner"
                  ? "border-paypal-vibrant text-paypal-vibrant"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              <ShoppingBag className="w-4 h-4" />
              <span>Run the buyer agent</span>
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "create"}
              onClick={() => setActiveTab("create")}
              className={`pb-2.5 px-4 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
                activeTab === "create"
                  ? "border-paypal-vibrant text-paypal-vibrant"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <span>Create a mandate</span>
            </button>
          </div>

          {/* Tab 1: Shop Runner */}
          {activeTab === "runner" && (
            <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm">
              <div className="max-w-3xl">
                <h3 className="text-sm font-bold text-slate-900 mb-1 flex items-center gap-2">
                  <span>Search products and have Guardian review the pick</span>
                  <span className="text-[11px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full">
                    The agent that spends is not the one that watches
                  </span>
                </h3>
                <p className="text-xs text-slate-600 mb-4">
                  The buyer agent <strong>Mandate</strong> searches the catalog for products that fit the goal and the caps. Its proposal goes straight to <strong>Guardian</strong>, which re-reads the price from the catalog and checks the rules before any payment.
                </p>

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <label htmlFor="shop-search-input" className="sr-only">
                      Search the catalog
                    </label>
                    <input
                      id="shop-search-input"
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={activeMandate ? `Optional: refine the search (default: ${activeMandate.goal})` : "Create a mandate first"}
                      className="w-full text-xs bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-slate-900 placeholder-slate-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-paypal-vibrant"
                      onKeyDown={(e) => e.key === "Enter" && handleShop()}
                    />
                  </div>
                  <button
                    onClick={handleShop}
                    disabled={isShopping || !activeMandate}
                    aria-label="Run the buyer agent to search for offers"
                    className="px-5 py-3 rounded-xl bg-paypal-vibrant hover:bg-paypal-blue text-white font-bold text-xs shadow-md transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    <ShoppingBag className={`w-4 h-4 ${isShopping ? "animate-bounce" : ""}`} />
                    <span>{isShopping ? "Searching..." : "Run buyer agent"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Create Mandate with AI */}
          {activeTab === "create" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Natural Language Prompt */}
              <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-indigo-600" /> Natural-language assistant
                  </span>
                  <span className="text-[11px] text-slate-600 font-mono">POST /api/mandates/parse</span>
                </div>
                <p className="text-xs text-slate-600 mb-3">
                  Describe what you want to buy and your limits. The model fills in the form below and never invents a spending cap; missing caps come back as questions. {aiAvailable ? "" : "The AI model is not configured on the server, so fill in the form by hand."}
                </p>

                <label htmlFor="nl-mandate-textarea" className="sr-only">
                  Purchase request in plain language
                </label>
                <textarea
                  id="nl-mandate-textarea"
                  value={nlText}
                  onChange={(e) => setNlText(e.target.value)}
                  rows={3}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-xl p-3 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-3"
                  placeholder="e.g. A birthday gift for my mom, max $40, by Friday"
                />

                <button
                  type="button"
                  onClick={handleParseNl}
                  disabled={isParsing || !aiAvailable}
                  aria-label="Fill the mandate form with the AI model"
                  className="w-full py-2.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-channel3-accent font-bold text-xs border border-indigo-300 transition-colors flex items-center justify-center gap-2"
                >
                  <Sparkles className={`w-4 h-4 ${isParsing ? "animate-spin" : ""}`} />
                  <span>{isParsing ? "Reading..." : "Fill the form from text"}</span>
                </button>
              </div>

              {/* Structured Form */}
              <form onSubmit={handleCreate} className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-slate-900">Mandate rules (enforced by code)</span>
                  <button
                    type="button"
                    onClick={() => {
                      setGoal("a birthday gift for my mom");
                      setMaxPerPurchase(40);
                      setMaxMonthly(100);
                      setRequireHumanAbove("");
                      setCategories("");
                      setDeliverBy("");
                    }}
                    className="text-[11px] font-bold text-paypal-vibrant hover:underline"
                  >
                    Fill with the example
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label htmlFor="mandate-goal-input" className="block text-[11px] font-bold text-slate-700 mb-1">
                      Goal *
                    </label>
                    <input
                      id="mandate-goal-input"
                      type="text"
                      required
                      value={goal}
                      onChange={(e) => setGoal(e.target.value)}
                      placeholder="e.g. Birthday gift for my mom"
                      className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-paypal-vibrant"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label htmlFor="mandate-max-purchase-input" className="block text-[11px] font-bold text-slate-700 mb-1">
                        Per-purchase cap ($) *
                      </label>
                      <input
                        id="mandate-max-purchase-input"
                        type="number"
                        required
                        min={1}
                        value={maxPerPurchase}
                        onChange={(e) => setMaxPerPurchase(Number(e.target.value))}
                        className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-paypal-vibrant"
                      />
                    </div>
                    <div>
                      <label htmlFor="mandate-max-monthly-input" className="block text-[11px] font-bold text-slate-700 mb-1">
                        Monthly cap ($) *
                      </label>
                      <input
                        id="mandate-max-monthly-input"
                        type="number"
                        required
                        min={1}
                        value={maxMonthly}
                        onChange={(e) => setMaxMonthly(Number(e.target.value))}
                        className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-paypal-vibrant"
                      />
                    </div>
                    <div>
                      <label htmlFor="mandate-require-human-input" className="block text-[11px] font-bold text-slate-700 mb-1">
                        Ask a human above ($)
                      </label>
                      <input
                        id="mandate-require-human-input"
                        type="number"
                        min={1}
                        value={requireHumanAbove}
                        onChange={(e) => setRequireHumanAbove(e.target.value === "" ? "" : Number(e.target.value))}
                        placeholder="Optional"
                        className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-paypal-vibrant"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="mandate-categories-input" className="block text-[11px] font-bold text-slate-700 mb-1">
                        Allowed categories
                      </label>
                      <input
                        id="mandate-categories-input"
                        type="text"
                        value={categories}
                        onChange={(e) => setCategories(e.target.value)}
                        placeholder="Gifts, Books, Tech"
                        className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-paypal-vibrant"
                      />
                    </div>
                    <div>
                      <label htmlFor="mandate-delivery-input" className="block text-[11px] font-bold text-slate-700 mb-1">
                        Deliver by
                      </label>
                      <input
                        id="mandate-delivery-input"
                        type="date"
                        value={deliverBy}
                        onChange={(e) => setDeliverBy(e.target.value)}
                        className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-paypal-vibrant"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    aria-label="Save the new mandate"
                    className="w-full py-2.5 rounded-xl bg-paypal-navy hover:bg-slate-900 text-white font-bold text-xs transition-colors shadow-sm flex items-center justify-center gap-2 mt-2"
                  >
                    <Plus className="w-4 h-4 text-paypal-gold" />
                    <span>Save mandate</span>
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
