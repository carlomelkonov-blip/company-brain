import { config } from "../config.js";

/**
 * Thin, swappable AI provider. v1 talks to Anthropic's Messages API over plain HTTPS.
 * When no API key is configured the app runs in offline mode and callers use deterministic fallbacks.
 */

export function aiConfigured(): boolean {
  return config().ANTHROPIC_API_KEY.length > 0;
}

export interface CompleteOptions {
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export async function complete(opts: CompleteOptions): Promise<string> {
  if (!aiConfigured()) throw new Error("AI provider not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 45_000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": config().ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config().ANTHROPIC_MODEL,
        max_tokens: opts.maxTokens ?? 1024,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
      }),
    });
    if (!res.ok) throw new Error(`AI provider error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
  } finally {
    clearTimeout(timer);
  }
}

/** Asks for JSON and parses the first JSON object in the reply. */
export async function completeJson<T>(opts: CompleteOptions): Promise<T> {
  const text = await complete(opts);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI reply contained no JSON object");
  return JSON.parse(text.slice(start, end + 1)) as T;
}
