/**
 * RESEARCH READINESS AND SAFE FAILURE (2026-11-13, directive Part 9).
 *
 * The defect these tests exist for: a fresh research request created a project and its query
 * rows BEFORE establishing that a usable search provider existed, and executeResearchPass
 * constructed the provider outside the per-query error handling. An unconfigured installation
 * therefore left a project sitting in "searching" - which reads like a run in progress - and
 * the resume route answered with environment-variable names.
 *
 * Nothing here needs a network: a fake Supabase client records every write so the tests can
 * assert that NO row is created and NO status is faked when research cannot run.
 */
import { readFileSync } from "fs";

type Assert = (condition: boolean, message: string) => void;

interface WriteRecord { table: string; op: string; payload?: unknown }

/** Minimal stand-in for SupabaseClient: records writes, answers reads with nothing. */
function fakeSupabase(writes: WriteRecord[]) {
  const chain = (table: string, op: string, payload?: unknown) => {
    writes.push({ table, op, payload });
    const result: Record<string, unknown> = {
      data: null, error: null, count: 0,
      select: () => result, single: () => result, maybeSingle: () => result,
      eq: () => result, is: () => result, order: () => result, limit: () => result,
      then: (resolve: (v: unknown) => unknown) => resolve(result),
    };
    return result;
  };
  return {
    from(table: string) {
      return {
        insert: (payload?: unknown) => chain(table, "insert", payload),
        update: (payload?: unknown) => chain(table, "update", payload),
        select: () => chain(table, "select"),
      };
    },
  } as never;
}

