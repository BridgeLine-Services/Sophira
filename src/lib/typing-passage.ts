/**
 * Canonical reference passages for typing calibration (spec §9).
 *
 * The server hands out a passage; the user types it; the SERVER recomputes
 * WPM/accuracy/net WPM against this same reference before storing anything
 * (see /api/typing). The client cannot submit its own reference text, so a
 * tampered client cannot inflate its speed with an easy passage.
 *
 * Passages are chosen to be: academic in register, neutral in content,
 * ~250-300 characters, and free of numbers/special characters that would
 * unfairly punish common keyboards.
 */

export interface TypingPassage {
  id: string;
  text: string;
}

export const TYPING_PASSAGES: TypingPassage[] = [
  {
    id: "scholar",
    text:
      "Good notes are not a record of everything said, but a map of what matters. " +
      "When you review, you should be able to follow your own thinking weeks later. " +
      "Write down the ideas, not just the words, and the rest of your study will follow.",
  },
  {
    id: "draft",
    text:
      "The first draft exists so the second one can exist. Do not polish a sentence " +
      "before the paragraph has a direction, and do not chase the perfect word when the " +
      "idea is still loose. Momentum first; refinement after. That is how writing gets written.",
  },
  {
    id: "problem",
    text:
      "Read the problem twice before touching your pencil. List what you are given, " +
      "what you are asked for, and the rules that connect them. Most wrong answers come " +
      "not from bad algebra but from answering a question nobody asked.",
  },
];

export function passageById(id: string): TypingPassage | null {
  return TYPING_PASSAGES.find((p) => p.id === id) ?? null;
}

/** Pick a deterministic passage for a session (stable within a session). */
export function pickPassage(seed: string): TypingPassage {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TYPING_PASSAGES[h % TYPING_PASSAGES.length];
}
