/**
 * Search-provider abstraction (spec §7): a real server-side external search
 * provider, configurable via environment variables. API keys NEVER reach
 * the browser — this module is imported only by server routes.
 *
 *   SEARCH_PROVIDER  = "brave" | "tavily" | "custom"   (default "brave")
 *   SEARCH_API_KEY   = provider key                   (server-side only)
 *   SEARCH_BASE_URL  = custom endpoint for "custom" (a Brave-compatible
 *                      JSON API, e.g. a self-hosted proxy)
 *
 * The provider can be swapped without touching the research workflow.
 */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  domain?: string;
  published?: string;
}

export interface SearchOptions {
  maxResults?: number;
  /** ISO date lower bound hint, where the provider supports it */
  fromDate?: string | null;
  /** e.g. "en" */
  language?: string;
  /** free text like "site:.edu" appended by the workflow, not the model */
  extraQualifiers?: string | null;
}

export interface SearchProvider {
  readonly name: string;
  search(query: string, opts?: SearchOptions): Promise<SearchHit[]>;
}

export class SearchProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

export class SearchNotConfiguredError extends Error {
  constructor() {
    super("No search provider is configured on the server (SEARCH_PROVIDER / SEARCH_API_KEY).");
  }
}

export function searchProviderConfigured(): boolean {
  const provider = (process.env.SEARCH_PROVIDER || "brave").toLowerCase();
  if (provider === "custom") return Boolean(process.env.SEARCH_BASE_URL && process.env.SEARCH_API_KEY);
  return Boolean(process.env.SEARCH_API_KEY);
}

const TIMEOUT_MS = 20_000;

function parseBraveLike(json: unknown): SearchHit[] {
  const data = json as { web?: { results?: { title?: string; url?: string; description?: string; published?: string }[] } };
  return (data?.web?.results ?? []).map((r) => ({
    title: String(r.title ?? "").trim(),
    url: String(r.url ?? "").trim(),
    snippet: String(r.description ?? "").trim(),
    published: r.published ? String(r.published) : undefined,
  })).filter((h) => h.url.startsWith("http"));
}

const TAVILY_INJECTED = "tavily";

class TavilyProvider implements SearchProvider {
  readonly name = TAVILY_INJECTED;
  constructor(private readonly apiKey: string) {}
  async search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    const max = Math.min(opts.maxResults ?? 8, 10);
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: max,
        search_depth: "basic",
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new SearchProviderError(`Tavily search failed (HTTP ${res.status}).`, res.status);
    const json = (await res.json()) as { results?: { title?: string; url?: string; content?: string; published_date?: string }[] };
    return (json.results ?? []).map((r) => ({
      title: String(r.title ?? "").trim(),
      url: String(r.url ?? "").trim(),
      snippet: String(r.content ?? "").trim(),
      published: r.published_date ? String(r.published_date) : undefined,
    })).filter((h) => h.url.startsWith("http")).slice(0, max);
  }
}

class BraveProvider implements SearchProvider {
  readonly name = "brave";
  constructor(private readonly apiKey: string) {}
  async search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(Math.min(opts.maxResults ?? 8, 10)));
    if (opts.language) url.searchParams.set("search_lang", opts.language.slice(0, 2));
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json", "X-Subscription-Token": this.apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new SearchProviderError(`Brave search failed (HTTP ${res.status}).`, res.status);
    return parseBraveLike(await res.json());
  }
}

class CustomProvider implements SearchProvider {
  readonly name = "custom";
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}
  async search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    const url = new URL(this.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(Math.min(opts.maxResults ?? 8, 10)));
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json", "X-Subscription-Token": this.apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new SearchProviderError(`Custom search provider failed (HTTP ${res.status}).`, res.status);
    return parseBraveLike(await res.json());
  }
}

export function getSearchProvider(): SearchProvider {
  const provider = (process.env.SEARCH_PROVIDER || "brave").toLowerCase();
  const key = process.env.SEARCH_API_KEY;
  if (!key) throw new SearchNotConfiguredError();
  if (provider === TAVILY_INJECTED) return new TavilyProvider(key);
  if (provider === "custom") {
    const base = process.env.SEARCH_BASE_URL;
    if (!base) throw new SearchNotConfiguredError();
    return new CustomProvider(base, key);
  }
  return new BraveProvider(key);
}
