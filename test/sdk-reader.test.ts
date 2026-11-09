import { describe, it, expect } from "vitest";
import { CaptureStatus } from "@paypal/paypal-server-sdk";
import { compareReadings, describeStatus, normalizeCapture, PayPalSdkReader, sdkReaderFromEnv, secondReading } from "../src/paypal/sdk-reader.js";
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

  it("treats a thin capture as an unavailable reading, never as agreement or an alert", () => {
    expect(() => normalizeCapture({})).toThrow("without a status or an amount");
    expect(() => normalizeCapture({ status: CaptureStatus.Completed })).toThrow("without a status or an amount");
    expect(() => normalizeCapture({ status: CaptureStatus.Completed, amount: { currencyCode: "USD", value: "abc" } })).toThrow("unreadable amount");
  });

  it("reads status, amount, currency and order from a complete capture", () => {
    expect(normalizeCapture({
      id: "CAP1", status: CaptureStatus.Completed, amount: { currencyCode: "USD", value: "17.99" },
      supplementaryData: { relatedIds: { orderId: "ORDER1" } },
    })).toEqual({ captureId: "CAP1", status: "COMPLETED", amount: 17.99, currency: "USD", orderId: "ORDER1" });
  });

  it("says whose fault an error status is", () => {
    expect(describeStatus(401)).toContain("this app's credentials");
    expect(describeStatus(403)).toContain("this app's credentials");
    expect(describeStatus(404)).toContain("no capture with this id");
    expect(describeStatus(503)).toContain("503");
  });

  it("reports an unreadable capture as unavailable through the second reading", async () => {
    const reader = { readCapture: async () => normalizeCapture({}) };
    expect(await secondReading(reader, recorded)).toMatchObject({ agrees: null, source: "paypal_server_sdk" });
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
