/**
 * Search-provider abstraction (spec §7): a real server-side external search
 * provider, configurable via environment variables. API keys NEVER reach
 * the browser — this module is imported only by server routes.
 *
 *   SEARCH_PROVIDER  = "brave" | "tavily" | "custom" | "local" (default "brave")
 *                     "local" = no web search at all (no paid API, no
 *                     external calls) — used when research must stay
 *                     fully local/self-hosted.
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

/**
 * LOCAL search provider (2026-10-06): retrieval WITHOUT any web search API.
 * SEARCH_PROVIDER=local performs no external calls and no paid API — web
 * research is honestly reported as unavailable while document-based and
 * on-device workflows keep working. It never fabricates results.
 */
export class LocalSearchProvider implements SearchProvider {
  readonly name = "local";
  async search(): Promise<SearchHit[]> {
    return [];
  }
}

export class SearchNotConfiguredError extends Error {
  constructor() {
    super("No search provider is configured on the server (SEARCH_PROVIDER / SEARCH_API_KEY).");
  }
}

/**
 * HOW READY IS THIS INSTALLATION FOR ONLINE RESEARCH? (directive Part 9, 2026-11-13)
 *
 * One function answers it, so the fresh run, the resume and any screen all report the same
 * thing. Four states are kept distinct, because collapsing them is exactly how an installation
 * ends up telling a student "no results" when nothing was ever searched:
 *
 *   external      a real provider is configured and could run a search
 *   local         deliberately switched off; no external call is ever made
 *   unconfigured  a provider is expected but its key/base URL is missing
 *   (a search that IS attempted and fails is reported by the caller, per query)
 *
 * `studentMessage` is what a student may see: no variable names, no vendor names, no
 * exceptions. `ownerDetail` is the technical half and belongs on owner-only screens.
 */
export type ResearchAvailability = "external" | "local" | "unconfigured";

export interface ResearchReadiness {
  availability: ResearchAvailability;
  /** True only when a real external search can actually run right now. */
  searchable: boolean;
  /** Stable machine code for an API response; never shown to a student. */
  code: "search_available" | "search_local_mode" | "search_not_configured";
  /** Plain language for a student. Safe to display verbatim. */
  studentMessage: string;
  /** Setup detail for the owner screen. MUST NOT be shown to a student. */
  ownerDetail: string;
}

export const RESEARCH_STUDENT_MESSAGES = {
  local:
    "Online research is turned off in this installation. Your saved documents and sources are still available.",
  unconfigured:
    "Online research is not available right now. Your saved work is safe. No web search was performed and no sources were invented. Please ask the person who manages Sophira to enable online research.",
} as const;

export function researchReadiness(): ResearchReadiness {
  const provider = (process.env.SEARCH_PROVIDER || "brave").toLowerCase();
  if (provider === "local") {
    return {
      availability: "local",
      searchable: false,
      code: "search_local_mode",
      studentMessage: RESEARCH_STUDENT_MESSAGES.local,
      ownerDetail:
        "SEARCH_PROVIDER=local: web research is intentionally disabled in this installation. No external call is made and no results are invented. Set SEARCH_PROVIDER (brave/tavily/custom) and SEARCH_API_KEY in the hosting environment to enable it.",
    };
  }
  if (!searchProviderConfigured()) {
    return {
      availability: "unconfigured",
      searchable: false,
      code: "search_not_configured",
      studentMessage: RESEARCH_STUDENT_MESSAGES.unconfigured,
      ownerDetail:
        "No search provider is configured: SEARCH_PROVIDER and SEARCH_API_KEY (server-only, set in the hosting environment) are missing or incomplete. Nothing is searched and no sources are invented until they are set.",
    };
  }
  return {
    availability: "external",
    searchable: true,
    code: "search_available",
    studentMessage: "",
    ownerDetail: `External search provider "${provider}" is configured.`,
  };
}

/**
 * Honest, non-technical explanation of WHY no web results can appear.
 * "local" is an intentional mode (no external calls), and a missing key is
 * a configuration gap - the two must never be reported as "you got no
 * results", which implies the search ran. Returns null when a real external
 * provider is configured.
 *
 * 2026-11-13: the wording is now student-facing only (no variable or vendor names). The
 * technical half lives in researchReadiness().ownerDetail for the owner screen.
 */
export function searchModeNotice(): { mode: "local" | "unconfigured"; message: string } | null {
  const readiness = researchReadiness();
  if (readiness.availability === "external") return null;
  return { mode: readiness.availability, message: readiness.studentMessage };
}

export function searchProviderConfigured(): boolean {
  const provider = (process.env.SEARCH_PROVIDER || "brave").toLowerCase();
  if (provider === "local") return true; // fully local: no key, no external calls
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
  if (provider === "local") return new LocalSearchProvider(); // no key, no external calls
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
