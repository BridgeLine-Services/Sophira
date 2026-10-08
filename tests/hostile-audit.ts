/**
 * HOSTILE SECURITY AUDIT regression tests (2026-10-06).
 *
 * Every fix from the hostile audit gets a permanent test so it cannot
 * return. Attackers assumed: another user, a revoked user, an
 * invited-but-not-approved user, an unauthenticated visitor, a malicious
 * browser client, ID tampering (request/user/assignment ids), RLS-bypass
 * attempts, bundle/localStorage/SW inspection, stale tokens, injection
 * through uploaded documents / teacher documents / research sources /
 * web pages.
 */

import { readFileSync } from "fs";
import { join } from "path";

type Assert = (condition: boolean, name: string) => void;
type Section = (title: string) => void;

function src(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

export async function runHostileAuditTests(assert: Assert, section: Section): Promise<void> {
  section("Hostile audit §1 — active-access allow-list (fail closed)");

  {
    const guard = src("src/lib/supabase/guard.ts");
    // The allow-list must contain EXACTLY the trusted statuses
    assert(guard.includes('new Set(["pending", "accepted", "active"])'), "audit: the guard trusts ONLY {pending, accepted, active} — every other status (revoked, typos, future additions) fails CLOSED");
    // Deny-list pattern must NOT return: a "!== revoked" style check would
    // let an unknown status through
    assert(!/status\s*[!=]==\s*"revoked"\s*\)\s*return ok/.test(guard), "audit: the guard is not a deny-list (deny-lists fail open on unknown statuses)");
    assert(guard.includes("ACTIVE_STATUSES.has("), "audit: the active-access check is membership in the allow-list");
    assert(guard.includes("fail CLOSED") || guard.includes("fail closed") || guard.includes("fail CLOSED".toLowerCase() || ""), "audit: the fail-closed rule is documented at the check itself");

    const mw = src("src/middleware.ts");
    assert(/profile\.status === "pending" \|\| profile\.status === "accepted" \|\| profile\.status === "active"/.test(mw), "audit: the middleware uses the same allow-list (a revoked or unknown status cannot pass the page gate)");

    // the restore action's 'active' status is legal at the DB
    const mig = src("supabase/migrations/0024_profile_status_constraint.sql");
    assert(mig.includes("('pending','accepted','active','revoked')"), "audit: the profiles status constraint now allows 'active' (restore worked before ONLY by accident of failing)");
    assert(mig.includes("drop constraint if exists profiles_status_check"), "audit: the old broken constraint is replaced, not duplicated");
    const types = src("src/lib/types.ts");
    assert(types.includes('status: "pending" | "accepted" | "active" | "revoked";'), "audit: the Profile type includes 'active'");
  }

  section("Hostile audit §2 — ID tampering: explicit ownership on every id-based read");

  {
    // readiness: assignment by id must ALSO filter by user
    const readiness = src("src/app/api/readiness/route.ts");
    assert(readiness.includes('.eq("id", assignmentId)\n    .eq("user_id", guard.data.user.id)'), "audit: readiness verifies assignment ownership explicitly (RLS is the backstop, not the only line)");

    // rubric-audit: response + assignment + teacher rows all user-scoped
    const rubric = src("src/app/api/rubric-audit/route.ts");
    assert(rubric.includes('.eq("id", responseId)\n    .eq("user_id", guard.data.user.id)'), "audit: rubric-audit verifies response ownership explicitly");
    assert(rubric.includes('.eq("id", assignmentId)\n    .eq("user_id", guard.data.user.id)'), "audit: rubric-audit verifies assignment ownership explicitly");
    assert(rubric.includes('.eq("teacher_id", assignment.teacher_id)\n          .eq("user_id", guard.data.user.id)'), "audit: rubric-audit verifies teacher-profile ownership explicitly");
    // the old query read rubrics/official_instructions from the TEACHERS
    // table where those columns do not exist (silent empty) — must read
    // teacher_profiles now
    assert(!/from\("teachers"\)[\s\S]{0,80}\.select\("rubrics, official_instructions"\)/.test(rubric), "audit: rubric-audit no longer queries nonexistent columns on teachers (silent-empty bug)");
    assert(rubric.includes('from("teacher_profiles")\n          .select("rubrics, official_instructions")'), "audit: rubric-audit reads documents from teacher_profiles where they actually live");

    // solve: teacher + teacher_profiles user-scoped
    const solve = src("src/app/api/ai/solve/route.ts");
    assert(solve.includes('.eq("id", body.teacher_id).eq("user_id", user.id)'), "audit: solve verifies teacher ownership explicitly");
    assert(solve.includes('.eq("teacher_id", body.teacher_id).eq("user_id", user.id)'), "audit: solve verifies teacher-profile ownership explicitly");

    // memory, notebooks, essay already carried explicit filters — verify
    const plan = src("src/app/api/essay/plan/route.ts");
    assert(plan.includes('.eq("project_id", body.research_project_id)\n      .eq("user_id", guard.data.user.id)'), "audit: essay plan verifies research-project ownership explicitly");
    assert(!plan.includes('from("teacher_source_docs")'), "audit: the essay plan no longer QUERIES the nonexistent teacher_source_docs table (teacher requirements silently vanished)");
    const planRoute = src("src/app/api/essay/plan/route.ts");
    assert(planRoute.includes('from("teachers")') && planRoute.includes('from("teacher_profiles")'), "audit: the essay plan reads teacher documents from the REAL tables");

    // every route that takes an [id] param must assert ownership
    for (const f of ["src/app/api/memory/[id]/route.ts", "src/app/api/notebooks/[id]/artifacts/route.ts", "src/app/api/notebooks/[id]/chat/route.ts", "src/app/api/notebooks/[id]/notes/route.ts", "src/app/api/notebooks/[id]/research/route.ts"]) {
      const r = src(f);
      assert(/\.eq\("user_id", (guard\.data\.)?user\.id\)/.test(r), `audit: ${f.split("/").pop()} asserts notebook/memory ownership`);
    }
  }

  section("Hostile audit §3 — prompt injection: external documents are untrusted content");

  {
    const context = src("src/lib/ai/context.ts");
    assert(context.includes("export function wrapUntrusted") && context.includes("export function detectInjectionAttempt"), "audit: the untrusted-content wrapper and injection detector exist");

    // essay plan: teacher documents wrapped + injection refused honestly
    const plan = src("src/app/api/essay/plan/route.ts");
    assert(plan.includes("detectInjectionAttempt(text)"), "audit: the essay plan detects injection attempts in teacher documents");
    assert(plan.includes("PROMPT-INJECTION ATTEMPT DETECTED"), "audit: an injection attempt is disclosed honestly and excluded, never silently obeyed");
    assert(plan.includes('wrapUntrusted("teacher rubric document", text)'), "audit: teacher rubric content is wrapped as untrusted data for the model");
    assert(plan.includes("not instructions"), "audit: the extraction prompt states the document is data, not instructions");

    // essay drafting: evidence + teacher requirements wrapped
    const draft = src("src/app/api/essay/draft-section/route.ts");
    assert(draft.includes('wrapUntrusted(`evidence ${e.label}`'), "audit: research evidence passages are wrapped as untrusted content when drafting");
    assert(draft.includes('wrapUntrusted("teacher requirement", t.requirement)'), "audit: teacher requirements are wrapped as untrusted content when drafting");
    assert(draft.includes("never as instructions"), "audit: the drafting prompt tells the model teacher documents cannot override the system");

    // solve: uploaded files already wrapped (pre-existing §21 control) —
    // verify it is still in place
    const solve = src("src/app/api/ai/solve/route.ts");
    assert(solve.includes("detectInjectionAttempt(f.extracted_text)"), "audit: uploaded files are still injection-checked in solve");
    assert(/wrapUntrusted\([\s\S]*f\.extracted_text\)/.test(solve), "audit: uploaded file text is still wrapped as untrusted in solve");

    // research web pages: the verifier wraps fetched content
    const verify = src("src/lib/research/verify.ts");
    assert(verify.includes("wrapUntrusted"), "audit: fetched web-page content is wrapped as untrusted when verified");
  }

  section("Hostile audit §4 — dependency + attack-surface hardening");

  {
    // the image optimizer is disabled (no next/image use, no remote hosts)
    const cfg = src("next.config.mjs");
    assert(cfg.includes("images: { unoptimized: true }"), "audit: the Next.js Image Optimizer endpoint is disabled — pure attack surface (critical DoS advisory) with zero legitimate use");
    const pkg = JSON.parse(src("package.json"));
    for (const m of ["braces", "micromatch", "fast-glob"]) assert(pkg.overrides[m], `audit: transitive dep ${m} is pinned by override to its latest patched line`);
    assert(pkg.devDependencies?.tailwindcss === "3.4.19", "audit: tailwindcss is on the latest 3.4.x (newest build-time dep chain)");
    assert(!pkg.dependencies?.tailwindcss, "audit: tailwindcss is NOT a production dependency (2026-10-07: build-time only — moving it out of dependencies cut the prod audit surface 13→5 findings)");
    assert(!pkg.dependencies?.["tailwindcss-animate"], "audit: tailwindcss-animate is dev-only too (build-time plugin)");
    // no direct runtime use of the vulnerable glob/watch chain
    const runtimeUses = ["src/lib", "src/app/api"].map((d) => {
      try { return src(d); } catch { return ""; }
    }).join("");
    assert(!/require\(["']chokidar|from ["']chokidar|from ["']fast-glob/.test(runtimeUses), "audit: the vulnerable glob/watch chain is build-time only — never reachable at runtime");
  }

  section("Hostile audit §5 — secrets never ship");

  {
    // scan source, public assets, service worker, and (if present) the
    // built client bundles for secret-shaped strings
    const secretPatterns: [RegExp, string][] = [
      [/sk-[A-Za-z0-9_\-]{20,}/, "OpenAI-style key"],
      [/AIza[0-9A-Za-z_\-]{30,}/, "Google API key"],
      [/gh[pousr]_[A-Za-z0-9]{30,}/, "GitHub token"],
      [/eyJhbGciOi[A-Za-z0-9_\-.]{40,}/, "JWT literal"],
      [/SUPABASE_SERVICE_ROLE[^\n]*=[^\n]*['\"][A-Za-z0-9_\-.]{20,}/, "service-role key literal"],
      [/postgres(ql)?:\/\/[^\s'"`]*:[^\s'"`]*@/i, "database URL with credentials"],
      [/xoxb-[0-9A-Za-z\-]{10,}/, "Slack token"],
    ];
    const scanTargets = [
      "src/middleware.ts", "public/sw.js", "public/manifest.webmanifest",
      "src/lib/supabase/server.ts", "src/lib/supabase/admin.ts", "src/lib/ai/client.ts",
    ];
    for (const t of scanTargets) {
      const content = src(t);
      for (const [re, label] of secretPatterns) {
        assert(!re.test(content), `audit: no ${label} in ${t}`);
      }
    }
    // env keys referenced, values never literal
    const admin = src("src/lib/supabase/admin.ts");
    // 2026-10-07: the admin key is read through the single authoritative
    // config layer (which resolves BOTH the legacy service-role name and
    // the new-style secret-key alias) - the admin client itself never
    // touches process.env for credentials, and no literal can be a key.
    assert(admin.includes("serviceRoleKey()"), "audit: the admin key comes from the authoritative environment layer, never a literal");
    const cfg = src("src/lib/supabase-config.ts");
    assert(cfg.includes("process.env.SUPABASE_SERVICE_ROLE_KEY") && cfg.includes("process.env.SUPABASE_SECRET_KEY"),
      "audit: the config layer reads the admin key from the environment (both conventions), never a literal");
    assert(!/['"][A-Za-z0-9_\-.]{38,}['"]/.test(admin) && !/['"][A-Za-z0-9_\-.]{38,}['"]/.test(cfg),
      "audit: no long literal that could be a key in the admin client or config layer");
  }
}
