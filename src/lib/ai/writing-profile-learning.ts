/**
 * Writing-profile learning (2026-10-29).
 *
 * WHAT THIS IS: a pure analyser that looks at the user's OWN writing samples and
 * proposes style adjustments for the user to approve or reject. Nothing is
 * applied automatically, nothing leaves the workspace, and no network call is
 * made. Approved suggestions land in the existing `writing_profiles` table
 * (0001_init.sql) - no new table, no schema change.
 *
 * WHAT THIS IS NOT, deliberately:
 * - It does not analyse, model, or attempt to defeat any AI-detection system.
 * - It makes no claim about who authored any text, and emits no authorship
 *   score, typing speed, pause metric, or "human-ness" estimate.
 * - It cannot be used to fake a revision trail. A previous request asked for
 *   simulated human typing, injected deliberate typos and staggered Word drafts
 *   so a document would *look* written by hand. That was declined and is
 *   recorded in docs/WRITING_PROFILE_LEARNING.md so it is not rebuilt by
 *   accident: manufacturing false evidence of authorship harms the student it
 *   is meant to help.
 *
 * The honest value is the opposite of disguise: help the user write more like
 * themselves, consistently, at the level their course expects.
 */
import { resolveAcademicLevel, type AcademicLevelId } from "./academic-levels";

export interface StyleSuggestion {
  id: string;
  category:
    | "sentence_variation" | "vocabulary" | "transition" | "opening" | "closing"
    // Phase 2B (2026-11-09): the remaining observable dimensions. All are
    // DESCRIPTIVE measurements of the member's own samples - never a claim
    // about who wrote them, and never a detector score.
    | "sentence_length" | "paragraph_organization" | "word_complexity" | "tone"
    | "formality" | "argument_development" | "explanatory_depth" | "citation"
    | "formatting" | "subject_convention" | "corrections" | "explanation_style";
  description: string;
  /** 0-1. Derived from sample count and effect size - never from a model guess. */
  confidence: number;
  scope: "temporary" | "course" | "global";
  requiresApproval: boolean;
  /** Phase 2B: the four preference KINDS the member can reason about.
   *  Kept separate from `scope` so existing stored rows and tests stay valid. */
  scopeKind?: "assignment" | "course" | "subject" | "general";
  /** Course id or subject slug this observation belongs to, when known. */
  scopeKey?: string | null;
  /** How many samples actually support this observation. */
  evidence?: number;
}

const TRANSITIONS = [
  "however", "therefore", "moreover", "furthermore", "in addition", "for example",
  "for instance", "as a result", "consequently", "in contrast", "on the other hand",
  "first", "finally", "in conclusion", "meanwhile", "nevertheless",
];

/** Sample count at which a pattern is trusted enough to outlive one assignment. */
const COURSE_SAMPLE_THRESHOLD = 2;
const GLOBAL_SAMPLE_THRESHOLD = 5;

function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []).filter((w) => w.length > 1);
}

function paragraphsOf(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
}

function mean(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stdev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  return Math.sqrt(mean(nums.map((n) => (n - m) ** 2)));
}

/** Stable, content-free id so the same suggestion is always the same row. */
function stableId(category: string, level: AcademicLevelId): string {
  return `style-${category}-${level}`;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number(n.toFixed(2))));
}

/**
 * PURE. Same samples + level + assignment type always produce the same array.
 * Returns [] rather than inventing advice when there is nothing to observe.
 */
export interface StyleEvidenceOptions {
  /** Subject slug (maths, history, ...): enables subject-scoped conventions. */
  subject?: string | null;
  /** Course id: ties course-scoped observations to a real course. */
  courseId?: string | null;
  /** The member's OWN corrections to their own text (pairs), if provided. */
  corrections?: Array<{ before: string; after: string }>;
}

