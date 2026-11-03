/** Provider-agnostic text model. The reviewer only needs "prompt in, JSON text out". */
export interface LlmClient {
  generateJson(input: { system: string; user: string }): Promise<string>;
}

export interface GeminiConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Gemini REST client (AI Studio key), plain fetch like the PayPal client.
 * Docs: https://ai.google.dev/api/generate-content
 * Not yet verified against the live API; unit tests use a fake LlmClient.
 */
export class GeminiClient implements LlmClient {
  constructor(private cfg: GeminiConfig) {}

  async generateJson({ system, user }: { system: string; user: string }): Promise<string> {
    const base = this.cfg.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    const res = await fetch(`${base}/models/${this.cfg.model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.cfg.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const out = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!out) throw new Error("Gemini returned no text");
    return out;
  }
}

/** Returns undefined when the AI is not configured, so the Guardian runs on rules only. */
export function llmFromEnv(env = process.env): LlmClient | undefined {
  if (!env.AI_API_KEY || !env.AI_MODEL) return undefined;
  return new GeminiClient({ apiKey: env.AI_API_KEY, model: env.AI_MODEL });
}
