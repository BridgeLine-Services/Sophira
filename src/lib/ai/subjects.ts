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
