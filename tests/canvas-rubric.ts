/**
 * CANVAS RUBRIC DISPLAY (Phase 4, 2026-11-02).
 *
 * The rubric arrives from a third party as untrusted JSON. These tests pin the two rules
 * that matter: Sophira never invents grading criteria, and a broken or hostile payload
 * can never produce a wrong number or an unbounded wall of text.
 */
import { readFileSync } from "node:fs";
import {
  RUBRIC_LIMITS,
  parseRubric,
  plainText,
  rubricPointsTotal,
  safeCanvasUrl,
  submissionTypeLabel,
} from "../src/lib/integrations/canvas-rubric";

export function runCanvasRubricTests(
  assert: (c: boolean, n: string) => void,
  section: (t: string) => void,
): void {
  section("canvas rubric (untrusted input, no invention)");

  // Absence is respected: nothing in, nothing out.
  assert(parseRubric(null).length === 0 && parseRubric(undefined).length === 0,
    "rubric: missing data yields no criteria, never a default set");
  assert(parseRubric({}).length === 0 && parseRubric("nonsense").length === 0 && parseRubric(42).length === 0,
    "rubric: an unusable payload yields no criteria rather than a fabricated rubric");
  assert(parseRubric([]).length === 0, "rubric: an empty list stays empty");

  // Both shapes Canvas actually returns.
  const fromArray = parseRubric([
    { id: "1", description: "Thesis", points: 10, ratings: [{ description: "Strong", points: 10 }] },
  ]);
  assert(fromArray.length === 1 && fromArray[0].description === "Thesis" && fromArray[0].points === 10,
    "rubric: the array shape Canvas returns is parsed");
  assert(fromArray[0].ratings.length === 1 && fromArray[0].ratings[0].description === "Strong",
    "rubric: performance levels are preserved");
  const fromObject = parseRubric({ criteria: [{ description: "Evidence", points: 5 }] });
  assert(fromObject.length === 1 && fromObject[0].description === "Evidence",
    "rubric: the wrapped criteria shape is parsed");

  // Third-party markup must never reach the page as markup.
  assert(plainText("<p>Uses <b>sources</b> well</p>") === "Uses sources well",
    "rubric: HTML is stripped to plain text");
  assert(plainText("Tom &amp; Jerry&#39;s &quot;essay&quot;") === `Tom & Jerry's "essay"`,
    "rubric: common entities are decoded");
  assert(plainText("line one\n\n   line   two") === "line one line two",
    "rubric: whitespace and control characters collapse to one line");
  const markup = parseRubric([{ description: "<script>alert(1)</script>Cite sources" }]);
  assert(!markup[0].description.includes("<") && markup[0].description.includes("Cite sources"),
    "rubric: a hostile description is stored as plain text, not executable markup");

  // Numbers: unknown stays unknown instead of becoming a believable zero.
  assert(parseRubric([{ description: "x", points: "8" }])[0].points === 8,
    "rubric: a numeric string is read as its number");
  assert(parseRubric([{ description: "x", points: -3 }])[0].points === null,
    "rubric: negative points are treated as unknown, not as a real value");
  assert(parseRubric([{ description: "x", points: "many" }])[0].points === null,
    "rubric: non-numeric points are unknown, never 0");

  // Bounds.
  const many = parseRubric(Array.from({ length: 100 }, (_, i) => ({ description: `c${i}` })));
  assert(many.length === RUBRIC_LIMITS.criteria, `rubric: criteria are capped at ${RUBRIC_LIMITS.criteria}`);
  const noisyLevels = parseRubric([{ description: "x", ratings: Array.from({ length: 50 }, () => ({ description: "l" })) }]);
  assert(noisyLevels[0].ratings.length === RUBRIC_LIMITS.ratings,
    `rubric: performance levels are capped at ${RUBRIC_LIMITS.ratings}`);
  const long = parseRubric([{ description: "a".repeat(5000) }])[0].description;
  assert(long.length <= RUBRIC_LIMITS.textChars && long.endsWith("…"),
    "rubric: long text is truncated visibly, not silently");

  // An unnamed criterion is labelled honestly rather than dropped.
  assert(parseRubric([{ points: 4 }])[0].description === "Untitled criterion",
    "rubric: a criterion without a title is labelled, never invented");

  // Totals must not understate the assignment.
  assert(rubricPointsTotal(fromArray) === 10, "rubric: totals sum known points");
  assert(rubricPointsTotal([{ id: "a", description: "x", longDescription: null, points: 5, ratings: [] },
                            { id: "b", description: "y", longDescription: null, points: null, ratings: [] }]) === null,
    "rubric: a partial total is withheld rather than showing a wrong number");
  assert(rubricPointsTotal([]) === null, "rubric: no criteria means no total");

  // Links.
  assert(safeCanvasUrl("https://school.instructure.com/courses/1/assignments/2") !== null,
    "rubric: an https Canvas link is allowed");
  assert(safeCanvasUrl("http://school.instructure.com/x") === null,
    "rubric: a non-https link is refused");
  assert(safeCanvasUrl("javascript:alert(1)") === null && safeCanvasUrl("not a url") === null,
    "rubric: script and malformed links are refused");
  assert(submissionTypeLabel("online_upload") === "File upload" && submissionTypeLabel("weird_new_type").includes("teacher"),
    "rubric: submission types are explained in student words, with an honest fallback");

  // Wiring and honesty of the screen itself.
  const page = readFileSync("src/app/assignments/[id]/page.tsx", "utf8");
  assert(page.includes("loadCanvasContext(supabase, user.id, assignment.id)") && page.includes("<CanvasAssignmentContext"),
    "workspace: Canvas details are loaded for this student's assignment and rendered");
  const component = readFileSync("src/components/app/CanvasAssignmentContext.tsx", "utf8");
  assert(/came from Canvas/.test(component) && /has not changed them/.test(component),
    "workspace: the section states where the details came from");
  assert(/has not downloaded them/.test(component),
    "workspace: attachments are described as listed, not fetched");
  assert(!/api\/ai|generate|suggest/i.test(component),
    "workspace: the rubric section never generates or suggests grading criteria");
}
