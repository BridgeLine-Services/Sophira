/**
 * RUNTIME ENVIRONMENT STATUSES (2026-10-11) — pure, no secrets.
 * Answers ONE question the owner actually has: "what does the RUNNING
 * deployed server see?" This is deliberately DIFFERENT from the Vercel
 * dashboard inventory (the app cannot read dashboard settings) and from
 * the CI runner's environment. Statuses only — variable NAMES and
 * booleans, never values or fragments.
 */
export interface RuntimeEnvStatus {
  status: "CONFIGURED" | "MISSING" | "OPTIONAL";
  detail: string;
}

export interface RuntimeEnvironment {
  supabase_client: RuntimeEnvStatus;
  supabase_service_role: RuntimeEnvStatus;
  ai_provider: RuntimeEnvStatus;
  search: RuntimeEnvStatus;
  microsoft: RuntimeEnvStatus;
  google: RuntimeEnvStatus;
  github_health_token: RuntimeEnvStatus;
  app_url: RuntimeEnvStatus;
}

function present(name: string, env: Record<string, string | undefined>): boolean {
  return Boolean(env[name] && env[name]!.trim() !== "");
}

export function runtimeEnvironment(env: Record<string, string | undefined> = process.env): RuntimeEnvironment {
  const msBoth = present("MICROSOFT_CLIENT_ID", env) && present("MICROSOFT_CLIENT_SECRET", env);
  const msOne = present("MICROSOFT_CLIENT_ID", env) || present("MICROSOFT_CLIENT_SECRET", env);
  const ggBoth = present("GOOGLE_CLIENT_ID", env) && present("GOOGLE_CLIENT_SECRET", env);
  const ggOne = present("GOOGLE_CLIENT_ID", env) || present("GOOGLE_CLIENT_SECRET", env);
  const aiSelf = present("LOCAL_LLM_BASE_URL", env);
  const aiOpen = present("OPENAI_API_KEY", env);
  const aiGem = present("GEMINI_API_KEY", env);
  return {
    supabase_client: {
      status: present("NEXT_PUBLIC_SUPABASE_URL", env) && present("NEXT_PUBLIC_SUPABASE_ANON_KEY", env) ? "CONFIGURED" : "MISSING",
      detail: "NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (required — sign-in and the database)",
    },
    supabase_service_role: {
      status: present("SUPABASE_SERVICE_ROLE_KEY", env) ? "CONFIGURED" : "MISSING",
      detail: "SUPABASE_SERVICE_ROLE_KEY (server-only; required for the live database probe and service operations)",
    },
    ai_provider: {
      status: aiSelf || aiOpen || aiGem ? "CONFIGURED" : "MISSING",
      detail: aiSelf
        ? "self-hosted local model (LOCAL_LLM_BASE_URL) — the free-first default"
        : aiOpen
          ? "OPENAI_API_KEY configured"
          : aiGem
            ? "GEMINI_API_KEY configured"
            : "no AI provider set — the assistant cannot run (add GEMINI_API_KEY or LOCAL_LLM_BASE_URL)",
    },
    search: {
      status: present("SEARCH_API_KEY", env) ? "CONFIGURED" : "MISSING",
      detail: "SEARCH_API_KEY (optional feature: live web research)",
    },
    microsoft: {
      status: msBoth ? "CONFIGURED" : msOne ? "MISSING" : "MISSING",
      detail: msBoth
        ? "Microsoft OAuth credentials set — 'Save to Word' can go live once the app registration redirects match"
        : msOne
          ? "only ONE of MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET is set — both are required"
          : "MICROSOFT_CLIENT_ID + MICROSOFT_CLIENT_SECRET not set (see docs/WORD_GOOGLE_DOCS_SETUP.md)",
    },
    google: {
      status: ggBoth ? "CONFIGURED" : "MISSING",
      detail: ggBoth
        ? "Google OAuth credentials set — 'Save to Google Docs/Slides' can go live once the redirect matches"
        : ggOne
          ? "only ONE of GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET is set — both are required"
          : "GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET not set (see docs/WORD_GOOGLE_DOCS_SETUP.md)",
    },
    github_health_token: {
      status: present("GITHUB_HEALTH_TOKEN", env) ? "CONFIGURED" : "OPTIONAL",
      detail: "GITHUB_HEALTH_TOKEN (optional — enables the one-click 'start a checkup' button; without it the page shows the manual Run-workflow link)",
    },
    app_url: {
      status: present("NEXT_PUBLIC_SITE_URL", env) || present("SOPHIRA_APP_URL", env) ? "CONFIGURED" : "MISSING",
      detail: "NEXT_PUBLIC_SITE_URL (web) / SOPHIRA_APP_URL (native builds) — used for correct links and native releases",
    },
  };
}
