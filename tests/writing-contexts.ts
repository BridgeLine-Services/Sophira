/**
 * CONTEXT-SPECIFIC WRITING PERSONALISATION (2026-11-13, directive Part 5).
 *
 * The risk this feature carries: three profiles replacing one, where a casual note quietly
 * reshapes the voice applied to every essay, or where a student's spoken preference silently
 * overrides a teacher's requirement. These tests pin the isolations and the precedence,
 * with a fake Supabase client so an isolation can never be "proved" by a database accident.
 */
import { readFileSync } from "fs";

type Assert = (ok: boolean, message: string) => void;

interface FakeRow { [k: string]: unknown }

/**
 * A Supabase stand-in that answers the two shapes this feature uses - select/eq/order/limit
 * and insert/update/select/single - from an in-memory table, and can pretend the context
 * column does not exist (a database before migration 0058).
 */
function fakeSupabase(rows: FakeRow[], opts: { legacy?: boolean } = {}) {
  const calls: string[] = [];
  let nextId = 1000;
  const table = () => rows;
  const match = (r: FakeRow, filters: [string, unknown][]) => filters.every(([k, v]) => r[k] === v);


  const NEEDS_COLUMN = /profile_context|style_closeness/;
  function builder(filters: [string, unknown][] = [], orderBy?: string, limitN?: number, cols = "") {
    const result = () => {
      if (opts.legacy && NEEDS_COLUMN.test(cols)) {
        return { data: null, error: { message: `column does not exist (${cols})`, code: "42703" } };
      }
      let out = table().filter((r) => match(r, filters));
      if (orderBy) out = [...out].sort((a, b) => String(b[orderBy] ?? "").localeCompare(String(a[orderBy] ?? "")));
      if (limitN !== undefined) out = out.slice(0, limitN);
      return { data: out, error: null };
    };
    const self: Record<string, unknown> = {};
    const selfAny = self as Record<string, unknown> & { select?: (cols: string) => unknown };
    selfAny.select = (selected: string) => {
      calls.push(`select ${selected}`);
      return builder(filters, orderBy, limitN, selected);
    };
    self.eq = (k: string, v: unknown) => builder([...filters, [k, v]], orderBy, limitN, cols);
    self.order = (k: string) => builder(filters, k, limitN, cols);
    self.limit = (n: number) => builder(filters, orderBy, n, cols);
    self.maybeSingle = () => { const r = result(); if (r.error) return { data: null, error: r.error }; return { data: r.data[0] ?? null, error: null }; };
    self.single = () => { const r = result(); if (r.error) return { data: null, error: r.error }; return { data: r.data[0] ?? null, error: null }; };
    self.then = (resolve: (v: unknown) => unknown) => resolve(result());
    return self;
  }

  return {
    db: {
      from(name: string) {
        calls.push(`from ${name}`);
        return {
          select: (cols: string) => (builder() as { select: (c: string) => unknown }).select(cols),
          insert: (payload: FakeRow | FakeRow[]) => {
            const arr = Array.isArray(payload) ? payload : [payload];
            const created = arr.map((p) => {
              const row = { id: `new-${nextId++}`, guidance: "", status: "draft", version: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...p };
              rows.push(row);
              calls.push(`insert ${name}`);
              return row;
            });
            const after: Record<string, unknown> = {
              select: () => after,
              single: () => ({ data: created[0], error: null }),
              then: (resolve: (v: unknown) => unknown) => resolve({ data: created, error: null }),
            };
            return after;
          },
          update: (patch: FakeRow) => {
            const legacyFail = opts.legacy && Object.keys(patch).some((k) => NEEDS_COLUMN.test(k));
            const chain = (filters: [string, unknown][] = []): Record<string, unknown> => {
              const apply = () => {
                if (legacyFail) { calls.push(`update ${name} (rejected: column missing)`); return []; }
                const hit = rows.filter((r) => match(r, filters));
                for (const r of hit) Object.assign(r, patch);
                calls.push(`update ${name} (${hit.length})`);
                return hit;
              };
              const api: Record<string, unknown> = {
                eq: (k: string, v: unknown) => chain([...filters, [k, v]]),
                select: () => api,
                single: () => {
                  if (legacyFail) return { data: null, error: { message: "column does not exist", code: "42703" } };
                  const hit = apply();
                  return { data: hit[0] ?? null, error: hit.length ? null : { message: "no row" } };
                },
                then: (resolve: (v: unknown) => unknown) => { const hit = apply(); return resolve({ data: hit, error: null }); },
              };
              return api;
            };
            return chain();
          },
        };
      },
    } as never,
    rows,
    calls,
  };
}

const PROFILE = (over: FakeRow = {}): FakeRow => ({
  id: "p", user_id: "u", profile_context: "academic", style_closeness: 70,
  guidance: "academic guidance", status: "approved", version: 2,
  created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", ...over,
});

