export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      "The AI service is not configured yet. An administrator needs to set the OPENAI_API_KEY environment variable."
    );
    this.name = "AiNotConfiguredError";
  }
}

export function aiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function aiModel(): string {
  return process.env.SOPHIRA_MODEL || "gpt-4o-mini";
}

/**
 * Calls an OpenAI-compatible chat completions endpoint.
 * SERVER USE ONLY — the API key never reaches the client.
 */
export async function aiChat(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; jsonMode?: boolean } = {}
): Promise<string> {
  if (!aiConfigured()) throw new AiNotConfiguredError();

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: aiModel(),
        messages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 4096,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `The AI service returned an error (HTTP ${res.status}). ${body.slice(0, 300)}`
      );
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("The AI service returned an empty response. Please try again.");
    }
    return content;
  } catch (err) {
    if (err instanceof AiNotConfiguredError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("The AI request took too long and was cancelled. Your work was not lost — please try again.");
    }
    if (err instanceof TypeError) {
      throw new Error("Could not reach the AI service. Please check your connection and try again.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Extracts the first JSON object from a model response, tolerating fences. */
export function parseJsonLoose<T = unknown>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
