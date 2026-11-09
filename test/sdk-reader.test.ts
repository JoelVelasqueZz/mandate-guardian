import { describe, it, expect } from "vitest";
import { compareReadings, PayPalSdkReader, sdkReaderFromEnv } from "../src/paypal/sdk-reader.js";
import type { AuditRecord } from "../src/types.js";

const record = (paypal: AuditRecord["paypal"]): AuditRecord => ({
  proposal: { id: "p1", mandateId: "m1", title: "Mug", price: 10, currency: "USD", reasoning: "" },
  status: "captured",
  paypal,
  updatedAt: "",
});

describe("Second reading of a capture through PayPal's SDK", () => {
  const recorded = record({ orderId: "ORDER1", captureId: "CAP1", charged: 10, chargedCurrency: "USD" });

  it("agrees when status, amount, currency and order all match", () => {
    expect(compareReadings(recorded, { captureId: "CAP1", status: "COMPLETED", amount: 10, currency: "USD", orderId: "ORDER1" }))
      .toMatchObject({ agrees: true, source: "paypal_server_sdk" });
  });

  it("names every field that differs", () => {
    const out = compareReadings(recorded, { status: "PENDING", amount: 12.5, currency: "EUR", orderId: "OTHER" });
    expect(out.agrees).toBe(false);
    for (const word of ["PENDING", "12.5", "EUR", "OTHER"]) expect(out.detail).toContain(word);
  });

  it("does not fail on fields the SDK did not return", () => {
    expect(compareReadings(recorded, { status: "COMPLETED" }).agrees).toBe(true);
  });

  it("is created only for Sandbox credentials and can be switched off", () => {
    const base = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" } as NodeJS.ProcessEnv;
    expect(sdkReaderFromEnv({})).toBeUndefined();
    expect(sdkReaderFromEnv({ PAYPAL_CLIENT_ID: "id" })).toBeUndefined();
    expect(sdkReaderFromEnv({ ...base, PAYPAL_BASE_URL: "https://api-m.paypal.com" })).toBeUndefined(); // production: refused
    expect(sdkReaderFromEnv({ ...base, PAYPAL_SDK_CROSSCHECK: "false" })).toBeUndefined();
    expect(sdkReaderFromEnv({ ...base, PAYPAL_BASE_URL: "https://api-m.sandbox.paypal.com" })).toBeInstanceOf(PayPalSdkReader);
    expect(sdkReaderFromEnv(base)).toBeInstanceOf(PayPalSdkReader);
  });
});