export async function runResearchReadinessTests(assert: Assert, section: (name: string) => void) {
  const { researchReadiness, searchModeNotice, searchProviderConfigured } =
    await import("../src/lib/research/provider");
  const { executeResearchPass } = await import("../src/lib/research/run");

  const saved = { p: process.env.SEARCH_PROVIDER, k: process.env.SEARCH_API_KEY, b: process.env.SEARCH_BASE_URL };
  const restore = () => {
    if (saved.p === undefined) delete process.env.SEARCH_PROVIDER; else process.env.SEARCH_PROVIDER = saved.p;
    if (saved.k === undefined) delete process.env.SEARCH_API_KEY; else process.env.SEARCH_API_KEY = saved.k;
    if (saved.b === undefined) delete process.env.SEARCH_BASE_URL; else process.env.SEARCH_BASE_URL = saved.b;
  };

  const spec = {
    topic: "spaced repetition", question: null, academicLevel: null, sourceType: null,
    minSources: 4, dateRange: null, citationStyle: null, teacherRequirements: null,
  };
  const queries = [{ id: "q1", query: "spaced repetition evidence" }];

  try {
    // ---- 1. unconfigured is its own state ---------------------------------
    section("research: readiness states are distinct");
    process.env.SEARCH_PROVIDER = "brave"; delete process.env.SEARCH_API_KEY;
    const un = researchReadiness();
    assert(un.availability === "unconfigured" && !un.searchable && un.code === "search_not_configured",
      "readiness: a missing key is 'unconfigured', not 'no results'");
    assert(/no web search was performed/i.test(un.studentMessage) && /saved work is safe/i.test(un.studentMessage),
      "readiness: the student is told nothing was searched and their work is safe");
    assert(!/SEARCH_API_KEY|SEARCH_PROVIDER|hosting|env/i.test(un.studentMessage),
      "readiness: the student message contains no configuration detail");
    assert(/SEARCH_API_KEY/.test(un.ownerDetail),
      "readiness: the owner detail DOES name the setting, so setup stays possible");

    // ---- 2. local is intentional, not a failure ---------------------------
    process.env.SEARCH_PROVIDER = "local"; delete process.env.SEARCH_API_KEY;
    const local = researchReadiness();
    assert(local.availability === "local" && !local.searchable && local.code === "search_local_mode",
      "readiness: local mode is reported as intentionally off");
    assert(/turned off/i.test(local.studentMessage) && !/not configured/i.test(local.studentMessage),
      "readiness: local mode never reads like a missing configuration");
    assert(searchModeNotice()?.mode === "local",
      "readiness: the legacy notice still identifies local mode for existing callers");

    // ---- 3. external ------------------------------------------------------
    process.env.SEARCH_PROVIDER = "brave"; process.env.SEARCH_API_KEY = "test-key-not-real";
    const ext = researchReadiness();
    assert(ext.availability === "external" && ext.searchable && ext.code === "search_available",
      "readiness: a configured provider is reported as searchable");
    assert(searchModeNotice() === null && searchProviderConfigured(),
      "readiness: a configured provider produces no notice and no false warning");

    // ---- 4. the pass refuses to run, and writes nothing -------------------
    section("research: no false searching state, no empty project");
    for (const mode of ["local", "unconfigured"] as const) {
      if (mode === "local") { process.env.SEARCH_PROVIDER = "local"; delete process.env.SEARCH_API_KEY; }
      else { process.env.SEARCH_PROVIDER = "brave"; delete process.env.SEARCH_API_KEY; }
      const writes: WriteRecord[] = [];
      const pass = await executeResearchPass(
        fakeSupabase(writes), "user-1", "project-1", spec, queries, 8,
      );
      assert(pass.unavailable !== undefined && pass.stored.length === 0 && pass.searchFailures.length === 0,
        `pass (${mode}): returns an unavailable result instead of throwing or reporting no results`);
      assert(pass.unavailable?.availability === (mode === "local" ? "local" : "unconfigured"),
        `pass (${mode}): the returned reason matches the actual installation state`);
      assert(writes.filter((w) => w.table === "research_sources").length === 0,
        `pass (${mode}): no source row is ever written when nothing was searched`);
      assert(writes.filter((w) => w.table === "research_queries").length === 0,
        `pass (${mode}): no query is marked ok or failed when the provider never ran`);
    }

    // ---- 5. a provider that fails to construct is still handled ----------
    // "custom" without SEARCH_BASE_URL counts as unconfigured, and asking for a provider
    // that cannot be built must not escape as an exception.
    process.env.SEARCH_PROVIDER = "custom"; delete process.env.SEARCH_BASE_URL; process.env.SEARCH_API_KEY = "test-key-not-real";
    const writes2: WriteRecord[] = [];
    const pass5 = await executeResearchPass(fakeSupabase(writes2), "user-1", "project-1", spec, queries, 8);
    assert(pass5.unavailable !== undefined && writes2.length === 0,
      "pass: a half-configured provider yields an honest unavailable result and writes nothing");
    restore();

    // ---- 6. the routes check readiness BEFORE creating anything ----------
    section("research: the routes check readiness before creating rows");
    const fresh = readFileSync("src/app/api/research/route.ts", "utf8");
    const readinessAt = fresh.indexOf("researchReadiness()");
    const projectInsert = fresh.indexOf('.from("research_projects")');
    const queryInsert = fresh.indexOf('.from("research_queries")');
    assert(readinessAt > 0, "fresh route: uses the shared readiness check");
    assert(readinessAt < projectInsert, "fresh route: readiness is checked BEFORE the project row exists");
    assert(readinessAt < queryInsert, "fresh route: readiness is checked BEFORE any query row exists");
    assert(/status: 503/.test(fresh) && /pass\.unavailable/.test(fresh),
      "fresh route: unavailable research answers 503 with a stable code, and a mid-run loss is reported honestly");
    assert(/evaluateInformationRequest/.test(fresh) &&
      fresh.indexOf("evaluateInformationRequest") < readinessAt,
      "fresh route: the research policy screens the topic before the provider is even considered");

    const resume = readFileSync("src/app/api/research/resume/route.ts", "utf8");
    assert(/researchReadiness\(\)/.test(resume), "resume route: uses the same shared readiness check as the fresh run");
    assert(!/SEARCH_API_KEY|SEARCH_PROVIDER/.test(resume),
      "resume route: no environment-variable name reaches this route's student-facing reply");
    const unavailableBlock = resume.slice(resume.indexOf("if (!readiness.searchable)"), resume.indexOf("const specRow"));
    assert(!/from\("research_sources"\)/.test(unavailableBlock) && !/.delete\(/.test(unavailableBlock),
      "resume route: an unavailable provider never touches stored sources");
    assert(/pass\.unavailable/.test(resume),
      "resume route: a mid-run provider loss cannot be reported as a completed run");

    // ---- 7. the existing research engine is untouched --------------------
    section("research: verification, authority and citation rules are unchanged");
    for (const f of ["src/lib/research/verify.ts", "src/lib/research/authority.ts", "src/lib/research/claims.ts",
      "src/lib/research/citation.ts", "src/lib/readiness/finalGate.ts"]) {
      const src = readFileSync(f, "utf8");
      assert(src.length > 500, `research: ${f} is still present and substantial`);
    }
    const run = readFileSync("src/lib/research/run.ts", "utf8");
    assert(/fetchAndVerify\(/.test(run) && /rankCandidatesForAssignment\(/.test(run),
      "research: the pass still verifies every candidate and ranks by assignment authority");
    assert(/verification_status/.test(run) && /partially_verified/.test(run),
      "research: verification statuses are still written per source (a search hit is never auto-verified)");
    assert(/knownUrls/.test(run),
      "research: resume still de-duplicates against sources already stored");
  } finally {
    restore();
  }
}
