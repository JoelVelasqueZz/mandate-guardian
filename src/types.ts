import { z } from "zod";

/** Rules the user sets once. Enforced in deterministic code by the Guardian. */
export const MandateSchema = z.object({
  id: z.string(),
  goal: z.string().min(1), // natural language, e.g. "a gift for Friday"
  currency: z.string().length(3).default("USD"),
  maxPerPurchase: z.number().positive(),
  maxMonthly: z.number().positive(),
  allowedCategories: z.array(z.string()).default([]), // empty = any
  deliverBy: z.string().optional(), // ISO date
  requireHumanAbove: z.number().positive().optional(), // ask the human over this amount
});
export type Mandate = z.infer<typeof MandateSchema>;

/** What the buyer agent (Mandate) proposes. It can never pay on its own. */
export const ProposalSchema = z.object({
  id: z.string(),
  mandateId: z.string(),
  productId: z.string().optional(), // catalog id, lets the Guardian re-read the live listing
  title: z.string(),
  seller: z.string().optional(),
  category: z.string().optional(),
  price: z.number().positive(),
  listedPrice: z.number().positive().optional(), // price re-checked from the live listing
  currency: z.string().length(3).default("USD"),
  estimatedDelivery: z.string().optional(), // ISO date
  url: z.string().optional(),
  reasoning: z.string().default(""), // why the buyer picked it
});
export type Proposal = z.infer<typeof ProposalSchema>;

export type Verdict = "approve" | "block" | "ask_human";

export interface Finding {
  rule: string;
  ok: boolean;
  detail: string;
  /** For a failed rule: what would have to change for it to pass. Deterministic text, never from a model. */
  hint?: string;
}

export interface Decision {
  proposalId: string;
  verdict: Verdict;
  findings: Finding[];
  /** Plain-language explanation shown to the user (filled by the AI layer, with a deterministic fallback). */
  explanation: string;
}

/** Signed proof that the Guardian approved exactly this purchase. Verified before any PayPal order is created. */
export interface Receipt {
  payload: {
    v: 1;
    proposalId: string;
    mandateId: string;
    mandateHash: string;
    productId?: string;
    title: string;
    price: number;
    currency: string;
    verdict: "approve" | "approve_after_human";
    findingsHash: string;
    issuedAt: string;
  };
  /** Ed25519 signature over the canonical payload, base64. */
  signature: string;
  keyId: string;
}

export type PaymentStatus =
  | "proposed"
  | "approved"
  | "blocked"
  | "awaiting_human"
  | "awaiting_paypal"
  | "capture_pending"
  | "refund_pending"
  | "authorized"
  | "captured"
  | "voided"
  | "reconciled"
  | "alert"
  | "refunded";

/** One row per proposal: mandate -> decision -> payment -> reconciliation. Feeds the AG Grid dashboard. */
export interface AuditRecord {
  proposal: Proposal;
  decision?: Decision;
  receipt?: Receipt;
  status: PaymentStatus;
  paypal?: {
    orderId?: string;
    intent?: "AUTHORIZE" | "CAPTURE";
    approveUrl?: string;
    returnState?: string;
    captureStatus?: string;
    refundStatus?: string;
    chargedCurrency?: string;
    capturedAt?: string;
    authorizationId?: string;
    captureId?: string;
    refundId?: string;
    charged?: number;
  };
  reconciliation?: {
    match: boolean;
    detail: string;
    source?: "paypal_capture" | "simulated";
    /** A second reading of the same capture through PayPal's official SDK. `agrees: null` means it could not be read. */
    crossCheck?: { source: "paypal_server_sdk"; agrees: boolean | null; detail: string };
  };
  demo?: { simulated: true; charged: number };
  createdAt?: string;
  updatedAt: string;
}
