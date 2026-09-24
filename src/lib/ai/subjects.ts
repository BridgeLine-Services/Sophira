/**
 * Subject router (spec §8, §9): routes a classified task to a specialized
 * academic workflow with subject-appropriate prompting and verification.
 *
 * Each workflow declares:
 *   - extraSystem: subject-specific instructions appended to the system prompt
 *   - machineVerifiable: whether deterministic/independent verification is
 *     practical for this subject (math only for now — mathjs identities)
 *   - verificationNote: honest description of what verification CAN be done
 */

export type SubjectWorkflow =
  | "mathematics" | "chemistry" | "biology" | "physics"
  | "computer_science" | "writing_humanities" | "history_social"
  | "research" | "general_academic";

export interface WorkflowModule {
  id: SubjectWorkflow;
  label: string;
  extraSystem: string;
  machineVerifiable: boolean;
  verificationNote: string;
}

const WORKFLOWS: Record<SubjectWorkflow, WorkflowModule> = {
  mathematics: {
    id: "mathematics",
    label: "Mathematics",
    extraSystem: `MATHEMATICS WORKFLOW:
- Follow the teacher's required method exactly when known (substitution, integration by parts, partial fractions, specific formulas, notation, order of work). If the teacher requires a specific method, do NOT substitute another method without explaining why and asking.
- Show every required step, including substitutions and transformations, and explain them.
- Preserve exact values when appropriate; clearly separate exact answers from approximations.
- Include units when required; respect calculator and formula restrictions.
- Never skip a required step just because the final answer is correct.
- After solving, re-derive the final result by an independent method when practical (e.g. substitution check, numerical spot-check, estimation) and report it in the verification checks.
- If the task involves arithmetic claims, ALSO provide machine_checks (see the response format): simple expressions the server can recompute.`,
    machineVerifiable: true,
    verificationNote: "Arithmetic identities re-computed independently with mathjs; method compliance self-checked by the AI.",
  },
  chemistry: {
    id: "chemistry",
    label: "Chemistry",
    extraSystem: `CHEMISTRY WORKFLOW:
- Identify knowns/unknowns, state assumptions, use correct equations, units, and significant figures.
- Show substitutions, track units through dimensional analysis, and check conservation (atoms, mass, charge) where applicable.
- Never invent experimental data; distinguish given data from calculated values.`,
    machineVerifiable: true, // molar-mass/stoichiometry arithmetic can be machine-checked
    verificationNote: "Stoichiometric arithmetic re-computed independently with mathjs; chemistry reasoning self-checked by the AI.",
  },
  physics: {
    id: "physics",
    label: "Physics",
    extraSystem: `PHYSICS WORKFLOW:
- Identify knowns/unknowns and assumptions; select the governing equations and justify them.
- Show substitutions with units, check dimensional consistency, and sanity-check magnitudes.
- Distinguish exact from approximate results; report propagation of uncertainty where relevant.
- Never fabricate observations or measurements.`,
    machineVerifiable: true,
    verificationNote: "Numeric substitutions re-computed independently with mathjs; physical reasoning self-checked by the AI.",
  },
  biology: {
    id: "biology",
    label: "Biology",
    extraSystem: `BIOLOGY WORKFLOW:
- Use correct terminology and distinguish established biological fact from inference.
- For lab reports, clearly separate the student's actual observations from hypothetical or example data.
- Note when a claim would require a source the student must verify.`,
    machineVerifiable: false,
    verificationNote: "Self-checked by the AI (conceptual subjects cannot be machine-verified).",
  },
  computer_science: {
    id: "computer_science",
    label: "Computer Science",
    extraSystem: `COMPUTER SCIENCE WORKFLOW:
- Explain code and reasoning at the student's level; walk through example inputs where useful.
- NEVER claim code was executed or tested unless it actually was — say "review by inspection" instead.
- Note edge cases, complexity, and correctness assumptions explicitly.`,
    machineVerifiable: false,
    verificationNote: "Self-checked by the AI (code is not executed).",
  },
  writing_humanities: {
    id: "writing_humanities",
    label: "Writing & Humanities",
    extraSystem: `WRITING/HUMANITIES WORKFLOW:
- Follow the assignment prompt, required length/structure, citation style, and rubric.
- Apply the student's approved Writing Profile only where it does not violate requirements.
- NEVER fabricate quotations, page numbers, sources, citations, or research evidence. If a needed source is not available, say so and ask the student to provide it.
- Distinguish the student's actual position/evidence from suggested framings.`,
    machineVerifiable: false,
    verificationNote: "Self-checked by the AI (prose cannot be machine-verified).",
  },
  history_social: {
    id: "history_social",
    label: "History & Social Science",
    extraSystem: `HISTORY/SOCIAL SCIENCE WORKFLOW:
- Distinguish established historical fact from interpretation and inference.
- Never invent quotes, dates, or sources; state uncertainty explicitly.
- When citing evidence, note whether the student should verify it against their course materials.`,
    machineVerifiable: false,
    verificationNote: "Self-checked by the AI.",
  },
  research: {
    id: "research",
    label: "Research / Advanced",
    extraSystem: `RESEARCH/PHD WORKFLOW:
- Identify uncertainty explicitly; distinguish established information from inference and missing evidence.
- Do NOT fabricate citations — if you cannot verify a source exists, say so plainly.
- Encourage primary sources; clearly state when a claim cannot be independently verified.
- Support literature synthesis, research organization, technical writing, and exploration — without pretending every research problem is solvable.`,
    machineVerifiable: false,
    verificationNote: "Self-checked by the AI; claims requiring sources flagged for student verification.",
  },
  general_academic: {
    id: "general_academic",
    label: "General Academic",
    extraSystem: `GENERAL ACADEMIC WORKFLOW:
- Adapt depth and vocabulary to the student's academic level.
- Show reasoning steps; be explicit about assumptions and uncertainty.`,
    machineVerifiable: false,
    verificationNote: "Self-checked by the AI.",
  },
};