export async function runWritingContextTests(assert: Assert, section: (name: string) => void) {
  const ctx = await import("../src/lib/ai/writing-contexts");
  const wp = await import("../src/lib/ai/writing-profiles");

  // ---- 1. the pure rules -------------------------------------------------
  section("writing contexts: the three kinds of writing never merge");
  assert(ctx.WRITING_CONTEXTS.join(",") === "academic,casual,professional",
    "contexts: exactly academic, casual and professional exist");
  assert(ctx.isWritingContext("casual") && !ctx.isWritingContext("poetic") && !ctx.isWritingContext(null),
    "contexts: only the three allowed values are accepted");
  assert(ctx.parseWritingContext(undefined) === "academic" && ctx.parseWritingContext("") === "academic",
    "contexts: an unset context is academic, which is what migration 0058 backfilled");
  assert(ctx.parseWritingContext("  Casual ") === "casual",
    "contexts: a padded or oddly-cased value still lands on the right context");
  assert(ctx.parseWritingContext("poetic") === "academic",
    "contexts: an unknown context falls back to academic instead of erroring or inventing one");
  assert(ctx.normalizeCloseness(0) === 0 && ctx.normalizeCloseness(100) === 100,
    "closeness: both ends of the dial are valid");
  assert(ctx.normalizeCloseness(101) === 100 && ctx.normalizeCloseness(-5) === 0,
    "closeness: an out-of-range number is clamped to the dial, never stored as 101");
  assert(ctx.normalizeCloseness("42") === 42, "closeness: a value arriving as text is honoured");
  assert(ctx.normalizeCloseness("nonsense") === ctx.DEFAULT_CLOSENESS && ctx.normalizeCloseness(undefined) === 70,
    "closeness: junk falls back to the default 70 rather than guessing");
  assert(ctx.closenessLabel(0) === "Off" && ctx.closenessLabel(100) === "As close as possible",
    "closeness: the student sees words at both ends, not a bare number");

  // ---- 2. the dial's instruction ------------------------------------------
  section("writing contexts: the dial never overrides the assignment or the teacher");
  const off = ctx.closenessDirective(0);
  assert(off.applyGuidance === false && /OFF/.test(off.directive),
    "closeness 0: the approved guidance is NOT applied at all");
  const low = ctx.closenessDirective(20);
  const high = ctx.closenessDirective(95);
  assert(low.applyGuidance && high.applyGuidance && low.directive !== high.directive,
    "closeness: 20 and 95 produce different instructions, so the dial actually does something");
  for (const [label, d] of [["20", low], ["95", high]] as const) {
    assert(/assignment/.test(d.directive) && /teacher/.test(d.directive),
      `closeness ${label}: the instruction names the assignment and the teacher as superior`);
    assert(/tell the student about the conflict/.test(d.directive),
      `closeness ${label}: a conflict is reported, never resolved silently`);
  }
  assert(/contractions are fine/i.test(ctx.contextRegisterRules("casual").join(" ")),
    "register: casual writing permits contractions");
  assert(/no contractions|contractions/i.test(ctx.contextRegisterRules("academic").join(" ")),
    "register: academic writing does not");
  assert(/\[date\]/.test(ctx.contextRegisterRules("professional").join(" ")),
    "register: professional writing keeps placeholders visible instead of inventing facts");

  // ---- 3. profiles stay in their own context ----------------------------
  section("writing contexts: a casual profile never answers an academic task");
  const rows = [
    PROFILE({ id: "pa", profile_context: "academic", guidance: "ACADEMIC GUIDANCE", style_closeness: 40 }),
    PROFILE({ id: "pc", profile_context: "casual", guidance: "CASUAL GUIDANCE", style_closeness: 90 }),
    PROFILE({ id: "pp", profile_context: "professional", guidance: "PRO GUIDANCE", style_closeness: 60, status: "draft" }),
  ];
  const fake = fakeSupabase(rows);
  const loaded = await wp.loadContextProfiles(fake.db, "u");
  const by = new Map(loaded.contexts.map((c) => [c.context, c]));
  assert(loaded.contexts.length === 3, "profiles: all three contexts are reported");
  assert(by.get("academic")?.profile?.guidance === "ACADEMIC GUIDANCE",
    "profiles: academic reads the academic row");
  assert(by.get("casual")?.profile?.guidance === "CASUAL GUIDANCE",
    "profiles: casual reads the casual row");
  assert(by.get("academic")?.closeness === 40 && by.get("casual")?.closeness === 90,
    "profiles: each context keeps its OWN closeness setting");
  assert(by.get("professional")?.approved === null,
    "profiles: a draft is never reported as approved");

  const academicPrompt = await wp.writingPromptFor(fake.db, "u", "academic");
  assert(academicPrompt.section?.includes("ACADEMIC GUIDANCE") === true &&
    !academicPrompt.section?.includes("CASUAL GUIDANCE"),
    "prompt: an academic task receives ONLY the academic guidance");
  const casualPrompt = await wp.writingPromptFor(fake.db, "u", "casual");
  assert(casualPrompt.section?.includes("CASUAL GUIDANCE") === true,
    "prompt: a casual task receives the casual guidance");
  const proPrompt = await wp.writingPromptFor(fake.db, "u", "professional");
  assert(proPrompt.section === null,
    "prompt: an unapproved (draft) profile contributes nothing to a prompt");

  // closeness 0 silences the guidance even when it is approved
  rows[0].style_closeness = 0;
  const muted = await wp.writingPromptFor(fake.db, "u", "academic");
  assert(muted.section === null && muted.closeness === 0,
    "prompt: a student at closeness 0 gets their approved guidance kept but NOT applied");

  // ---- 4. a database before 0058 still works ---------------------------
  section("writing contexts: an older database degrades honestly");
  const legacy = fakeSupabase([PROFILE({ profile_context: undefined, style_closeness: undefined })], { legacy: true });
  const legacyLoaded = await wp.loadContextProfiles(legacy.db, "u");
  assert(legacyLoaded.contexts.length === 3 && legacyLoaded.degraded.join(" ").includes("predates"),
    "legacy: a database without the context column reports it plainly instead of failing");
  assert(legacyLoaded.contexts.find((c) => c.context === "academic")?.profile !== null,
    "legacy: the single old profile is treated as academic, exactly as 0058 backfilled it");
  const legacyPrompt = await wp.writingPromptFor(legacy.db, "u", "casual");
  assert(legacyPrompt.section === null,
    "legacy: a casual task does not borrow the old undifferentiated profile");

  // ---- 5. the dial is the student's own --------------------------------
  section("writing contexts: the student's own setting writes directly, suggestions do not");
  const writable = fakeSupabase([PROFILE({ id: "pa", profile_context: "academic", style_closeness: 70 })]);
  const saved = await wp.setCloseness(writable.db, "u", "academic", 35);
  assert(saved.ok && saved.closeness === 35, "closeness: the student's own value is stored as given");
  const clamped = await wp.setCloseness(writable.db, "u", "academic", 500);
  assert(clamped.ok && clamped.closeness === 100,
    "closeness: the database is never asked to store an impossible value");
  const fresh = fakeSupabase([]);
  const firstTime = await wp.setCloseness(fresh.db, "u", "professional", 80);
  assert(firstTime.ok && firstTime.created === true,
    "closeness: a first-time setting creates a DRAFT row to hold it, which is not applied to anything");
  assert(fresh.rows[0]?.status === "draft",
    "closeness: that created row is a draft, so no guidance reaches a prompt");
  const legacyWrite = await wp.setCloseness(fakeSupabase([PROFILE()], { legacy: true }).db, "u", "academic", 50);
  assert(!legacyWrite.ok && /cannot store/.test(legacyWrite.error ?? ""),
    "closeness: on a database without the column the student is told it was not saved, not shown a false success");

  // ---- 6. the routes and screens are wired, not just the library --------
  section("writing contexts: the routes and screens use them");
  const profileRoute = readFileSync("src/app/api/writing/profile/route.ts", "utf8");
  assert(/requireUser/.test(profileRoute), "route: the profile settings API requires a signed-in student");
  assert(/loadContextProfiles/.test(profileRoute) && /setCloseness/.test(profileRoute),
    "route: GET and PATCH go through the shared library, so the screen and the AI cannot disagree");
  assert(/normalizeCloseness|setCloseness/.test(profileRoute) && !/101/.test(profileRoute),
    "route: closeness is validated by the shared rule, not by a copy of it");

  const analyze = readFileSync("src/app/api/ai/analyze-writing/route.ts", "utf8");
  assert(/profile_context/.test(analyze) && /parseWritingContext/.test(analyze),
    "analysis: samples are filtered to the requested context");
  assert(/ensureProfileForContext/.test(analyze) && !/order\("created_at", \{ ascending: false \}\)\s*\.limit\(1\)/.test(analyze),
    "analysis: the proposal attaches to that context's profile, not to whichever row is newest");

  const suggestions = readFileSync("src/app/api/ai/style-suggestions/route.ts", "utf8");
  assert(/profile_context/.test(suggestions) && /ensureProfileForContext/.test(suggestions),
    "suggestions: rule-based suggestions are scoped to the same context");

  const newSample = readFileSync("src/app/writing/new/page.tsx", "utf8");
  assert(/profile_context/.test(newSample) && /CONTEXT_LABELS/.test(newSample),
    "screen: a sample records which kind of writing it is, in plain words");
  assert(/WRITING_CONTEXTS\.map/.test(newSample),
    "screen: the picker offers the three contexts and nothing else");

  const engine = readFileSync("src/lib/ai/academic-context.ts", "utf8");
  assert(/writingContext/.test(engine) && /closenessDirective/.test(engine) && /contextRegisterRules/.test(engine),
    "engine: the shared context service applies the context, the dial and the register rules");
  assert(/ORDER OF AUTHORITY/.test(engine),
    "engine: the existing precedence line (assignment and teacher first) is preserved");
  for (const f of ["src/app/api/writing/grammar/route.ts", "src/app/api/writing/plan/route.ts"]) {
    assert(/writingContext/.test(readFileSync(f, "utf8")),
      `engine: ${f} passes the writing context instead of assuming one`);
  }
}
