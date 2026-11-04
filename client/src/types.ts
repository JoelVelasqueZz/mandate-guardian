export interface Mandate {
  id: string;
  goal: string;
  currency: string;
  maxPerPurchase: number;
  maxMonthly: number;
  allowedCategories?: string[];
  deliverBy?: string;
  requireHumanAbove?: number;
}

export interface Proposal {
  id: string;
  mandateId: string;
  productId?: string;
  title: string;
  seller?: string;
  category?: string;
  price: number;
  listedPrice?: number;
  currency: string;
  estimatedDelivery?: string;
  url?: string;
  reasoning: string;
}

export type Verdict = "approve" | "block" | "ask_human";

export interface Finding {
  rule: string;
  ok: boolean;
  detail: string;
}

export interface Decision {
  proposalId: string;
  verdict: Verdict;
  findings: Finding[];
  explanation: string;
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

export interface AuditRecord {
  proposal: Proposal;
  decision?: Decision;
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
  };
  demo?: {
    simulated: true;
    charged: number;
  };
  createdAt?: string;
  updatedAt: string;
}

export interface SystemHealth {
  ok: boolean;
  catalog: "channel3" | "demo";
  ai: boolean;
}

