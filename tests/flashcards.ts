/**
 * FLASHCARDS AS A STUDY SYSTEM (2026-11-13, directive Part 6).
 *
 * Before this round flashcards were only a generated artifact: a notebook row with
 * questions and answers in JSONB and no way to study them. These tests pin the two
 * things that make the feature real and safe:
 *
 *   1. the scheduler is deterministic, bounded and honest (no inflated progress,
 *      no year-long gaps from a few lucky answers, no time machine on clock skew);
 *   2. the persistence is owner-only and the review history is append-only, so one
 *      student's cards and progress can never be read or rewritten by another.
 */
import { readFileSync, readdirSync } from "fs";
import {
  scheduleReview, initialState, isRating, isDue, dueCards, deckSummary,
  MAX_INTERVAL_DAYS, MAX_EASE, MIN_EASE, RELEARN_MINUTES, RATINGS, type CardState,
} from "../src/lib/flashcards/schedule";
import { cardsFromArtifact, normalizeCard, buildQueue, MAX_CARDS_PER_DECK } from "../src/lib/flashcards/decks";

type Assert = (cond: boolean, msg: string) => void;

const T0 = "2026-11-13T10:00:00.000Z";
const daysLater = (n: number) => new Date(Date.parse(T0) + n * 86400000).toISOString();

