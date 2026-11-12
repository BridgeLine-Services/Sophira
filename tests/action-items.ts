import { buildActionItems, countActionItems, hasUrgentAction, isMissingDatabasePiece } from "../src/lib/owner/action-items";

const HEALTHY = {
  requestsWaiting: 0,
  suspendedMembers: 0,
  databaseOutdated: false,
  membersUnreadable: false,
  aiReady: true,
  microsoftReady: true,
  googleReady: true,
  searchReady: true,
};

export function runActionItemTests(
  assert: (cond: boolean, msg: string) => void,
  section: (t: string) => void,
): void {
  section("1. A healthy network produces no invented work");
  {
    const items = buildActionItems(HEALTHY);
    assert(items.length === 0, "action items: nothing is listed when every check answered as expected");
    assert(countActionItems(items) === 0 && !hasUrgentAction(items),
      "action items: the count and the urgent flag agree with the empty list");
  }

  section("1b. A real count of missing updates reaches the Owner (2026-11-11)");
  {
    const two = buildActionItems({ ...HEALTHY, databasePending: 2 });
    assert(two.length === 1 && two[0].key === "database" && two[0].tone === "urgent",
      "action items: a database missing two updates produces one urgent item");
    assert(two[0].body.includes("2 updates"),
      "action items: the item says how many, because a number is what tells the owner this is small");
    assert(!two[0].body.toLowerCase().includes("sql") && two[0].href === "/owner/database",
      "action items: it names no technical word and points at the database page");

    const one = buildActionItems({ ...HEALTHY, databasePending: 1 });
    assert(one.length === 1 && one[0].body.includes("one update") && !one[0].body.includes("1 update"),
      "action items: one missing update is written as \"one update\", not as \"1 update\"");

    assert(buildActionItems({ ...HEALTHY, databasePending: 0 }).length === 0,
      "action items: an up-to-date database produces nothing");
    assert(buildActionItems({ ...HEALTHY, databasePending: null }).length === 0,
      "action items: a scan that could not be read claims nothing, rather than inventing an update");

    const both = buildActionItems({ ...HEALTHY, databasePending: 3, databaseOutdated: true });
    assert(both.filter((i) => i.key === "database").length === 1,
      "action items: the count and the older signal never produce two items for one problem");
    assert(both[0].body.includes("3 updates"),
      "action items: the known count wins over the older guess");
  }

  section("2. A database that has not been updated is said so, in the Owner's language");
  {
    const items = buildActionItems({ ...HEALTHY, databaseOutdated: true });
    assert(items.length === 1 && items[0].key === "database",
      "action items: an un-updated database produces exactly one item");
    assert(items[0].tone === "urgent" && hasUrgentAction(items),
      "action items: it is urgent, because features are genuinely missing");
    assert(items[0].href === "/owner/database",
      "action items: it points at the page with the button that fixes it");
    assert(/only adds things/i.test(items[0].body) && /safe to run more than once/i.test(items[0].body),
      "action items: it says the update is additive and repeatable, which is true and is the reassurance the Owner needs");
    assert(!/migration|sql|pgrst|schema cache|rls/i.test(items[0].title + " " + items[0].body),
      "action items: no technical vocabulary in an Owner-facing sentence");
  }

  section("3. Unknown is not zero");
  {
    const unknownRequests = buildActionItems({ ...HEALTHY, requestsWaiting: null });
    assert(!unknownRequests.some((i) => i.key === "requests"),
      "action items: an unreadable request count does not become 'no requests waiting'");
    const unknownSuspended = buildActionItems({ ...HEALTHY, suspendedMembers: null });
    assert(!unknownSuspended.some((i) => i.key === "suspended"),
      "action items: an unreadable suspended count does not become 'nobody suspended'");
    const unreadable = buildActionItems({ ...HEALTHY, membersUnreadable: true });
    assert(unreadable.some((i) => i.key === "members-unreadable" && i.tone === "urgent"),
      "action items: a member list Sophira could not read is reported as urgent, not skipped");
  }

  section("4. Real waiting work is named with its number and its consequence");
  {
    const items = buildActionItems({ ...HEALTHY, requestsWaiting: 3, suspendedMembers: 2 });
    const requests = items.find((i) => i.key === "requests");
    const suspended = items.find((i) => i.key === "suspended");
    assert(Boolean(requests) && requests!.title.includes("3") && /cannot\s+sign up/i.test(requests!.body),
      "action items: the request item counts them and says what it costs to leave them");
    assert(Boolean(suspended) && suspended!.title.includes("2") && /cannot sign in/i.test(suspended!.body),
      "action items: the suspended item counts them and says what being suspended means");
    assert(requests!.href === "/owner/requests" && suspended!.href === "/owner/members",
      "action items: each item links to the page where the work is done");

    const one = buildActionItems({ ...HEALTHY, requestsWaiting: 1, suspendedMembers: 1 });
    assert(Boolean(one.find((i) => i.key === "requests")?.title.includes("request is")),
      "action items: a single request reads as one request, not '1 requests'");
    assert(Boolean(one.find((i) => i.key === "suspended")?.title.includes("member is")),
      "action items: a single suspended member reads correctly too");
  }

  section("5. Urgent items come first, whatever order they were added in");
  {
    const items = buildActionItems({
      ...HEALTHY,
      requestsWaiting: 1,
      membersUnreadable: true,
      databaseOutdated: true,
      aiReady: false,
    });
    const firstInfoIndex = items.findIndex((i) => i.tone === "info");
    const lastUrgentIndex = items.map((i) => i.tone).lastIndexOf("urgent");
    assert(items.length >= 4, "action items: every real problem is reported, none silently dropped");
    assert(lastUrgentIndex < firstInfoIndex,
      "action items: everything urgent is grouped above the informational items");
    assert(items.filter((i) => i.tone === "urgent").length === 2,
      "action items: the two urgent situations are both marked urgent");
  }

  section("6. A degraded feature is described without inventing a cause");
  {
    const items = buildActionItems({ ...HEALTHY, aiReady: false });
    const ai = items.find((i) => i.key === "ai");
    assert(Boolean(ai) && /still work/i.test(ai!.body),
      "action items: a stopped AI service says the rest of the app still works");
    assert(!/quota|credit|billing|exceeded/i.test(ai!.body),
      "action items: it never guesses at a paid-AI cause Sophira cannot verify");
    const all = buildActionItems({ ...HEALTHY, aiReady: false, microsoftReady: false, googleReady: false, searchReady: false });
    assert(all.every((i) => i.body.length > 40),
      "action items: every item explains itself rather than naming a setting");
  }

  section("7. 'Behind' and 'unreachable' are different facts");
  {
    assert(isMissingDatabasePiece({ code: "PGRST202" }),
      "action items: a missing function (PGRST202) means the update has not been applied");
    assert(isMissingDatabasePiece({ code: "42P01" }) && isMissingDatabasePiece({ code: "42883" }),
      "action items: a missing table or function is recognised by its Postgres code");
    assert(isMissingDatabasePiece({ message: "Could not find the function public.network_directory in the schema cache" }),
      "action items: the schema-cache wording is recognised as a missing piece");
    assert(!isMissingDatabasePiece({ code: "08006", message: "connection failure" }),
      "action items: a connection failure is NOT reported as a missing update, which would send the Owner to press a button that cannot help");
    assert(!isMissingDatabasePiece(null) && !isMissingDatabasePiece({ message: "permission denied for function" }),
      "action items: no error, or a permission problem, is not described as an out-of-date database");
  }
}
