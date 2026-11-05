import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { canonical, sha256 } from "../audit/chain.js";
import type { AuditRecord, Mandate, Receipt } from "../types.js";

/** Hash of the rules the user set. A receipt is only valid for the mandate it was issued under. */
export function mandateHash(mandate: Mandate): string {
  const { goal, currency, maxPerPurchase, maxMonthly, allowedCategories, deliverBy, requireHumanAbove } = mandate;
  return sha256(canonical({ goal, currency, maxPerPurchase, maxMonthly, allowedCategories, deliverBy, requireHumanAbove }));
}

/**
 * Signs the Guardian's approvals with Ed25519. The payment route asks for a valid receipt before it
 * creates a PayPal order, so a proposal that was never approved (or was edited after approval) cannot be paid.
 *
 * Honest scope: the key lives in the same server process as the rest of the app. This enforces that the
 * approval step happened and that the approved fields were not changed afterwards. It is not a separate
 * trust domain.
 */
export class ReceiptSigner {
  readonly publicKeyPem: string;
  readonly keyId: string;
  /** True when no GUARDIAN_SIGNING_KEY was set: the key is new on every start, so old receipts stop verifying. */
  readonly ephemeral: boolean;
  private privateKey: KeyObject;
  private publicKey: KeyObject;

  constructor(privateKeyPem?: string) {
    this.ephemeral = !privateKeyPem;
    if (privateKeyPem) {
      this.privateKey = createPrivateKey(privateKeyPem.replace(/\\n/g, "\n"));
      this.publicKey = createPublicKey(this.privateKey);
    } else {
      const pair = generateKeyPairSync("ed25519");
      this.privateKey = pair.privateKey;
      this.publicKey = pair.publicKey;
    }
    this.publicKeyPem = this.publicKey.export({ type: "spki", format: "pem" }).toString();
    this.keyId = sha256(this.publicKey.export({ type: "spki", format: "der" }).toString("base64")).slice(0, 16);
  }

  issue(mandate: Mandate, record: AuditRecord, humanConfirmed: boolean, now = new Date()): Receipt {
    const { proposal, decision } = record;
    const payload: Receipt["payload"] = {
      v: 1,
      proposalId: proposal.id,
      mandateId: mandate.id,
      mandateHash: mandateHash(mandate),
      productId: proposal.productId,
      title: proposal.title,
      price: proposal.price,
      currency: proposal.currency,
      verdict: humanConfirmed ? "approve_after_human" : "approve",
      findingsHash: sha256(canonical((decision?.findings ?? []).map((f) => ({ rule: f.rule, ok: f.ok })))),
      issuedAt: now.toISOString(),
    };
    const signature = sign(null, Buffer.from(canonical(payload)), this.privateKey).toString("base64");
    return { payload, signature, keyId: this.keyId };
  }

  /** True when the signature matches the payload under this server's key. */
  verifySignature(receipt: Receipt): boolean {
    try {
      return receipt.keyId === this.keyId && verify(null, Buffer.from(canonical(receipt.payload)), this.publicKey, Buffer.from(receipt.signature, "base64"));
    } catch {
      return false;
    }
  }

  /**
   * Returns why a record may not be paid, or undefined when its receipt is valid and still matches
   * the proposal and the mandate as they are now.
   */
  checkRecord(record: AuditRecord, mandate: Mandate | undefined): string | undefined {
    const receipt = record.receipt;
    if (!receipt) return "No Guardian receipt: this proposal was never approved by the Guardian.";
    if (!this.verifySignature(receipt)) return "The Guardian receipt signature is not valid.";
    const p = receipt.payload;
    const proposal = record.proposal;
    if (p.proposalId !== proposal.id) return "The receipt belongs to a different proposal.";
    if (p.price !== proposal.price || p.currency !== proposal.currency || p.productId !== proposal.productId || p.title !== proposal.title) {
      return "The proposal changed after the Guardian approved it.";
    }
    if (!mandate || p.mandateId !== mandate.id || p.mandateHash !== mandateHash(mandate)) {
      return "The mandate changed after the Guardian approved this proposal.";
    }
    if (record.decision?.verdict === "ask_human" && p.verdict !== "approve_after_human") {
      return "This proposal needed a human confirmation that is not on the receipt.";
    }
    return undefined;
  }
}

export function signerFromEnv(env = process.env): ReceiptSigner {
  return new ReceiptSigner(env.GUARDIAN_SIGNING_KEY || undefined);
}
