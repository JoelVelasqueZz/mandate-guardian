import type { AgAiEvent, AgAiOutputItem, AgLlmAdapter, AgLlmRequest, AgLlmResponse } from "ag-studio";

interface TurnReply {
  text: string;
  calls: { name: string; args: Record<string, unknown>; thoughtSignature?: string }[];
  finishReason?: string;
}

/** Gemini asks for its "thought signature" back when we return a tool result, so we keep them by call id. */
const signatures = new Map<string, string>();

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);

interface AdapterOptions {
  /** The server route that holds the Gemini key, for example `/api/ai/turn`. */
  endpoint: string;
  /** Read at call time, so a key set after the page loaded is used. */
  getDemoKey: () => string;
}

/**
 * AG Studio's LLM adapter for Gemini. The browser never sees the model key: each turn is posted to our own
 * server, which calls Gemini and answers with text and tool calls. Studio runs the tools itself, in the
 * browser, against the dashboard data.
 */
export function geminiAdapter({ endpoint, getDemoKey }: AdapterOptions): AgLlmAdapter {
  return {
    executeTurn(request: AgLlmRequest, options) {
      const callIds = new Set(
        request.input.flatMap((item) => ("callId" in item && typeof item.callId === "string" ? [item.callId] : [])),
      );
      const known = Object.fromEntries([...callIds].flatMap((id) => (signatures.has(id) ? [[id, signatures.get(id)!]] : [])));
      const json = request.responseFormat.type === "json";
      const instructions = json
        ? `${request.instructions ?? ""}\n\nReply with JSON only, matching this schema: ${JSON.stringify((request.responseFormat as { schema: unknown }).schema)}`
        : request.instructions;

      const turn: Promise<{ reply?: TurnReply; error?: string }> = (async () => {
        try {
          const key = getDemoKey();
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
            signal: options?.signal,
            body: JSON.stringify({
              instructions,
              input: request.input,
              tools: (request.tools ?? []).filter((t) => !t.kind || t.kind === "client").map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
              toolChoice: request.toolChoice,
              json,
              signatures: known,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.status === 401) return { error: "Set the demo key (Set key, top right) to use the assistant." };
          if (!res.ok) return { error: typeof data?.error === "string" ? data.error : "The assistant could not answer." };
          // Remember the signatures as soon as the reply arrives, whether or not Studio reads the event stream.
          const reply = data as TurnReply;
          reply.calls = reply.calls.map((call) => ({ ...call, args: repairArgs(call.name, call.args) }));
          reply.calls.forEach((call, index) => call.thoughtSignature && signatures.set(callIdFor(reply, index), call.thoughtSignature));
          return { reply };
        } catch (e) {
          if (options?.signal?.aborted) return { error: "Cancelled." };
          return { error: e instanceof Error ? e.message : "The assistant could not be reached." };
        }
      })();

      async function* stream(): AsyncGenerator<AgAiEvent> {
        const { reply, error } = await turn;
        if (error || !reply) throw new Error(error ?? "The assistant returned nothing.");
        if (reply.text) {
          const messageId = uid();
          yield { type: "TEXT_MESSAGE_START", messageId, role: "assistant" };
          yield { type: "TEXT_MESSAGE_CONTENT", messageId, delta: reply.text };
          yield { type: "TEXT_MESSAGE_END", messageId };
        }
        for (const [index, call] of reply.calls.entries()) {
          const toolCallId = callIdFor(reply, index);
          yield { type: "TOOL_CALL_START", toolCallId, toolCallName: call.name };
          yield { type: "TOOL_CALL_ARGS", toolCallId, delta: JSON.stringify(call.args ?? {}) };
          yield { type: "TOOL_CALL_END", toolCallId };
        }
      }

      const complete = turn.then(({ reply, error }): AgLlmResponse => {
        if (error || !reply) {
          return { id: uid(), createdAt: Date.now(), output: [], status: "failed", error: { code: "assistant_error", message: error ?? "No answer." } };
        }
        const output: AgAiOutputItem[] = [];
        if (reply.text) {
          output.push({ id: uid(), kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: reply.text, annotations: [] }] });
        }
        reply.calls.forEach((call, index) => {
          const callId = callIdFor(reply, index);
          output.push({ id: uid(), kind: "output", type: "function_call", callId, name: call.name, arguments: JSON.stringify(call.args ?? {}), status: "completed" });
        });
        return { id: uid(), createdAt: Date.now(), output, status: reply.finishReason === "MAX_TOKENS" ? "incomplete" : "completed" };
      });

      return { stream: stream(), complete };
    },
  };
}

/**
 * Studio's `delegate_to` names its target as an object, `{ type: { id: "page" } }`. Gemini tends to flatten that
 * to `{ type: "page" }`, which Studio rejects with "no target agent specified" on every retry. Put it back.
 */
function repairArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name === "delegate_to" && typeof args.type === "string") return { ...args, type: { id: args.type } };
  return args;
}

// Stable ids per reply, so the streamed events and the final response name each call the same way.
const ids = new WeakMap<TurnReply, string[]>();
function callIdFor(reply: TurnReply, index: number): string {
  let list = ids.get(reply);
  if (!list) ids.set(reply, (list = reply.calls.map(() => `call-${uid()}`)));
  return list[index];
}
