import type { Request, Response } from "express";
import { z } from "zod";

/**
 * Gemini turn proxy for the AG Studio assistant.
 *
 * The browser-side adapter sends one conversation turn (history, instructions, tool schemas). This module
 * turns it into a Gemini `generateContent` call and returns plain text plus any tool calls. The API key and
 * the model stay on the server, and the client cannot pick another model.
 *
 * The assistant only reads dashboard data. It cannot reach the payment routes: those need the demo key and
 * a Guardian receipt, and the tools Studio gives the agent only query and arrange widgets in the browser.
 */

const MAX_TOOLS = 40;

const ItemSchema = z.object({
  type: z.string(),
  kind: z.string().optional(),
  role: z.string().optional(),
  callId: z.string().optional(),
  name: z.string().optional(),
  arguments: z.string().optional(),
  output: z.string().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional(), refusal: z.string().optional() }).passthrough()).optional(),
}).passthrough();

export const TurnRequestSchema = z.object({
  instructions: z.string().max(60_000).optional(),
  input: z.array(ItemSchema).max(400),
  tools: z.array(z.object({
    name: z.string().min(1).max(64),
    description: z.string().max(4_000).default(""),
    parameters: z.unknown().optional(),
  })).max(MAX_TOOLS).optional(),
  toolChoice: z.union([z.enum(["auto", "none", "required"]), z.object({ name: z.string() })]).optional(),
  json: z.boolean().optional(),
  /** Gemini's thought signatures for tool calls it made earlier, keyed by call id. They must be sent back. */
  signatures: z.record(z.string()).optional(),
});
export type TurnRequest = z.infer<typeof TurnRequestSchema>;

export interface TurnToolCall { name: string; args: Record<string, unknown>; thoughtSignature?: string }
export interface TurnResult { text: string; calls: TurnToolCall[]; finishReason?: string }

type Part = { text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: { name: string; response: Record<string, unknown> }; thoughtSignature?: string };
type Content = { role: "user" | "model"; parts: Part[] };

const MAX_REF_DEPTH = 6;
const MISSING_SIGNATURE = "skip_thought_signature_validator";

/**
 * Studio describes tool arguments with `$ref` pointers into `$defs`, which Gemini does not follow. Copy each
 * definition in place. A definition that contains itself (an expression inside an expression) is cut off after
 * a few levels, since Gemini cannot express recursion either.
 */
export function inlineRefs(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const root = schema as Record<string, unknown>;
  const defs = { ...((root.$defs as Record<string, unknown>) ?? {}), ...((root.definitions as Record<string, unknown>) ?? {}) };
  const walk = (node: unknown, stack: string[]): unknown => {
    if (Array.isArray(node)) return node.map((n) => walk(n, stack));
    if (!node || typeof node !== "object") return node;
    const obj = node as Record<string, unknown>;
    if (typeof obj.$ref === "string") {
      const name = obj.$ref.split("/").pop() ?? "";
      const target = defs[name];
      if (!target || typeof target !== "object" || stack.length >= MAX_REF_DEPTH || stack.includes(name)) {
        return { type: "object", description: "A nested structure of the same kind as the one above." };
      }
      const { $ref: _ref, ...rest } = obj;
      return walk({ ...(target as object), ...rest }, [...stack, name]);
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === "$defs" || key === "definitions") continue;
      out[key] = walk(value, stack);
    }
    return out;
  };
  return walk(root, []);
}

const SCHEMA_KEYS = new Set(["type", "format", "description", "nullable", "enum", "properties", "required", "items", "minimum", "maximum", "minItems", "maxItems", "anyOf", "propertyOrdering"]);

/** Gemini accepts a subset of JSON Schema. Drop what it rejects and rewrite what it can express differently. */
export function sanitizeSchema(schema: unknown): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return undefined;
  const src = { ...(schema as Record<string, unknown>) };
  if ("const" in src) { src.enum = [src.const]; delete src.const; }
  if (Array.isArray(src.oneOf)) { src.anyOf = src.oneOf; delete src.oneOf; }
  if (Array.isArray(src.type)) {
    const types = (src.type as unknown[]).filter((t) => t !== "null");
    if (types.length !== src.type.length) src.nullable = true;
    src.type = types[0] ?? "string";
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (!SCHEMA_KEYS.has(key)) continue;
    if (key === "properties" && value && typeof value === "object") {
      const props: Record<string, unknown> = {};
      for (const [name, prop] of Object.entries(value as Record<string, unknown>)) {
        const clean = sanitizeSchema(prop);
        if (clean) props[name] = clean;
      }
      out.properties = props;
    } else if (key === "items") {
      const clean = sanitizeSchema(value);
      if (clean) out.items = clean;
    } else if (key === "anyOf" && Array.isArray(value)) {
      const list = value.map(sanitizeSchema).filter(Boolean);
      if (list.length) out.anyOf = list;
    } else {
      out[key] = value;
    }
  }
  if (out.type === "object" && Array.isArray(out.required) && out.properties) {
    out.required = (out.required as string[]).filter((r) => r in (out.properties as object));
  }
  return out;
}