/** Maps a free-text subject (from classification or course) to a workflow. Pure. */
export function routeSubject(subject: string | null | undefined, taskType?: string | null): WorkflowModule {
  const s = (subject || "").toLowerCase();
  const t = (taskType || "").toLowerCase();
  if (/(math|calcul|algebra|geometr|trigonometr|statistic|linear algebra|differential equation|arithmetic|precalc)/.test(s)) {
    return WORKFLOWS.mathematics;
  }
  if (/chem/.test(s)) return WORKFLOWS.chemistry;
  if (/physic/.test(s)) return WORKFLOWS.physics;
  if (/bio(life|logy)?\b|biolog/.test(s)) return WORKFLOWS.biology;
  if (/(computer science|programming|coding|software|algorithm|cs\b)/.test(s)) return WORKFLOWS.computer_science;
  if (/(histor|social|geograph|government|politic|economic|anthropolog|psycholog)/.test(s)) return WORKFLOWS.history_social;
  if (/(research|thesis|dissertation|literature review|phd)/.test(s) || /research/.test(t)) return WORKFLOWS.research;
  if (/(writ|essay|literat|english|composit|reading|journal|reflect|discussion)/.test(s) || /essay|discussion|reflect|report/.test(t)) {
    return WORKFLOWS.writing_humanities;
  }
  return WORKFLOWS.general_academic;
}

/* ------------------------------------------------------------------ */
/* Fine-grained mathematics workflows (upgrade spec §1)                 */
/* ------------------------------------------------------------------ */

export type MathTopic =
  | "arithmetic" | "pre_algebra" | "algebra" | "geometry" | "trigonometry"
  | "precalculus" | "calculus_1" | "calculus_2" | "calculus_3"
  | "differential_equations" | "linear_algebra" | "statistics"
  | "probability" | "discrete_math" | "proof_based" | "general_math";

export interface MathTopicModule {
  id: MathTopic;
  label: string;
  extraSystem: string;
}

const MATH_TOPICS: Record<MathTopic, MathTopicModule> = {
  arithmetic: { id: "arithmetic", label: "Arithmetic", extraSystem: "ARITHMETIC: show each operation in order (PEMDAS); keep exact fractions/decimals; verify the final value numerically via machine_checks." },
  pre_algebra: { id: "pre_algebra", label: "Pre-algebra", extraSystem: "PRE-ALGEBRA: isolate variables one operation at a time; show the inverse operation on both sides for every step." },
  algebra: { id: "algebra", label: "Algebra", extraSystem: "ALGEBRA: show every transformation (expand, factor, combine like terms, inverse operations); state what each step does; check solutions by substitution and record it as an equation_check machine check." },
  geometry: { id: "geometry", label: "Geometry", extraSystem: "GEOMETRY: state the theorem or formula used before substituting; draw (describe) the setup in words; include units; exact values (radicals, π) unless the problem asks to approximate." },
  trigonometry: { id: "trigonometry", label: "Trigonometry", extraSystem: "TRIGONOMETRY: prefer exact unit-circle values unless told otherwise; state identities used; include domain/period considerations; verify identities numerically via equation_check at sample angles." },
  precalculus: { id: "precalculus", label: "Precalculus", extraSystem: "PRECALULUS: show function transformations explicitly; complete the square/factoring steps fully; exact values unless approximation is requested." },
  calculus_1: { id: "calculus_1", label: "Calculus I", extraSystem: "CALCULUS I (limits/derivatives/applications): state the rule used for each derivative (power, product, quotient, chain); show full substitution; use the teacher's required method; verify derivatives symbolically via a derivative machine check." },
  calculus_2: { id: "calculus_2", label: "Calculus II", extraSystem: "CALCULUS II (integration/series): name the technique before using it (u-substitution, parts, partial fractions, trig sub); show the substitution variable and differential EXPLICITLY; preserve constant bounds when transforming; verify antiderivatives by differentiation via a derivative machine check." },
  calculus_3: { id: "calculus_3", label: "Calculus III", extraSystem: "CALCULUS III (multivariable): compute partial derivatives one variable at a time, stating which is held constant; show all coordinate-transform Jacobians; verify numeric results via machine checks." },
  differential_equations: { id: "differential_equations", label: "Differential Equations", extraSystem: "DIFFERENTIAL EQUATIONS: classify the equation type first; state why the chosen method applies; show the integrating factor/separation/characteristic equation fully; verify solutions by substituting back (equation_check)." },
  linear_algebra: { id: "linear_algebra", label: "Linear Algebra", extraSystem: "LINEAR ALGEBRA: show row operations one at a time; state the theorem used (rank, span, independence, eigenvalue definition); present matrices in the teacher's notation; verify determinants/products via matrix machine checks." },
  statistics: { id: "statistics", label: "Statistics", extraSystem: "STATISTICS: state the formula before substituting; distinguish sample vs population statistics; carry intermediate precision and round only at the end per the teacher's rules; verify computations via stats machine checks." },
  probability: { id: "probability", label: "Probability", extraSystem: "PROBABILITY: define the sample space and events; state the rule used (complement, conditional, independence, Bayes); probabilities stay in [0,1]; verify arithmetic via machine checks." },
  discrete_math: { id: "discrete_math", label: "Discrete Mathematics", extraSystem: "DISCRETE MATH: show induction base case and inductive step fully; for combinatorics, state whether order matters and whether repetition is allowed; truth tables are complete." },
  proof_based: { id: "proof_based", label: "Proof-based Mathematics", extraSystem: "PROOFS: state the claim precisely, then the proof strategy; every assertion must follow from the previous line or a named theorem; never hide steps behind 'clearly' or 'obviously'; end with Q.E.D. or the required closing; do not claim machine verification of proofs — label verification honestly." },
  general_math: { id: "general_math", label: "Mathematics", extraSystem: "" },
};

