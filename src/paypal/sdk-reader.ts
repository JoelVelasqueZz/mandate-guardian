import { ApiError, Client, Environment, PaymentsController } from "@paypal/paypal-server-sdk";
import type { AuditRecord } from "../types.js";

/**
 * A second, independent reading of a PayPal capture.
 *
 * The app's own client (`client.ts`, plain fetch) is the one that moves money and records what was charged.
 * This reader uses PayPal's official Server SDK, a different code path with its own parsing, to read the same
 * capture again. Reconciliation then compares the two. If they disagree, something is wrong with a parser, a
 * proxy or the record, and the Guardian raises an alert instead of trusting either one.
 *
 * It only reads. It cannot create, capture, void or refund anything, and it is Sandbox only.
 */
export interface SdkCaptureReading {
  captureId?: string;
  status?: string;
  amount?: number;
  currency?: string;
  orderId?: string;
}

export interface SdkReader {
  readCapture(captureId: string): Promise<SdkCaptureReading>;
}

export class PayPalSdkReader implements SdkReader {
  private payments: PaymentsController;

  constructor(clientId: string, clientSecret: string) {
    const client = new Client({
      clientCredentialsAuthCredentials: { oAuthClientId: clientId, oAuthClientSecret: clientSecret },
      environment: Environment.Sandbox, // never production
      timeout: 15_000,
    });
    this.payments = new PaymentsController(client);
  }

  async readCapture(captureId: string): Promise<SdkCaptureReading> {
    let result;
    try {
      ({ result } = await this.payments.getCapturedPayment({ captureId }));
    } catch (e) {
      // The SDK's errors can have an empty message; say what PayPal answered instead.
      if (e instanceof ApiError) throw new Error(`PayPal answered ${e.statusCode} for this capture`);
      throw e;
    }
    return {
      captureId: result.id,
      status: result.status,
      amount: result.amount ? Number(result.amount.value) : undefined,
      currency: result.amount?.currencyCode,
      orderId: result.supplementaryData?.relatedIds?.orderId,
    };
  }
}

/** Undefined when there are no Sandbox credentials, when the base URL is not Sandbox, or when it is switched off. */
export function sdkReaderFromEnv(env: NodeJS.ProcessEnv = process.env): SdkReader | undefined {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) return undefined;
  if (env.PAYPAL_BASE_URL && !env.PAYPAL_BASE_URL.includes("sandbox")) return undefined;
  if (env.PAYPAL_SDK_CROSSCHECK === "false") return undefined;
  return new PayPalSdkReader(env.PAYPAL_CLIENT_ID, env.PAYPAL_CLIENT_SECRET);
}

export type CrossCheck = NonNullable<NonNullable<AuditRecord["reconciliation"]>["crossCheck"]>;

/** Compares the SDK's reading with what the app's own client recorded. Pure, so it is easy to test. */
export function compareReadings(record: AuditRecord, reading: SdkCaptureReading): CrossCheck {
  const problems: string[] = [];
  const paypal = record.paypal;
  if (reading.status !== "COMPLETED") problems.push(`the SDK sees status ${reading.status ?? "unknown"}, not COMPLETED`);
  if (paypal?.charged !== undefined && reading.amount !== undefined && Math.abs(reading.amount - paypal.charged) > 0.001) {
    problems.push(`the SDK sees ${reading.amount} but the app recorded ${paypal.charged}`);
  }
  if (paypal?.chargedCurrency && reading.currency && reading.currency !== paypal.chargedCurrency) {
    problems.push(`the SDK sees ${reading.currency} but the app recorded ${paypal.chargedCurrency}`);
  }
  if (paypal?.orderId && reading.orderId && reading.orderId !== paypal.orderId) {
    problems.push(`the SDK links this capture to order ${reading.orderId}, not ${paypal.orderId}`);
  }
  if (problems.length) {
    return { source: "paypal_server_sdk", agrees: false, detail: `The two readings of PayPal disagree: ${problems.join("; ")}.` };
  }
  return {
    source: "paypal_server_sdk",
    agrees: true,
    detail: `PayPal's official SDK read the same capture: ${reading.amount} ${reading.currency}, ${reading.status}.`,
  };
}

/** Reads through the SDK and compares. A failed read is reported as unavailable, never as a disagreement. */
export async function secondReading(reader: SdkReader, record: AuditRecord): Promise<CrossCheck> {
  const captureId = record.paypal?.captureId;
  if (!captureId) return { source: "paypal_server_sdk", agrees: null, detail: "No capture id to read." };
  try {
    return compareReadings(record, await reader.readCapture(captureId));
  } catch (e) {
    return {
      source: "paypal_server_sdk",
      agrees: null,
      detail: `The SDK reading was not available (${e instanceof Error ? e.message : String(e)}); the app's own reading stands.`,
    };
  }
}
