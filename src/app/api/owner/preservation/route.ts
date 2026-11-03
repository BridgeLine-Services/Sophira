import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { runCensus, censusMessage, CENSUS_TABLES } from "@/lib/owner/preservation-census";

export const dynamic = "force-dynamic";

/**
 * Owner-only "is my data still here" check (2026-11-03).
 *
 * The equivalent check already existed as a terminal script, which the owner this was written for
 * cannot run. This route is the reachable version: it counts rows in all 47 record tables and says,
 * in one sentence, whether anything is missing.
 *
 * Three rules it must not break:
 *  - It reports, never repairs. A check that writes cannot be trusted when data is already suspect.
 *  - It says nothing it cannot back. If the database is unreachable the answer is 503 "could not
 *    check", never an empty result that reads like "no data".
 *  - It never returns the service key. The key stays in this process.
 */
export async function GET() {
  const supabase = createClient();
  const user = await requireUser(supabase);
  const { profile } = await readProfileWithRepair(supabase, user.id);
  if (!profile || profile.role !== "owner") {
    return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { ok: false, message: "This check needs the database connection, which is not set up yet." },
      { status: 503 },
    );
  }

  const result = await runCensus(fetch, url, key, CENSUS_TABLES);
  if (result.checked === 0) {
    return NextResponse.json({ ok: false, message: censusMessage(result) }, { status: 503 });
  }

  return NextResponse.json({
    ok: result.complete,
    message: censusMessage(result),
    checked: result.checked,
    expected: result.expected,
    // Counts only. No row contents, and never the key.
    counts: result.counts,
    problems: result.problems.map((p) => ({ table: p.table, problem: p.problem })),
  });
}
