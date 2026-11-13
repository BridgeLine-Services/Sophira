/**
 * DECK ASSEMBLY (2026-11-13, directive Part 6).
 *
 * Turning a GENERATED flashcards artifact into real, studyable cards.
 *
 * The artifact already exists and already carries provenance: each section has a
 * heading, exactly two items ("Q: …" and "A: …") and the source labels it draws
 * from. This module converts that into cards WITHOUT inventing content: a
 * section that does not have a question and an answer is skipped and reported,
 * never filled in with a guess.
 *
 * Pure: no DB, no network, no clock. The route does the IO.
 */

export interface ArtifactSection {
  heading?: string;
  items?: string[];
  sources?: string[];
  citations?: string[];
}

export interface ArtifactLike {
  title?: string;
  type?: string;
  sections?: ArtifactSection[];
}

export interface BuiltCard {
  front: string;
  back: string;
  citation: string;
  position: number;
}

export interface BuildResult {
  title: string;
  cards: BuiltCard[];
  /** Sections that could not become a card, with the reason. Never silent. */
  skipped: { heading: string; reason: string }[];
}

const Q_PREFIX = /^\s*Q\s*[:.)]\s*/i;
const A_PREFIX = /^\s*A\s*[:.)]\s*/i;

export const MAX_CARDS_PER_DECK = 200;
export const MAX_FRONT_CHARS = 500;
export const MAX_BACK_CHARS = 2000;

function clean(text: string, max: number): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * Build cards from a stored flashcards artifact.
 * Returns skipped sections so the UI can say "3 sections had no question/answer"
 * instead of quietly producing a smaller deck.
 */
export function cardsFromArtifact(artifact: ArtifactLike, fallbackTitle = "Untitled deck"): BuildResult {
  const skipped: { heading: string; reason: string }[] = [];
  const cards: BuiltCard[] = [];
  const sections = Array.isArray(artifact.sections) ? artifact.sections : [];
  if (sections.length === 0) {
    return { title: clean(artifact.title || fallbackTitle, 160), cards, skipped: [{ heading: artifact.title || fallbackTitle, reason: "the artifact has no sections to turn into cards" }] };
  }
  for (const section of sections) {
    const heading = clean(section.heading || "", 120) || "untitled card";
    const items = Array.isArray(section.items) ? section.items.filter((i) => typeof i === "string" && i.trim()) : [];
    if (items.length < 2) {
      skipped.push({ heading, reason: "the section does not have both a question and an answer" });
      continue;
    }
    const question = items.find((i) => Q_PREFIX.test(i)) ?? items[0];
    const answer = items.find((i) => A_PREFIX.test(i) && i !== question) ?? items.find((i) => i !== question);
    const front = clean(String(question).replace(Q_PREFIX, ""), MAX_FRONT_CHARS);
    const back = clean(String(answer ?? "").replace(A_PREFIX, ""), MAX_BACK_CHARS);
    if (!front || !back) {
      skipped.push({ heading, reason: "the question or the answer was empty after cleaning" });
      continue;
    }
    const citation = (section.citations ?? []).filter(Boolean).slice(0, 3).join(" ");
    cards.push({ front, back, citation, position: cards.length });
    if (cards.length >= MAX_CARDS_PER_DECK) break;
  }
  return { title: clean(artifact.title || fallbackTitle, 160), cards, skipped };
}

/** A hand-written card is normalised the same way, so both paths store clean text. */
export function normalizeCard(input: { front?: unknown; back?: unknown; citation?: unknown }, position = 0): BuiltCard | null {
  const front = clean(typeof input.front === "string" ? input.front.replace(Q_PREFIX, "") : "", MAX_FRONT_CHARS);
  const back = clean(typeof input.back === "string" ? input.back.replace(A_PREFIX, "") : "", MAX_BACK_CHARS);
  if (!front || !back) return null;
  return { front, back, citation: clean(typeof input.citation === "string" ? input.citation : "", 200), position };
}

/** Cards queued for one session: due first, then new cards, never retired ones. */
export function buildQueue<T extends { dueAt: string; reps: number; retired?: boolean }>(
  cards: T[],
  nowISO: string,
  limit = 20,
): { queue: T[]; due: number; newCards: number } {
  const live = cards.filter((c) => !c.retired);
  const due = live.filter((c) => Date.parse(c.dueAt) <= Date.parse(nowISO));
  const fresh = live.filter((c) => c.reps === 0 && Date.parse(c.dueAt) > Date.parse(nowISO));
  const queue = [...due, ...fresh].slice(0, Math.max(0, limit));
  return { queue, due: due.length, newCards: fresh.length };
}