function asObject(text: string | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    return { result: text };
  }
}

/** Studio's conversation items to Gemini `contents`. Consecutive items of one role share a content. */
export function toContents(input: TurnRequest["input"], signatures: Record<string, string> = {}): Content[] {
  const nameByCall = new Map<string, string>();
  const contents: Content[] = [];
  const push = (role: Content["role"], part: Part) => {
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(part);
    else contents.push({ role, parts: [part] });
  };
  for (const item of input) {
    if (item.type === "message") {
      const text = (item.content ?? []).map((c) => c.text ?? c.refusal ?? "").join("").trim();
      if (!text) continue;
      push(item.kind === "output" || item.role === "assistant" ? "model" : "user", { text });
    } else if (item.type === "function_call" && item.name) {
      if (item.callId) nameByCall.set(item.callId, item.name);
      const part: Part = { functionCall: { name: item.name, args: asObject(item.arguments) } };
      const signature = item.callId ? signatures[item.callId] : undefined;
      if (signature) part.thoughtSignature = signature;
      push("model", part);
    } else if (item.type === "function_call_output") {
      const name = (item.callId && nameByCall.get(item.callId)) || "tool";
      push("user", { functionResponse: { name, response: asObject(item.output) } });
    }
    // Reasoning items are not sent back; Gemini keeps its own thinking.
  }
  // Gemini 3 rejects a history whose first tool call in a model turn has no thought signature. When ours was lost
  // (a reloaded page, a delegated run), Google documents this placeholder as the way to continue.
  for (const content of contents) {
    if (content.role !== "model") continue;
    const first = content.parts.find((p) => p.functionCall);
    if (first && !first.thoughtSignature) first.thoughtSignature = MISSING_SIGNATURE;
  }
  if (!contents.length || contents[0].role !== "user") contents.unshift({ role: "user", parts: [{ text: "Hello." }] });
  return contents;
}

export function buildGeminiBody(req: TurnRequest) {
  const declarations = (req.tools ?? []).map((t) => {
    const parameters = sanitizeSchema(inlineRefs(t.parameters));
    const hasProps = parameters && parameters.properties && Object.keys(parameters.properties as object).length > 0;
    return { name: t.name, description: t.description || t.name, ...(hasProps ? { parameters } : {}) };
  });
  const body: Record<string, unknown> = {
    contents: toContents(req.input, req.signatures),
    generationConfig: { temperature: 0.2, maxOutputTokens: 4096, ...(req.json ? { responseMimeType: "application/json" } : {}) },
  };
  if (req.instructions) body.systemInstruction = { parts: [{ text: req.instructions }] };
  if (declarations.length && req.toolChoice !== "none") {
    body.tools = [{ functionDeclarations: declarations }];
    const choice = req.toolChoice;
    const config: Record<string, unknown> =
      choice === "required" ? { mode: "ANY" }
      : choice && typeof choice === "object" ? { mode: "ANY", allowedFunctionNames: [choice.name] }
      : { mode: "AUTO" };
    body.toolConfig = { functionCallingConfig: config };
  }
  return body;
}

export function parseGeminiResponse(data: unknown): TurnResult {
  const candidate = (data as { candidates?: { content?: { parts?: (Part & { thought?: boolean })[] }; finishReason?: string }[] })?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("");
  const calls = parts
    .filter((p) => p.functionCall)
    .map((p) => ({ name: p.functionCall!.name, args: p.functionCall!.args ?? {}, ...(p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {}) }));
  return { text, calls, finishReason: candidate?.finishReason };
}

export interface AiTurnDeps {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/** Express handler for `POST /api/ai/turn`. Put the demo-key gate and a rate limit in front of it. */
export function createAiTurnHandler(deps: AiTurnDeps) {
  const doFetch = deps.fetchImpl ?? fetch;
  return async (req: Request, res: Response) => {
    if (!deps.apiKey || !deps.model) {
      return res.status(503).json({ error: "The AI model is not configured on this server (set AI_API_KEY and AI_MODEL)." });
    }
    const parsed = TurnRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid assistant request.", details: parsed.error.flatten() });
    try {
      const base = deps.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
      const upstream = await doFetch(`${base}/models/${deps.model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": deps.apiKey },
        body: JSON.stringify(buildGeminiBody(parsed.data)),
        signal: AbortSignal.timeout(60_000),
      });
      const text = await upstream.text();
      if (!upstream.ok) {
        // Pass on Gemini's own message, which never contains the key, but keep it short.
        return res.status(502).json({ error: `The model returned ${upstream.status}: ${text.slice(0, 240)}` });
      }
      res.json(parseGeminiResponse(JSON.parse(text)));
    } catch (e) {
      res.status(502).json({ error: `The model could not be reached: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
}