export async function runFlashcardTests(assert: Assert, section: (name: string) => void) {
  section("flashcards: the scheduler is deterministic, bounded and honest");

  // --- first answers -------------------------------------------------------
  {
    const first = scheduleReview(initialState(T0), "good", T0);
    assert(first.state.intervalDays === 1, "schedule: a first 'good' answers with a 1-day gap");
    assert(first.state.reps === 1 && first.state.lapses === 0, "schedule: 'good' counts a repetition and no lapse");
    assert(first.state.dueAt === daysLater(1), "schedule: the next due date is exactly one day later");
    assert(first.elapsedDays === null, "schedule: the FIRST review reports elapsedDays null, not 0 (it is not a second review in one minute)");

    const second = scheduleReview(first.state, "good", daysLater(1));
    assert(second.state.intervalDays === 3, "schedule: the second 'good' moves to a 3-day gap");
    const third = scheduleReview(second.state, "good", daysLater(4));
    assert(third.state.intervalDays === 7.5, "schedule: the third 'good' multiplies by the card's ease (3 x 2.5)");
    assert(third.elapsedDays === 3, "schedule: elapsed days are measured from the previous review");
  }

  // --- a failure is a failure -------------------------------------------
  {
    const learned: CardState = { intervalDays: 12, ease: 2.5, reps: 4, lapses: 0, dueAt: T0, lastReviewedAt: daysLater(-12) };
    const again = scheduleReview(learned, "again", T0);
    assert(again.state.intervalDays === 0, "schedule: 'again' resets the interval - the card is not learned");
    assert(again.state.reps === 0, "schedule: 'again' resets the repetition count");
    assert(again.state.lapses === 1, "schedule: 'again' records a lapse");
    assert(again.state.ease === 2.3, "schedule: 'again' lowers ease by 0.2");
    const dueIn = (Date.parse(again.state.dueAt) - Date.parse(T0)) / 60000;
    assert(dueIn === RELEARN_MINUTES, `schedule: 'again' brings the card back in ${RELEARN_MINUTES} minutes, not tomorrow`);
  }

  // --- bounds -----------------------------------------------------------
  {
    let s = initialState(T0);
    for (let i = 0; i < 12; i++) s = scheduleReview(s, "again", T0).state;
    assert(s.ease === MIN_EASE, `schedule: ease can never fall below ${MIN_EASE}`);
    let up = initialState(T0);
    for (let i = 0; i < 20; i++) up = scheduleReview(up, "easy", T0).state;
    assert(up.ease === MAX_EASE, `schedule: ease can never rise above ${MAX_EASE}`);
    assert(up.intervalDays <= MAX_INTERVAL_DAYS, `schedule: the interval is capped at ${MAX_INTERVAL_DAYS} days`);
    const huge: CardState = { intervalDays: 300, ease: 2.8, reps: 9, lapses: 0, dueAt: T0, lastReviewedAt: daysLater(-300) };
    const capped = scheduleReview(huge, "easy", T0);
    assert(capped.state.intervalDays === MAX_INTERVAL_DAYS, "schedule: even 'easy' on a 300-day card cannot exceed the cap");
    assert(Date.parse(capped.state.dueAt) === Date.parse(T0) + MAX_INTERVAL_DAYS * 86400000,
      "schedule: the due instant and the interval agree under the cap");
  }

  // --- hard / easy ------------------------------------------------------
  {
    const fresh = scheduleReview(initialState(T0), "hard", T0);
    assert(fresh.state.intervalDays === 0.5, "schedule: 'hard' on a new card is a short gap, not a reward");
    const mid = scheduleReview(fresh.state, "easy", T0);
    assert(mid.state.intervalDays >= 0.5, "schedule: 'easy' never shortens an interval");
    const tenDay: CardState = { intervalDays: 10, ease: 2.5, reps: 3, lapses: 0, dueAt: T0, lastReviewedAt: daysLater(-10) };
    assert(scheduleReview(tenDay, "hard", T0).state.intervalDays === 12, "schedule: 'hard' advances slowly (10 x 1.2)");
  }

  // --- determinism, invalid input, unknown ratings ----------------------
  {
    const a = scheduleReview(initialState(T0), "good", T0);
    const b = scheduleReview(initialState(T0), "good", T0);
    assert(JSON.stringify(a) === JSON.stringify(b), "schedule: identical inputs always produce identical state");
    let threw = false;
    try { scheduleReview(initialState(T0), "good", "not-a-date"); } catch { threw = true; }
    assert(threw, "schedule: an invalid clock is refused rather than silently producing NaN dates");
    const skewed = scheduleReview({ intervalDays: 3, ease: 2.5, reps: 2, lapses: 0, dueAt: T0, lastReviewedAt: daysLater(5) }, "good", T0);
    assert(skewed.elapsedDays === 0, "schedule: a review 'before' the last one reports 0 elapsed days, never a negative");
    assert(!isRating("perfect") && !isRating(undefined) && !isRating(3), "schedule: only the four real answers are accepted");
    assert(RATINGS.every((r) => isRating(r)), "schedule: every declared rating is accepted");
  }

  // --- due queue and deck counts ---------------------------------------
  {
    const cards = [
      { id: "c1", dueAt: daysLater(-3), reps: 2, lapses: 0 },
      { id: "c2", dueAt: T0, reps: 1, lapses: 1 },
      { id: "c3", dueAt: daysLater(5), reps: 0, lapses: 0 },
      { id: "c4", dueAt: daysLater(-9), reps: 4, lapses: 0, retired: true },
    ];
    const due = dueCards(cards, T0);
    assert(due.map((c) => c.id).join(",") === "c1,c2", "due: only past-due, non-retired cards, soonest first");
    assert(dueCards(cards, T0, 1).length === 1, "due: the limit is respected");
    assert(!isDue({ id: "r", dueAt: daysLater(-1), retired: true }, T0), "due: a retired card is never due");
    const sum = deckSummary(cards, T0);
    assert(sum.total === 3 && sum.due === 2, "summary: total and due exclude retired cards");
    assert(sum.learned === 1, "summary: 'learned' means two or more repetitions, not a generated percentage");
    assert(sum.newCards === 1 && sum.lapses === 1, "summary: new cards and lapses are counted from real state");
    const q = buildQueue(cards, T0, 10);
    assert(q.queue[0].id === "c1", "queue: due cards come first, soonest first");
    assert(q.newCards === 1, "queue: unseen cards are queued after the due ones");
  }

  section("flashcards: a generated artifact becomes real cards without invention");

  {
    const artifact = {
      title: "Flashcards — Cell transport",
      sections: [
        { heading: "Osmosis", items: ["Q: What does S1 (Cell biology) say about \"osmosis\"?", "A: \"Water moves across a semi-permeable membrane.\" [S1]"], citations: ["[S1]"] },
        { heading: "Empty", items: ["only one item"], citations: [] },
        { heading: "Diffusion", items: ["Q: Define diffusion", "A: Net movement from high to low concentration", "extra note"], citations: [] },
      ],
    };
    const built = cardsFromArtifact(artifact);
    assert(built.cards.length === 2, `artifact: two of three sections became cards (got ${built.cards.length})`);
    assert(built.cards[0].front.startsWith("What does S1"), "artifact: the 'Q:' prefix is stripped, the question is preserved");
    assert(built.cards[0].back.includes("semi-permeable"), "artifact: the answer keeps the quoted source passage");
    assert(built.cards[0].citation === "[S1]", "artifact: the citation travels with the card");
    assert(built.skipped.length === 1 && /both a question and an answer/.test(built.skipped[0].reason),
      "artifact: a section that cannot become a card is REPORTED, never filled in with invented text");
    assert(built.cards[1].front === "Define diffusion", "artifact: a second real card is built from the next section");

    const empty = cardsFromArtifact({ title: "Nothing", sections: [] });
    assert(empty.cards.length === 0 && empty.skipped.length === 1, "artifact: an empty artifact says so instead of returning a silent empty deck");

    const many = { title: "Big", sections: Array.from({ length: 400 }, (_, i) => ({ heading: `h${i}`, items: [`Q: q${i}`, `A: a${i}`] })) };
    assert(cardsFromArtifact(many).cards.length === MAX_CARDS_PER_DECK, `artifact: one deck is capped at ${MAX_CARDS_PER_DECK} cards`);

    assert(cardsFromArtifact({ title: "T", sections: undefined }).cards.length === 0, "artifact: missing sections are handled without a crash");

    assert(normalizeCard({ front: "  What is   osmosis? ", back: "water movement" })!.front === "What is osmosis?",
      "card: hand-written text is normalised (whitespace collapsed)");
    assert(normalizeCard({ front: "only a front" }) === null, "card: a card without both sides is refused, not saved blank");
    assert(normalizeCard({ front: "Q: q", back: "A: a" })!.back === "a", "card: typed Q:/A: prefixes are stripped");
  }

  section("flashcards: owner-only data, append-only history, no way to inflate progress");

  const sql = readFileSync("supabase/migrations/0057_flashcard_decks.sql", "utf8");
  const policies = sql.match(/create policy[^;]+;/g) ?? [];
  const ownPolicies = policies.filter((p) => /user_id = auth\.uid\(\)/.test(p));
  assert((sql.match(/enable row level security/g) ?? []).length === 3,
    "schema: RLS is enabled on all three new tables");
  assert(policies.length > 0 && ownPolicies.length === policies.length,
    `schema: every policy is owner-scoped (user_id = auth.uid()); ${ownPolicies.length} of ${policies.length} are`);
  assert(!/using\s*\(\s*true\s*\)/i.test(sql) && !/with check\s*\(\s*true\s*\)/i.test(sql),
    "schema: no policy allows everyone - there is no public read or write here");
  assert(/create policy flashcard_reviews_own_insert/.test(sql) && /create policy flashcard_reviews_own_read/.test(sql),
    "schema: the review log has explicit insert and read policies");
  assert(!/on public\.flashcard_reviews\s*\n?\s*for (update|delete)/i.test(sql),
    "schema: the review history has NO update or delete policy - progress cannot be rewritten");
  assert(!/drop table/i.test(sql), "schema: the migration is additive (no table is dropped)");
  assert(!/alter table public\.(notebook|student_memories|courses|profiles)/i.test(sql),
    "schema: no existing table is altered by this migration");
  assert(/interval_days numeric not null default 0 check \(interval_days >= 0\)/.test(sql),
    "schema: the database itself refuses a negative interval");
  assert(/ease numeric not null default 2.5 check \(ease between 1\.3 and 2\.8\)/.test(sql),
    "schema: the database itself bounds ease, so a bug in code cannot corrupt a card");

  const markers = readFileSync("scripts/migration-markers.mjs", "utf8");
  assert(/"0057_flashcard_decks\.sql":\s*"to_regclass\('public\.flashcard_decks'\) is not null"/.test(markers),
    "markers: 0057 has a real probe, so CI and the release gate can tell whether it ran");
  const migrationFiles = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));
  const missing = migrationFiles.filter((f) => !markers.includes(`"${f}"`));
  assert(missing.length === 0, `markers: every migration has a marker (missing: ${missing.join(", ") || "none"})`);

  // --- routes: server decides, client cannot inflate ---------------------
  const review = readFileSync("src/app/api/flashcards/review/route.ts", "utf8");
  const decks = readFileSync("src/app/api/flashcards/decks/route.ts", "utf8");
  const due = readFileSync("src/app/api/flashcards/due/route.ts", "utf8");
  const oneDeck = readFileSync("src/app/api/flashcards/decks/[id]/route.ts", "utf8");
  assert(/isRating\(body\.rating\)/.test(review) && /scheduleReview\(current, body\.rating, nowISO\)/.test(review),
    "review route: the SERVER schedules the next review from a validated answer");
  assert(!/body\.(due_at|dueAt|interval_days|intervalDays)/.test(review),
    "review route: the client cannot send its own next due date or interval");
  assert(/\.eq\("user_id", guard\.data\.user\.id\)/.test(review), "review route: the card is read as the signed-in student only");
  assert(/That card could not be found\./.test(review), "review route: another student's card is a 404, not a scheduling change");
  for (const [name, src] of [["decks", decks], ["deck", oneDeck], ["due", due]] as const) {
    assert(/\.eq\("user_id", guard\.data\.user\.id\)/.test(src), `${name} route: reads are filtered to the signed-in student`);
    assert(/requireUser\(supabase\)/.test(src), `${name} route: requires a signed-in member`);
  }
  assert(/cardsFromArtifact/.test(decks) && /normalizeCard/.test(decks),
    "decks route: both the artifact path and the hand-written path are wired");
  assert(/skipped/.test(decks), "decks route: sections that could not become cards are reported to the client");
  assert(/delete\(\)\s*[\s\S]{0,200}\.eq\("user_id"/.test(oneDeck), "deck route: deletion is owner-scoped");
  assert(/released_at/.test(due) && /lte\("due_at", nowISO\)/.test(due),
    "due route: the queue is built from the SERVER clock, not the browser's");
}
