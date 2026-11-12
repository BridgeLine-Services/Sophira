import { readFileSync } from "fs";

/**
 * The member refresh contract (2026-11-12).
 *
 * The reported symptom was "the Members page shows the same thing after I change
 * something". The cause was not the database and not permissions: /api/network/stats
 * answered `{ data: { members } }` while the panel read `json.members`. The list was
 * present the whole time, one level too deep, so every refresh succeeded and changed
 * nothing on screen.
 *
 * This file pins the contract from both ends — the route must keep the list at the top
 * level and keep `data` as an identical mirror, and the client must read the top level
 * with the mirror as a fallback. A drift in either direction fails here instead of
 * quietly showing stale rows to the Owner.
 */
export function runMemberRefreshContractTests(
  assert: (cond: boolean, msg: string) => void,
  section: (t: string) => void,
) {
  const route = readFileSync("src/app/api/network/stats/route.ts", "utf8");
  const panel = readFileSync("src/components/app/MembersPanel.tsx", "utf8");
  // The client read lives in the shared action module; the panel consumes its result.
  const client = readFileSync("src/lib/owner/member-actions.ts", "utf8");

  section("1. The route answers with the list where the client looks for it");
  assert(/const payload = \{ members,/.test(route),
    "refresh: the member list is a TOP-LEVEL key of the response");
  assert(/NextResponse\.json\(payload\)/.test(route),
    "refresh: the route returns that payload unchanged, not re-wrapped");
  assert(/data:\s*\{\s*members|data:\s*payload|data:\s*\{/.test(route),
    "refresh: the old { data: ... } shape is kept as a mirror so an older caller cannot break");

  section("2. The client reads the top level first and still tolerates the old shape");
  assert(/json\??\.members/.test(client),
    "refresh: the client reads the top-level member list");
  assert(/json\??\.data\??\.members|json\?\.data\?\.members/.test(client),
    "refresh: the client falls back to the nested shape instead of showing an empty table");
  assert(/fetch\("\/api\/network\/stats", \{ cache: "no-store" \}\)/.test(client),
    "refresh: the refresh is never served from a cache, so it shows what is true now");

  section("3. A failed refresh is reported, never left as a silent no-op");
  assert(/setNotice|could not refresh/i.test(panel),
    "refresh: a refresh that fails says so, so stale rows are never presented as current");
  assert(!/await load\(\);?\s*$/m.test(panel) || /catch/.test(panel),
    "refresh: the refresh path handles its own failure instead of discarding it");

  section("4. Presence availability is stated, not assumed");
  assert(/presenceAvailable/.test(route),
    "refresh: the route reports whether presence could actually be read");
  assert(/presenceAvailable|presence could not be read/i.test(panel),
    "refresh: when presence is unavailable the page says so rather than inventing a state");
}