/**
 * Routes a math task to its fine-grained topic workflow from the question text
 * and detected subject. Pure; unit-tested.
 */
export function routeMathTopic(questionText: string, subject: string | null | undefined): MathTopicModule {
  const q = questionText.toLowerCase();
  const s = (subject || "").toLowerCase();

  if (/∫|integral|integrat/.test(q) || /integral|series|sequence/.test(s)) {
    if (/partial fraction|integration by parts|trig(onometric)?(al)? subst/.test(q) || /calc(ulus)? ?(2|ii)/.test(s)) {
      return MATH_TOPICS.calculus_2;
    }
    return MATH_TOPICS.calculus_2;
  }
  if (/d[yx]\/d|derivativ|differentiat|limit/.test(q) || /calc(ulus)? ?(1|i)\b/.test(s)) return MATH_TOPICS.calculus_1;
  if (/partial derivative|gradient|curl|diverg|jacobian|lagrange|multivariable|double integral|triple integral|surface integral/.test(q) || /calc(ulus)? ?(3|iii)/.test(s)) return MATH_TOPICS.calculus_3;
  if (/(differential equation|ode|dy\/dx =|homogeneous solution|integrating factor)/.test(q) || /differential equation/.test(s)) return MATH_TOPICS.differential_equations;
  if (/(matrix|matrices|determinant|eigen|vector space|linear (in)?dependence|span|rank)/.test(q) || /linear algebra/.test(s)) return MATH_TOPICS.linear_algebra;
  if (/(probability|bayes|coin|dice|combinator|permutation|binomial (coefficient|distribution)|p\()/.test(q) || /probability/.test(s)) return MATH_TOPICS.probability;
  if (/(mean|median|standard deviation|variance|confidence interval|hypothes|z-score|t-test|regression)/.test(q) || /statistic/.test(s)) return MATH_TOPICS.statistics;
  if (/(prove|proof|theorem|lemma|induction|contradiction|q\.e\.d)/.test(q)) return MATH_TOPICS.proof_based;
  if (/(logic|truth table|graph theory|discrete|mod(ul)?o|set theory|recurrence relation)/.test(q) || /discrete/.test(s)) return MATH_TOPICS.discrete_math;
  if (/(triangle|circle|angle|area of|perimeter|pythagor|congruent|similar polygon)/.test(q) || /geometr/.test(s)) return MATH_TOPICS.geometry;
  if (/(sin|cos|tan|sec|csc|cot|identity|radian|unit circle)/.test(q) || /trigonometr/.test(s)) return MATH_TOPICS.trigonometry;
  if (/(precalc|asymptote|conic|exponential function|logarithm|composite function|function transformation)/.test(q) || /precalc/.test(s)) return MATH_TOPICS.precalculus;
  if (/(solve for|equation|inequality|factor|quadratic|polynomial|simplify|system of)/.test(q) || /algebra/.test(s)) return MATH_TOPICS.algebra;
  if (/(isolate|variable|order of operations|pemdas)/.test(q) || /pre.?algebra/.test(s)) return MATH_TOPICS.pre_algebra;
  if (/(divide|multiply|add|subtract|fraction|decimal|percent)/.test(q) || /arithmetic/.test(s)) return MATH_TOPICS.arithmetic;
  return MATH_TOPICS.general_math;
}
