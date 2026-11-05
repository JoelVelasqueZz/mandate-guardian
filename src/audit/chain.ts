import { createHash } from "node:crypto";

/** JSON with sorted keys, so the same data always hashes the same. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export interface AuditEvent {
  seq: number;
  at: string;
  proposalId: string;
  type: string;
  detail: string;
  data?: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface ChainCheck {
  ok: boolean;
  length: number;
  headHash: string;
  /** Sequence number of the first event that does not match its hash or its predecessor. */
  brokenAt?: number;
}

const GENESIS = "0".repeat(64);

/**
 * Append-only log where every event carries the hash of the one before it.
 * Editing, deleting or reordering any event breaks every hash after it, and verify() reports where.
 * It is held in memory like the rest of the store: it detects tampering, it is not durable storage.
 */
export class AuditChain {
  readonly events: AuditEvent[] = [];

  get headHash(): string {
    return this.events.at(-1)?.hash ?? GENESIS;
  }

  append(proposalId: string, type: string, detail: string, data?: Record<string, unknown>, now = new Date()): AuditEvent {
    const base = { seq: this.events.length, at: now.toISOString(), proposalId, type, detail, data };
    const prevHash = this.headHash;
    const event: AuditEvent = { ...base, prevHash, hash: sha256(prevHash + canonical(base)) };
    this.events.push(event);
    return event;
  }

  forProposal(proposalId: string): AuditEvent[] {
    return this.events.filter((e) => e.proposalId === proposalId);
  }

  verify(): ChainCheck {
    let prev = GENESIS;
    for (const e of this.events) {
      const { prevHash, hash, ...base } = e;
      if (prevHash !== prev || hash !== sha256(prev + canonical(base))) {
        return { ok: false, length: this.events.length, headHash: this.headHash, brokenAt: e.seq };
      }
      prev = hash;
    }
    return { ok: true, length: this.events.length, headHash: this.headHash };
  }
}