export function proposeStyleSuggestions(
  samples: string[],
  academicLevel: string,
  assignmentType: string,
  options: StyleEvidenceOptions = {}
): StyleSuggestion[] {
  const clean = (samples ?? []).filter((s) => typeof s === "string" && s.trim().length > 0);
  const spec = resolveAcademicLevel(academicLevel);
  const level: AcademicLevelId = spec?.id ?? "custom";
  const levelLabel = spec?.label ?? "your level";
  const task = (assignmentType ?? "").trim().toLowerCase();

  if (clean.length === 0) return [];

  const allSentences = clean.flatMap(sentencesOf);
  if (allSentences.length < 3) return [];

  // Scope grows with evidence, never with a single correction (section 4's rule:
  // one assignment's fix must not rewrite the whole profile).
  const scope: StyleSuggestion["scope"] =
    clean.length >= GLOBAL_SAMPLE_THRESHOLD ? "global"
    : clean.length >= COURSE_SAMPLE_THRESHOLD ? "course"
    : "temporary";

  const sampleFactor = Math.min(1, clean.length / GLOBAL_SAMPLE_THRESHOLD);
  const out: StyleSuggestion[] = [];

  // --- sentence length variation -------------------------------------------
  const lens = allSentences.map((s) => wordsOf(s).length).filter((n) => n > 0);
  const spread = stdev(lens);
  const avg = mean(lens);
  if (lens.length >= 3 && avg > 0) {
    // Low spread = monotone prose. Elementary/middle writers are expected to be
    // even; at higher levels flatness reads as under-developed argument.
    const flat = spread < 4;
    const veryLong = avg > 26;
    if (flat || veryLong) {
      out.push({
        id: stableId("sentence_variation", level),
        category: "sentence_variation",
        description: flat
          ? `Your sentences are close to a single length (about ${Math.round(avg)} words, spread ${spread.toFixed(1)}). For ${levelLabel} writing, mixing one short sentence among longer ones will make your argument easier to follow.`
          : `Your sentences average about ${Math.round(avg)} words, which is long for ${levelLabel} work. Splitting the longest ones would help a reader follow each step.`,
        confidence: clamp01(0.4 + sampleFactor * 0.5),
        scope,
        requiresApproval: true,
      });
    }
  }

  // --- vocabulary level ----------------------------------------------------
  const words = clean.flatMap(wordsOf);
  if (words.length >= 20) {
    const avgLen = mean(words.map((w) => w.length));
    const unique = new Set(words).size;
    const variety = unique / words.length;
    if (variety < 0.42) {
      out.push({
        id: stableId("vocabulary", level),
        category: "vocabulary",
        description: `You reuse a fairly small set of words (${unique} different words across ${words.length}). Naming things more precisely, rather than repeating the same verb or noun, is the usual fix at ${levelLabel} level.`,
        confidence: clamp01(0.35 + sampleFactor * 0.5),
        scope,
        requiresApproval: true,
      });
    } else if (avgLen > 7.2) {
      out.push({
        id: stableId("vocabulary", level),
        category: "vocabulary",
        description: `Your words average ${avgLen.toFixed(1)} letters, which is dense. At ${levelLabel} level that can read as inflated; a plainer word is usually stronger where it says the same thing.`,
        confidence: clamp01(0.3 + sampleFactor * 0.45),
        scope,
        requiresApproval: true,
      });
    }
  }

  // --- transition phrases --------------------------------------------------
  const lower = clean.join(" ").toLowerCase();
  const usedTransitions = TRANSITIONS.filter((t) => lower.includes(t));
  if (usedTransitions.length === 0 && allSentences.length >= 6) {
    out.push({
      id: stableId("transition", level),
      category: "transition",
      description: `I did not find a linking phrase between your ideas. Adding one where you move to a new point (for example "as a result" or "in contrast") shows the reader how the parts connect.`,
      confidence: clamp01(0.3 + sampleFactor * 0.4),
      scope,
      requiresApproval: true,
    });
  } else if (usedTransitions.length === 1 && allSentences.length >= 10) {
    out.push({
      id: stableId("transition", level),
      category: "transition",
      description: `You rely on "${usedTransitions[0]}" as your only connector. Varying it would keep the flow from feeling mechanical.`,
      confidence: clamp01(0.35 + sampleFactor * 0.4),
      scope,
      requiresApproval: true,
    });
  }

  // --- paragraph openings --------------------------------------------------
  const paras = clean.flatMap(paragraphsOf);
  if (paras.length >= 3) {
    const openings = paras
      .map((p) => (wordsOf(p)[0] ?? ""))
      .filter((w) => w.length > 0);
    const repeated = openings.filter((w, i) => openings.indexOf(w) !== i);
    if (repeated.length >= 2) {
      out.push({
        id: stableId("opening", level),
        category: "opening",
        description: `${repeated.length + 1} of your paragraphs open with the same word ("${repeated[0]}"). Changing how a paragraph starts is the cheapest way to make a page easier to read.`,
        confidence: clamp01(0.4 + sampleFactor * 0.45),
        scope,
        requiresApproval: true,
      });
    }
  }

  // --- closings ------------------------------------------------------------
  if (task.includes("essay") || task.includes("report") || task.includes("discussion")) {
    const hasClosing = /\b(in conclusion|to conclude|in summary|overall|ultimately)\b/i.test(lower);
    if (!hasClosing && allSentences.length >= 8) {
      out.push({
        id: stableId("closing", level),
        category: "closing",
        description: `This ${task || "piece"} has no closing sentence. A short final sentence that states what the evidence adds up to is expected in ${levelLabel} work.`,
        confidence: clamp01(0.3 + sampleFactor * 0.4),
        scope,
        requiresApproval: true,
      });
    }
  }

  // ---- Phase 2B: the remaining observable dimensions ----------------------
  // Every entry below is a measurement of the member's OWN samples with the
  // sample count attached, and each one is approval-gated like everything
  // else. Nothing here is applied automatically and this analyser is pure.
  const scopeKind: "assignment" | "course" | "subject" | "general" =
    clean.length >= GLOBAL_SAMPLE_THRESHOLD ? "general"
    : options.subject ? "subject"
    : clean.length >= COURSE_SAMPLE_THRESHOLD ? "course"
    : "assignment";
  const scopeKey = options.subject ?? options.courseId ?? null;
  const pushExtra = (
    category: StyleSuggestion["category"],
    description: string,
    confidence: number
  ) => {
    out.push({
      id: stableId(category, level),
      category,
      description,
      confidence: clamp01(confidence),
      scope,
      requiresApproval: true,
      scopeKind,
      scopeKey,
      evidence: clean.length,
    });
  };

  const sentLens = allSentences.map((sn) => wordsOf(sn).length).filter((n) => n > 0);
  const meanLen = mean(sentLens);
  const lenSpread = stdev(sentLens);

  // 2. sentence-length preferences
  if (sentLens.length >= 6 && (lenSpread < 3 || meanLen < 9 || meanLen > 27)) {
    pushExtra(
      "sentence_length",
      lenSpread < 3
        ? `Your sentences run about the same length (average ${meanLen.toFixed(1)} words, very little variation). Varying long and short sentences makes technical passages easier to follow; that is a style preference, not an error.`
        : `Your sentences average ${meanLen.toFixed(1)} words. Keeping most within roughly ${Math.max(6, Math.round(meanLen - spread))}-${Math.round(meanLen + lenSpread)} words would match how you already write.`,
      0.35 + sampleFactor * 0.45
    );
  }

  // 3. paragraph organization
  if (paras.length >= 2) {
    const perPara = mean(paras.map((p) => sentencesOf(p).length));
    if (perPara < 2 || perPara > 8) {
      pushExtra(
        "paragraph_organization",
        perPara < 2
          ? `Your paragraphs are very short (about ${perPara.toFixed(1)} sentences each). Grouping related sentences into one paragraph of three to five would match the shape of academic paragraphs.`
          : `Your paragraphs are long (about ${perPara.toFixed(1)} sentences each). Splitting at each change of idea keeps a reader oriented.`,
        0.3 + sampleFactor * 0.4
      );
    }
  }

  // 5. word complexity
  const allWords = clean.flatMap(wordsOf);
  if (allWords.length >= 60) {
    const avgLen = mean(allWords.map((w) => w.length));
    const longShare = allWords.filter((w) => w.length >= 9).length / allWords.length;
    if (avgLen < 4.2 || longShare > 0.18) {
      pushExtra(
        "word_complexity",
        avgLen < 4.2
          ? `Your vocabulary stays on short, common words (average word length ${avgLen.toFixed(1)} letters). That is readable; adding the subject's technical terms is what usually raises the level.`
          : `${(longShare * 100).toFixed(0)}% of your words are nine letters or longer. That is dense. Keeping the same exact terms but unpacking a few of them helps a reader keep up.`,
        0.3 + sampleFactor * 0.35
      );
    }
  }

  // 6. tone (measured, described, never scored for authorship)
  if (allSentences.length >= 6) {
    const q = allSentences.filter((sn) => /\?\s*$/.test(sn)).length / allSentences.length;
    const firstPerson = allWords.filter((w) => w === "i" || w === "we" || w === "my" || w === "our").length / Math.max(1, allWords.length);
    pushExtra(
      "tone",
      q < 0.03 && firstPerson < 0.01
        ? "Your writing is consistently declarative: statements carry the argument and you rarely use questions or first person. That fits most academic tasks; keep it unless the task asks you to reflect."
        : firstPerson >= 0.01
          ? "You write about yourself directly (first person appears regularly). That suits reflection and lab notes; most analytical essays expect it in the introduction only."
          : "Your writing mixes statements with occasional questions. That is a legitimate way to set up a problem; just make sure each question is answered explicitly.",
      0.3 + sampleFactor * 0.35
    );
  }

  // 7. formality
  if (allWords.length >= 60) {
    const contractions = (clean.join(" ").match(/\b\w+'(s|t|re|ve|ll|d|m)\b/gi) ?? []).length;
    const per100 = (contractions / allWords.length) * 100;
    pushExtra(
      "formality",
      per100 >= 1
        ? `Contractions ("don't", "it's") appear about ${per100.toFixed(1)} times per 100 words. That reads as conversational; most academic submissions expect the uncontracted form.`
        : "Your register is formal: contractions are rare or absent. That matches academic writing and needs no change unless the task asks for a personal voice.",
      0.3 + sampleFactor * 0.35
    );
  }

  // 8. argument development
  if (paras.length >= 2) {
    const reasons = paras.filter((p) => /\b(because|therefore|as a result|since|which shows|evidence|this means)\b/i.test(p)).length;
    if (reasons / paras.length < 0.6) {
      pushExtra(
        "argument_development",
        `Only ${reasons} of your ${paras.length} paragraphs show an explicit reason or link. Naming why a point follows from the evidence is what turns a summary into an argument.`,
        0.35 + sampleFactor * 0.4
      );
    }
  }

  // 9. explanatory depth
  if (paras.length >= 2) {
    const explains = paras.filter((p) => /\b(for example|for instance|in other words|that is|such as|meaning that)\b/i.test(p)).length;
    if (explains / paras.length < 0.4) {
      pushExtra(
        "explanatory_depth",
        `${explains} of your ${paras.length} paragraphs explain a term or give an example. One worked example per difficult idea is usually what a reader needs.`,
        0.3 + sampleFactor * 0.35
      );
    }
  }

  // 13. citation and referencing preferences
  if (lower.length >= 400) {
    const joined = clean.join("\n");
    const apaLike = (joined.match(/\([A-Z][A-Za-z]+(?: et al\.)?,? \d{4}[a-z]?\)/g) ?? []).length;
    const numeric = (joined.match(/\[\d+\]/g) ?? []).length;
    const footnotes = (joined.match(/^\s*\d+\.\s+\S/gm) ?? []).length;
    if (apaLike + numeric + footnotes > 0) {
      pushExtra(
        "citation",
        apaLike >= numeric && apaLike >= footnotes
          ? `Your in-text references follow the author-year form (${apaLike} found). I will keep placing citations in that form.`
          : numeric >= footnotes
            ? `Your in-text references use numbered brackets (${numeric} found). I will keep that numbering scheme.`
            : `You cite with numbered notes (${footnotes} found). I will keep that pattern.`,
        0.45 + sampleFactor * 0.4
      );
    }
  }

  // 14. formatting preferences
  if (clean.some((c) => c.includes("\n"))) {
    const hasHeadings = clean.some((c) => /^#{1,3} \S/m.test(c));
    const hasBullets = clean.some((c) => /^\s*[-*] \S/m.test(c));
    pushExtra(
      "formatting",
      hasHeadings
        ? "Your samples use section headings. I will keep structuring answers with headings rather than one long block."
        : hasBullets
          ? "Your samples use bullet lists for enumerations. I will keep using lists where a list is genuinely clearer."
          : "Your samples are continuous prose with no headings or lists. I will keep answers in continuous prose unless you ask for a list.",
      0.35 + sampleFactor * 0.35
    );
  }

  // 15. subject-specific conventions (only when the member tells us the subject)
  if (options.subject) {
    pushExtra(
      "subject_convention",
      `These samples are recorded as ${options.subject} writing for you. Subject-specific conventions (notation, units, citation style) apply only to ${options.subject} work, not to everything you write.`,
      0.4 + sampleFactor * 0.3
    );
  }

  // 16. the member's own corrections - the strongest evidence there is, and
  // deliberately the NARROWEST scope: a single assignment correction can never
  // rewrite the whole profile (see mayOverrideProfile below).
  const corrections = options.corrections ?? [];
  if (corrections.length > 0) {
    const shortened = corrections.filter((c) => wordsOf(c.after).length < wordsOf(c.before).length).length;
    const expanded = corrections.filter((c) => wordsOf(c.after).length > wordsOf(c.before).length).length;
    out.push({
      id: stableId("corrections", level),
      category: "corrections",
      description: shortened > expanded
        ? `In ${shortened} of your ${corrections.length} corrections you shortened the text. Tightening is your habit, so I will offer shorter phrasings first.`
        : `In ${expanded} of your ${corrections.length} corrections you expanded the text. Adding explanation is your habit, so I will explain more rather than less.`,
      confidence: clamp01(0.3 + Math.min(1, corrections.length / 5) * 0.4),
      scope: "temporary",
      requiresApproval: true,
      scopeKind: "assignment",
      scopeKey: options.courseId ?? null,
      evidence: corrections.length,
    });
  }

  // 17. preferred ways of explaining ideas
  if (allSentences.length >= 5) {
    const analogies = (clean.join(" ").match(/\b(like|as if|think of|imagine|similar to)\b/gi) ?? []).length;
    const definitions = (clean.join(" ").match(/\b(means that|is defined as|refers to|is called)\b/gi) ?? []).length;
    pushExtra(
      "explanation_style",
      analogies > definitions
        ? "You explain ideas by comparing them to something familiar. I will keep using one clear comparison before the formal definition."
        : definitions > analogies
          ? "You explain ideas by defining terms precisely. I will define a term the first time it appears rather than by analogy."
          : "You explain ideas plainly, without analogies or formal definitions. I will match that directness and only define a term when the task needs it.",
      0.3 + sampleFactor * 0.35
    );
  }


  // Phase 2B: every observation carries the same scope metadata, including
  // the five original categories (fields are optional, so stored rows and
  // older consumers keep working unchanged).
  for (const sug of out) {
    if (!sug.scopeKind) {
      sug.scopeKind =
        sug.scope === "global" ? "general"
        : sug.scope === "course" ? (options.subject ? "subject" : "course")
        : "assignment";
    }
    if (sug.evidence === undefined) sug.evidence = clean.length;
    if (sug.scopeKey === undefined) sug.scopeKey = options.subject ?? options.courseId ?? null;
  }

  // Deterministic order: category name, so the same input always matches.
  return out.sort((a, b) => a.category.localeCompare(b.category));
}

/**
 * Phase 2B guard: may an incoming observation replace an existing approved
 * preference? Narrower evidence NEVER wins over broader evidence, and a
 * broader claim needs proportionally more support. Pure; used by the route
 * before any proposal is created, so a single assignment correction can never
 * rewrite a member's whole profile.
 */
export function mayOverrideProfile(
  existing: { scope: "temporary" | "course" | "global"; evidence?: number },
  incoming: { scope: "temporary" | "course" | "global"; evidence?: number }
): boolean {
  const rank = { temporary: 0, course: 1, global: 2 } as const;
  const ev = (n?: number) => Math.max(0, n ?? 1);
  if (rank[incoming.scope] < rank[existing.scope]) return false;
  if (incoming.scope === "global" && ev(incoming.evidence) < GLOBAL_SAMPLE_THRESHOLD) return false;
  if (incoming.scope === "course" && ev(incoming.evidence) < COURSE_SAMPLE_THRESHOLD) return false;
  return true;
}
