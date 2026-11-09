import { describe, it, expect, vi } from "vitest";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { buildGeminiBody, createAiTurnHandler, inlineRefs, parseGeminiResponse, sanitizeSchema, toContents, TurnRequestSchema } from "../src/ai-turn.js";
import { demoKeyGate } from "../src/paypal/routes.js";

const user = (text: string) => ({ type: "message", kind: "input", role: "user", content: [{ type: "text", text }] });

describe("Studio assistant: schema and conversation mapping", () => {
  it("drops what Gemini rejects and keeps what it understands", () => {
    const clean = sanitizeSchema({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      additionalProperties: false,
      required: ["field", "ghost"],
      properties: {
        field: { type: ["string", "null"], description: "A field", default: "x" },
        mode: { const: "sum" },
        rows: { type: "array", items: { type: "object", additionalProperties: false, properties: { n: { type: "number" } } } },
        either: { oneOf: [{ type: "string" }, { type: "number" }] },
      },
    }) as any;
    expect(clean.additionalProperties).toBeUndefined();
    expect(clean.$schema).toBeUndefined();
    expect(clean.required).toEqual(["field"]); // a required name with no property would be rejected
    expect(clean.properties.field).toEqual({ type: "string", nullable: true, description: "A field" });
    expect(clean.properties.mode.enum).toEqual(["sum"]);
    expect(clean.properties.rows.items.additionalProperties).toBeUndefined();
    expect(clean.properties.either.anyOf).toHaveLength(2);
  });

  it("copies $ref definitions in place and cuts recursive ones off", () => {
    const schema = {
      type: "object",
      properties: { query: { $ref: "#/$defs/Query" } },
      $defs: {
        Field: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        Query: { type: "object", properties: { field: { $ref: "#/$defs/Field" }, child: { $ref: "#/$defs/Query" } } },
      },
    };
    const out = sanitizeSchema(inlineRefs(schema)) as any;
    expect(JSON.stringify(out)).not.toContain("$ref");
    expect(out.properties.query.properties.field.properties.id.type).toBe("string");
    expect(out.properties.query.properties.field.required).toEqual(["id"]);
    // The query that contains itself stops being expanded instead of recursing forever.
    expect(out.properties.query.properties.child.type).toBe("object");
    expect(out.properties.query.properties.child.properties).toBeUndefined();
  });

  it("maps the conversation and joins consecutive tool results into one turn", () => {
    const contents = toContents([
      user("How much did the Guardian stop?"),
      { type: "function_call", kind: "output", callId: "c1", name: "executeQuery", arguments: '{"q":1}' },
      { type: "function_call", kind: "output", callId: "c2", name: "viewSchema", arguments: "{}" },
      { type: "function_call_output", callId: "c1", output: '{"rows":[1]}' },
      { type: "function_call_output", callId: "c2", output: "plain text" },
      { type: "reasoning", kind: "output", summary: [] },
      { type: "message", kind: "output", role: "assistant", content: [{ type: "text", text: "Done." }] },
    ] as never, { c1: "sig-1" });
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user", "model"]);
    expect(contents[1].parts[0]).toMatchObject({ functionCall: { name: "executeQuery", args: { q: 1 } }, thoughtSignature: "sig-1" });
    expect(contents[1].parts[1].thoughtSignature).toBeUndefined();
    // A tool call whose signature was lost gets Google's documented placeholder instead of a 400.
    const lost = toContents([user("q"), { type: "function_call", kind: "output", callId: "x", name: "t", arguments: "{}" }] as never);
    expect(lost[1].parts[0].thoughtSignature).toBe("skip_thought_signature_validator");
    expect(contents[2].parts).toEqual([
      { functionResponse: { name: "executeQuery", response: { rows: [1] } } },
      { functionResponse: { name: "viewSchema", response: { result: "plain text" } } },
    ]);
  });

  it("builds the request with the tool choice and no empty parameter objects", () => {
    const body = buildGeminiBody(TurnRequestSchema.parse({
      instructions: "Be brief.",
      input: [user("hi")],
      tools: [{ name: "noArgs", description: "d", parameters: { type: "object", properties: {} } }, { name: "withArgs", description: "d", parameters: { type: "object", properties: { a: { type: "string" } } } }],
      toolChoice: { name: "withArgs" },
    })) as any;
    expect(body.systemInstruction.parts[0].text).toBe("Be brief.");
    expect(body.tools[0].functionDeclarations[0].parameters).toBeUndefined();
    expect(body.tools[0].functionDeclarations[1].parameters.properties.a.type).toBe("string");
    expect(body.toolConfig.functionCallingConfig).toEqual({ mode: "ANY", allowedFunctionNames: ["withArgs"] });
    expect(buildGeminiBody(TurnRequestSchema.parse({ input: [user("x")], tools: [{ name: "t", description: "d" }], toolChoice: "none" })) as any).not.toHaveProperty("tools");
  });

  it("reads text and tool calls from a Gemini reply and ignores thinking text", () => {
    const out = parseGeminiResponse({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "hidden", thought: true }, { text: "Hello" }, { functionCall: { name: "t", args: { a: 1 } }, thoughtSignature: "s" }] } }],
    });
    expect(out).toEqual({ text: "Hello", calls: [{ name: "t", args: { a: 1 }, thoughtSignature: "s" }], finishReason: "STOP" });
  });
});

describe("Studio assistant: the route", () => {
  async function serve(deps: Parameters<typeof createAiTurnHandler>[0], env: NodeJS.ProcessEnv = { DEMO_API_KEY: "secret-key" }) {
    const app = express();
    app.use(express.json());
    app.post("/ai", demoKeyGate(env), createAiTurnHandler(deps));
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (body: unknown, key?: string) => {
      const res = await fetch(`${base}/ai`, { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
    return { call, close: () => server.close() };
  }

  it("needs the demo key, then calls Gemini with the server's key and model", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 }));
    const { call, close } = await serve({ apiKey: "server-key", model: "gemini-test", fetchImpl: fetchImpl as never });
    try {
      expect((await call({ input: [user("hi")] })).status).toBe(401);
      expect(fetchImpl).not.toHaveBeenCalled();
      const ok = await call({ input: [user("hi")], model: "attacker-model" }, "secret-key");
      expect(ok.status).toBe(200);
      expect(ok.body.text).toBe("ok");
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toContain("/models/gemini-test:generateContent");
      expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("server-key");
    } finally { close(); }
  });

  it("rejects malformed requests and reports a missing model or an upstream failure", async () => {
    const failing = vi.fn(async () => new Response("quota exceeded", { status: 429 }));
    const a = await serve({ apiKey: "k", model: "m", fetchImpl: failing as never });
    try {
      expect((await a.call({ input: "not a list" }, "secret-key")).status).toBe(400);
      const upstream = await a.call({ input: [user("hi")] }, "secret-key");
      expect(upstream.status).toBe(502);
      expect(upstream.body.error).toContain("429");
    } finally { a.close(); }
    const b = await serve({});
    try {
      expect((await b.call({ input: [user("hi")] }, "secret-key")).status).toBe(503);
    } finally { b.close(); }
  });
});
