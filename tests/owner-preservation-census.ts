/**
 * OWNER DATA CENSUS (2026-11-03).
 *
 * The owner-facing "is my data still here" check counts rows in 47 tables through PostgREST's
 * content-range header. Everything that can go wrong here is a parsing question, and every parsing
 * mistake fails in the same dangerous direction: reporting data safe when it is not.
 *
 * "Empty table" and "missing table" arrive from PostgREST as a total of 0 and as 404. Treating a
 * 404 as 0
 * rows would report a dropped table as an empty one. Treating a star total (count never computed)
 * as 0 would
 * do the same. Both are asserted below as findings, not zeros.
 *
 * The network layer is injected so these run without a database.
 */
import { readFileSync } from "fs";
import {
  CENSUS_TABLES, countTable, runCensus, censusMessage, type CensusFetch,
} from "../src/lib/owner/preservation-census";

const res = (status: number, contentRange?: string) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (n: string) => (n.toLowerCase() === "content-range" ? contentRange ?? null : null) },
});
const reply = (status: number, contentRange?: string): CensusFetch => async () => res(status, contentRange);
const throwing: CensusFetch = async () => { throw new Error("socket hang up"); };

export async function runOwnerPreservationCensusTests(
  assert: (c: boolean, n: string) => void,
  section: (t: string) => void,
): Promise<void> {
  section("owner data census: counting never guesses");

  const ok = await countTable(reply(200, "0-0/42"), "https://x.supabase.co", "k", "assignments");
  assert(ok.rows === 42 && ok.problem === undefined, "census: a real content-range total is used as the count");

  const empty = await countTable(reply(200, "*/0"), "https://x.supabase.co", "k", "notebooks");
  assert(empty.rows === 0, "census: an existing empty table counts as 0, not as missing");

  const star = await countTable(reply(200, "0-0/*"), "https://x.supabase.co", "k", "notebooks");
  assert(star.rows === null && star.problem === "no count returned",
    "census: a '*' total (count never computed) is a finding, never 0 rows");

  const header = await countTable(reply(200, undefined), "https://x.supabase.co", "k", "notebooks");
  assert(header.rows === null && header.problem === "no count returned",
    "census: a 200 with no content-range is a finding, never 0 rows");

  const gone = await countTable(reply(404), "https://x.supabase.co", "k", "writing_samples");
  assert(gone.rows === null && gone.problem === "missing",
    "census: 404 means the table is GONE - reported as missing, never as an empty table");

  const denied = await countTable(reply(401), "https://x.supabase.co", "k", "assignments");
  assert(denied.rows === null && denied.problem === "forbidden",
    "census: 401 is reported as forbidden (a wrong key), not as missing data");

  const broken = await countTable(reply(500), "https://x.supabase.co", "k", "assignments");
  assert(broken.rows === null && broken.problem === "unreachable",
    "census: a 500 is reported as unreachable, never as an empty table");

  const dropped = await countTable(throwing, "https://x.supabase.co", "k", "assignments");
  assert(dropped.rows === null && dropped.problem === "unreachable",
    "census: a network failure returns a finding instead of throwing out of the check");

  section("owner data census: the summary");

  const good: CensusFetch = async (url) => res(200, url.includes("profiles") ? "0-0/3" : "0-0/7");
  const healthy = await runCensus(good, "https://x.supabase.co/", "k", ["profiles", "assignments"]);
  assert(healthy.complete && healthy.checked === 2 && healthy.counts.profiles === 3,
    "census: a healthy database reports complete with real per-table counts");
  assert(censusMessage(healthy).includes("Nothing is missing"),
    "census: a complete check says so plainly");

  const mixed = await runCensus(async (url) => (url.includes("notebooks") ? res(404) : res(200, "0-0/5")),
    "https://x.supabase.co", "k", ["assignments", "notebooks"]);
  assert(!mixed.complete && mixed.checked === 1 && mixed.counts.notebooks === undefined,
    "census: a missing table is excluded from the counts and reported as a problem");
  const missingMsg = censusMessage(mixed);
  assert(missingMsg.includes("missing") && /restore from a backup/i.test(missingMsg),
    "census: a missing table tells the owner it is real damage and to restore a backup");
  assert(!missingMsg.includes("Nothing is missing"),
    "census: the reassuring sentence is never printed over an incomplete check");

  const allDown = await runCensus(throwing, "https://x.supabase.co", "k", ["profiles"]);
  assert(allDown.checked === 0 && !allDown.complete && censusMessage(allDown).includes("proves nothing"),
    "census: nothing readable is stated as 'this check proves nothing', never as 'no data'");

  assert(CENSUS_TABLES.length === 47 && CENSUS_TABLES.includes("assignments") && CENSUS_TABLES.includes("notebooks"),
    "census: the check covers 47 record tables including assignments and notebooks");

  section("owner data census: the endpoint and the script cannot drift apart");

  {
    // Two lists of the same 47 tables exist (the CLI script and this module). A new table added to
    // one and not the other means a silent blind spot in whichever list was forgotten.
    const script = readFileSync("scripts/member-preservation.mjs", "utf8");
    const open = script.indexOf("const CENSUS_TABLES = [");
    const close = script.indexOf("];", open);
    const block = open >= 0 && close > open ? script.slice(open, close) : "";
    const scriptTables = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    assert(scriptTables.length === CENSUS_TABLES.length
      && scriptTables.every((t, i) => t === CENSUS_TABLES[i]),
      "census: the module's table list matches scripts/member-preservation.mjs exactly");

    const route = readFileSync("src/app/api/owner/preservation/route.ts", "utf8");
    assert(route.includes("requireUser") && route.includes('profile.role !== "owner"')
      && route.includes('"Owner access required."'),
      "census route: owner-only, through the same session guard as every other owner route");
    assert(route.includes("SUPABASE_SERVICE_ROLE_KEY") && route.includes("status: 503"),
      "census route: answers 503 'could not check' when the database is not configured");
    assert(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(route),
      "census route: reports only - it never writes, repairs or deletes");
    // Only the SUCCESS payload matters: that is the object an owner can read or share. The guard's
    // 403 body carries no credentials either, but it is asserted above by its message.
    const successAt = route.indexOf("ok: result.complete");
    const body = successAt >= 0 ? route.slice(route.lastIndexOf("NextResponse.json({", successAt)) : "";
    // Comments are stripped first: the route's own comment says "never the key", which is a
    // sentence about safety, not a field named key.
    const fields = body.replace(/\/\/[^\n]*/g, " ");
    assert(fields.length > 0 && !/\b(key|apiKey|serviceKey|service_role|access_token)\b/.test(fields),
      "census route: the success payload carries counts only - no key, token or connection string");
    assert(body.includes("message: censusMessage(result)"),
      "census route: the success payload leads with a plain-language sentence, not raw numbers");
  }
}
