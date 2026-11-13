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
import { summarizeReviews, difficultCards, progressSentence, RATING_GUIDE, type ReviewRow } from "../src/lib/flashcards/progress";

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

/**
 * PROGRESS AND CARD MANAGEMENT (2026-11-13, directive Part 6: "track progress",
 * "identify difficult cards", "edit flashcards", "delete flashcards they own").
 *
 * Progress must be counted from the append-only log, never assumed: with no
 * reviews the accuracy is null rather than a flattering 100%, and a log row with an
 * unreadable or future date is ignored instead of being counted as a success.
 */
export async function runFlashcardProgressTests(assert: Assert, section: (name: string) => void) {
  section("flashcards: progress is counted from real answers, never assumed");

  const empty = summarizeReviews([], T0, 30);
  assert(empty.reviews === 0 && empty.accuracy === null,
    "progress: with no reviews the accuracy is null, not a fake 100%");
  assert(progressSentence(empty, 0, 0).startsWith("No cards yet"),
    "progress: an empty account is told how to begin");
  assert(progressSentence(empty, 4, 4).includes("not reviewed any yet"),
    "progress: cards that exist but are unstudied say exactly that");

  const rows: ReviewRow[] = [
    { rating: "good", reviewedAt: daysLater(-1) },
    { rating: "good", reviewedAt: daysLater(-1) },
    { rating: "easy", reviewedAt: daysLater(-2) },
    { rating: "again", reviewedAt: daysLater(-2) },
  ];
  const sum = summarizeReviews(rows, T0, 30);
  assert(sum.reviews === 4 && sum.correct === 3 && sum.incorrect === 1,
    "progress: correct answers (good + easy) and misses are counted separately");
  assert(sum.accuracy === 75, `progress: accuracy is the real ratio (3 of 4 = 75%, got ${sum.accuracy})`);
  assert(sum.byDay.length === 2 && sum.byDay[0].reviews === 2,
    "progress: reviews are grouped by calendar day, oldest first");
  assert(progressSentence(sum, 2, 10).includes("75%"), "progress: the sentence carries the real percentage");
  assert(progressSentence(sum, 1, 10).includes("1 card due now"),
    "progress: a single due card reads naturally, not '1 cards'");

  const old: ReviewRow[] = [{ rating: "good", reviewedAt: daysLater(-90) }];
  assert(summarizeReviews(old, T0, 30).reviews === 0,
    "progress: a review outside the window is not counted in it");
  const skewed: ReviewRow[] = [
    { rating: "good", reviewedAt: daysLater(5) },
    { rating: "good", reviewedAt: "not-a-date" },
  ];
  assert(summarizeReviews(skewed, T0, 30).reviews === 0,
    "progress: a future-dated or unreadable log row is ignored, never counted as correct");

  const guideText = RATING_GUIDE.map((g) => `${g.label} ${g.meant}`).join(" ");
  assert(RATING_GUIDE.length === 4 && RATING_GUIDE.every((g) => g.label.length > 2 && g.meant.length > 10),
    "progress: all four answers have a plain label and an explanation");
  assert(!/SM-2|interval|ease|algorithm|schedul/i.test(guideText),
    "progress: no scheduler term reaches a student (Part 12)");

  const cards = [
    { id: "a", front: "hard one", lapses: 4, reps: 6, dueAt: daysLater(1) },
    { id: "b", front: "harder", lapses: 4, reps: 5, dueAt: daysLater(-1) },
    { id: "c", front: "easy one", lapses: 0, reps: 5, dueAt: daysLater(9) },
    { id: "d", front: "retired", lapses: 9, reps: 2, dueAt: daysLater(-9), retired: true },
  ];
  const difficult = difficultCards(cards, 2, 10);
  assert(difficult.length === 2, "difficult: only cards with repeated lapses are listed");
  assert(difficult[0].id === "b", "difficult: ties are broken by which card is due soonest");
  assert(!difficult.some((c) => c.id === "d"), "difficult: a retired card is never outstanding work");
  assert(difficultCards(cards, 2, 1).length === 1, "difficult: the list is capped");

  section("flashcards: editing a card never resets its progress");

  const cardRoute = readFileSync("src/app/api/flashcards/cards/[id]/route.ts", "utf8");
  const addCard = readFileSync("src/app/api/flashcards/decks/[id]/cards/route.ts", "utf8");
  const progressRoute = readFileSync("src/app/api/flashcards/progress/route.ts", "utf8");
  const deckList = readFileSync("src/app/api/flashcards/decks/route.ts", "utf8");
  assert(/A card needs both a front and a back/.test(cardRoute),
    "card edit: emptying one side is refused instead of saving an unanswerable card");
  assert(!/interval_days|ease:|due_at:/.test(cardRoute),
    "card edit: an edit cannot change the interval, ease or due date - a typo fix must not reset progress");
  assert(/\.eq\("user_id", guard\.data\.user\.id\)/.test(cardRoute), "card edit: scoped to the signed-in student");
  assert(/That card could not be found/.test(cardRoute), "card edit: another student's card is a 404");
  assert(/retired/.test(cardRoute), "card edit: a card can be retired without deleting its history");
  assert(/\.eq\("user_id", guard\.data\.user\.id\)/.test(addCard) && /That deck could not be found/.test(addCard),
    "add card: the deck is verified to belong to the student before anything is written");
  assert(/due_at: new Date\(\)\.toISOString\(\)/.test(addCard),
    "add card: a new card is due immediately, so it can be studied now");
  assert(/\.eq\("user_id", guard\.data\.user\.id\)/.test(progressRoute) && /flashcard_reviews/.test(progressRoute),
    "progress: reads the student's own cards and their own review log");
  assert(/warning: reviewError/.test(progressRoute),
    "progress: a failed history read is disclosed, not rendered as zero progress");
  assert(/Math\.min\(365, Math\.max\(1/.test(progressRoute), "progress: the window is clamped to a sane range");
  assert(/course_id/.test(deckList) && /deckQuery = deckQuery\.eq\("course_id"/.test(deckList),
    "decks: the list can be narrowed to one course, so decks can be organised by subject");
}
