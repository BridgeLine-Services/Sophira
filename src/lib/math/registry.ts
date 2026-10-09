/**
 * UNIVERSAL MATHEMATICS CAPABILITY REGISTRY (2026-10-09)
 *
 * A hierarchical, machine-readable registry of mathematical fields
 * (MSC2020-inspired + interdisciplinary areas), designed for EXTENSION
 * rather than exhaustiveness. Every node carries:
 *   - nested subfields + aliases (for classification)
 *   - prerequisite field ids
 *   - methods the platform can attempt
 *   - the verification STRATEGY appropriate to the field
 *   - an HONEST support status — implemented/tested, partial, or planned.
 *
 * NOTHING here claims coverage. A node with status "planned" means the
 * classification, explanation, and AI-reasoning path exists, but no
 * dedicated deterministic engine is wired in yet. The companion
 * orchestrator (orchestrator.ts) routes problems to engines and records
 * which verification level is actually available for each.
 *
 * Consumers: src/lib/math/orchestrator.ts (routing + honest limits),
 * docs/MATHEMATICS_COVERAGE.md (generated from this file), and the
 * math-registry test suite (integrity + no-dead-ids).
 */

export type SupportStatus =
  | "implemented_tested"      // deterministic engine wired in, regression-tested
  | "implemented_partial"     // engine covers a subset of the field
  | "ai_reasoning"            // LLM reasoning + verification stamps only (no dedicated engine)
  | "planned";               // classified and explained honestly; no engine yet

export type VerificationLevel =
  | "deterministic"  // symbolic/numeric check actually executed (mathjs)
  | "sampled"        // numeric sampling at sample points (equation_check)
  | "numeric"        // finite-difference / numeric method verification
  | "ai_only"        // no machine check possible; honest disclosure
  | "external";      // requires an external CAS/proof tool (not installed)

export interface MathFieldNode {
  id: string;
  title: string;
  msc?: string;                    // MSC2020 top-level class(es) when applicable
  status: SupportStatus;
  aliases: string[];
  subfields?: MathFieldNode[];
  prerequisites?: string[];        // registry ids
  methods: string[];               // strategies the platform may attempt
  verification: VerificationLevel;
  verificationNote?: string;       // honest statement of what IS verified
  testProblems?: string[];         // representative problems covered by the suite
}

export const MATHEMATICS_REGISTRY: MathFieldNode[] = [
  {
    id: "foundations",
    title: "Foundations, logic & history",
    msc: "00-03, 03-XX",
    status: "ai_reasoning",
    aliases: ["logic", "set theory", "axiomatic", "notation", "history of math", "proof writing"],
    methods: ["explain", "strategy"],
    verification: "ai_only",
    verificationNote: "Informal arguments only — no proof assistant installed; never claimed as machine-verified.",
    subfields: [
      { id: "foundations.set-theory", title: "Set theory", status: "ai_reasoning", aliases: ["sets", "venn"], methods: ["explain"], verification: "ai_only", prerequisites: [] },
      { id: "foundations.logic", title: "Mathematical & modal logic", status: "ai_reasoning", aliases: ["predicate logic", "modal logic", "temporal logic", "fuzzy logic"], methods: ["explain", "strategy"], verification: "ai_only" },
      { id: "foundations.lambda-calculus", title: "Lambda calculus & type theory", status: "planned", aliases: ["homotopy type theory", " hott"], methods: ["explain"], verification: "ai_only" },
      { id: "foundations.recursion", title: "Computability & algorithmic randomness", status: "planned", aliases: ["kolmogorov complexity", "computability"], methods: ["explain"], verification: "ai_only" },
    ],
  },
  {
    id: "algebra",
    title: "Algebra",
    msc: "08-XX, 12-XX, 13-XX, 15-XX, 16-XX, 17-XX, 18-XX, 20-XX",
    status: "implemented_partial",
    aliases: ["abstract algebra", "group theory", "ring theory", "field theory", "modules", "representation theory", "linear algebra", "category theory", "homological algebra", "k-theory", "galois"],
    methods: ["symbolic", "explain", "strategy"],
    verification: "deterministic",
    verificationNote: "Polynomial/expansion/identity claims are verified symbolically (mathjs simplify + numeric sampling).",
    testProblems: ["expand (x+2)^3", "factor x^2 - 5x + 6", "solve 2x + 3 = 11"],
    subfields: [
      { id: "algebra.elementary", title: "Elementary & school algebra", status: "implemented_tested", aliases: ["prealgebra", "equations"], methods: ["symbolic"], verification: "deterministic", testProblems: ["solve 3(x-2) = 9"] },
      { id: "algebra.linear", title: "Linear algebra & matrices", status: "implemented_tested", aliases: ["matrices", "determinant", "eigenvalue", "vector space"], methods: ["matrix", "numeric"], verification: "deterministic", testProblems: ["determinant of [[1,2],[3,4]]", "matrix product"] },
      { id: "algebra.abstract", title: "Groups, rings, fields & modules", status: "ai_reasoning", aliases: ["group", "ring", "field extension", "module"], methods: ["explain", "strategy"], verification: "ai_only", prerequisites: ["algebra.linear"] },
      { id: "algebra.category", title: "Category theory & homological algebra", status: "planned", aliases: ["functor", "abelian category", "k-theory"], methods: ["explain"], verification: "ai_only" },
    ],
  },
  {
    id: "number-theory",
    title: "Number theory",
    msc: "11-XX",
    status: "implemented_partial",
    aliases: ["primes", "divisibility", "modular arithmetic", "diophantine", "arithmetic geometry", "analytic number theory"],
    methods: ["numeric", "explain", "strategy"],
    verification: "numeric",
    verificationNote: "Divisibility/GCD/primality claims verified computationally on the stated inputs; universal claims are honestly labeled evidence, not proof.",
    testProblems: ["gcd(462, 1071)", "is 97 prime"],
    subfields: [
      { id: "number-theory.elementary", title: "Divisibility, GCD, modular arithmetic", status: "implemented_tested", aliases: ["gcd", "lcm", "mod"], methods: ["numeric"], verification: "numeric", testProblems: ["gcd(462, 1071) = 21"] },
      { id: "number-theory.primes", title: "Primes & factorization", status: "implemented_tested", aliases: ["prime factorization"], methods: ["numeric"], verification: "numeric" },
      { id: "number-theory.diophantine", title: "Diophantine equations", status: "ai_reasoning", aliases: ["pell equation"], methods: ["strategy", "numeric"], verification: "ai_only" },
      { id: "number-theory.analytic", title: "Analytic & algebraic number theory", status: "planned", aliases: ["zeta", "l-function", "class field theory"], methods: ["explain"], verification: "external" },
    ],
  },
  {
    id: "analysis",
    title: "Analysis",
    msc: "26-XX, 28-XX, 30-XX, 31-XX, 40-XX, 41-XX, 42-XX, 43-XX, 46-XX",
    status: "implemented_partial",
    aliases: ["real analysis", "complex analysis", "measure theory", "functional analysis", "fourier", "harmonic analysis", "approximation", "asymptotics", "special functions", "distributions"],
    methods: ["symbolic", "numeric", "explain", "strategy"],
    verification: "deterministic",
    verificationNote: "Limits/derivatives verified by symbolic differentiation + numeric sampling; convergence claims are stated with conditions, never asserted without check.",
    testProblems: ["d/dx of x*sin(x)", "limit of sin(x)/x as x -> 0"],
    subfields: [
      { id: "analysis.calculus", title: "Differential & integral calculus", status: "implemented_tested", aliases: ["derivative", "integral", "limit"], methods: ["symbolic", "numeric"], verification: "deterministic", testProblems: ["∫ 4x cos(2 - 3x) dx", "d/dx[x sin x]"] },
      { id: "analysis.multivariable", title: "Multivariable & vector calculus", status: "implemented_partial", aliases: ["partial derivative", "gradient", "curl", "divergence", "multiple integral"], methods: ["symbolic", "numeric"], verification: "numeric" },
      { id: "analysis.complex", title: "Complex analysis", status: "ai_reasoning", aliases: ["holomorphic", "contour integral", "residue"], methods: ["explain", "strategy"], verification: "ai_only" },
      { id: "analysis.measure", title: "Measure theory & functional analysis", status: "planned", aliases: ["lebesgue", "banach", "hilbert space"], methods: ["explain"], verification: "ai_only" },
      { id: "analysis.fourier", title: "Fourier & harmonic analysis", status: "planned", aliases: ["fourier series", "transform"], methods: ["numeric"], verification: "numeric" },
    ],
  },
  {
    id: "ode-pde",
    title: "Differential & integral equations",
    msc: "34-XX, 35-XX, 39-XX, 44-XX, 45-XX",
    status: "implemented_partial",
    aliases: ["ode", "pde", "differential equation", "boundary value", "integral transform", "laplace transform", "numerical methods"],
    methods: ["numeric", "symbolic", "explain", "strategy"],
    verification: "numeric",
    verificationNote: "Solutions verified by residual substitution; symbolic ODE solving beyond separable/linear-first-order is honestly refused rather than guessed.",
    testProblems: ["dy/dx = 2x (separable)"],
    subfields: [
      { id: "ode-pde.ode", title: "Ordinary differential equations", status: "implemented_partial", aliases: ["initial value problem", "ivp"], methods: ["numeric", "symbolic"], verification: "numeric" },
      { id: "ode-pde.pde", title: "Partial differential equations", status: "planned", aliases: ["heat equation", "wave equation", "laplace equation"], methods: ["explain", "numeric"], verification: "numeric" },
      { id: "ode-pde.transforms", title: "Integral transforms", status: "planned", aliases: ["laplace", "fourier transform"], methods: ["explain"], verification: "external" },
    ],
  },
  {
    id: "geometry-topology",
    title: "Geometry & topology",
    msc: "51-XX, 52-XX, 53-XX, 54-XX, 55-XX, 57-XX",
    status: "implemented_partial",
    aliases: ["euclidean geometry", "projective", "differential geometry", "riemannian", "algebraic geometry", "topology", "manifolds", "knot theory", "convex geometry", "symplectic"],
    methods: ["numeric", "explain", "strategy"],
    verification: "numeric",
    verificationNote: "Concrete measurements verified numerically; theorem-level topology/geometry claims are informal unless checked externally.",
    testProblems: ["area of a 3-4-5 triangle", "distance between points"],
    subfields: [
      { id: "geometry-topology.euclidean", title: "Euclidean & analytic geometry", status: "implemented_tested", aliases: ["triangle", "circle", "coordinate geometry", "distance"], methods: ["numeric", "symbolic"], verification: "numeric", testProblems: ["distance (0,0)-(3,4) = 5"] },
      { id: "geometry-topology.algebraic", title: "Algebraic geometry", status: "planned", aliases: ["variety", "scheme"], methods: ["explain"], verification: "external" },
      { id: "geometry-topology.differential", title: "Differential & Riemannian geometry", status: "planned", aliases: ["curvature", "metric tensor", "ricci"], methods: ["explain"], verification: "ai_only" },
      { id: "geometry-topology.general", title: "General & algebraic topology", status: "ai_reasoning", aliases: ["fundamental group", "homology", "knot"], methods: ["explain"], verification: "ai_only" },
    ],
  },
  {
    id: "probability-statistics",
    title: "Probability & statistics",
    msc: "60-XX, 62-XX",
    status: "implemented_tested",
    aliases: ["probability", "statistics", "bayesian", "stochastic", "regression", "hypothesis test", "distribution", "variance"],
    methods: ["numeric", "statistical", "explain"],
    verification: "numeric",
    verificationNote: "Every statistic recomputed from the supplied data; distribution formulas verified against reference values.",
    testProblems: ["mean of 2 4 6 8", "standard deviation", "combinatorial probability"],
    subfields: [
      { id: "probability-statistics.descriptive", title: "Descriptive statistics", status: "implemented_tested", aliases: ["mean", "median", "std", "variance"], methods: ["numeric"], verification: "numeric", testProblems: ["mean/median/std suite in tests"] },
      { id: "probability-statistics.probability", title: "Probability & combinatorics", status: "implemented_tested", aliases: ["permutation", "combination", "dice", "urn"], methods: ["numeric"], verification: "numeric" },
      { id: "probability-statistics.inference", title: "Inference, regression & hypothesis testing", status: "implemented_partial", aliases: ["t-test", "confidence interval", "least squares"], methods: ["statistical", "numeric"], verification: "numeric" },
      { id: "probability-statistics.stochastic", title: "Stochastic processes", status: "planned", aliases: ["markov chain", "brownian", "martingale"], methods: ["explain", "numeric"], verification: "numeric" },
    ],
  },
  {
    id: "discrete-computation",
    title: "Discrete mathematics & computation",
    msc: "03D-XX, 05-XX, 06-XX, 68-XX, 90-XX",
    status: "implemented_partial",
    aliases: ["combinatorics", "graph theory", "automata", "formal languages", "algorithms", "complexity", "boolean algebra", "optimization", "recurrence"],
    methods: ["numeric", "discrete", "explain", "strategy"],
    verification: "numeric",
    verificationNote: "Graph/combinatorial results verified by brute-force recomputation on small instances; asymptotic complexity claims remain informal.",
    testProblems: ["factorial", "permutation count", "path existence on a small graph"],
    subfields: [
      { id: "discrete-computation.combinatorics", title: "Combinatorics", status: "implemented_tested", aliases: ["permutation", "combination", "binomial"], methods: ["numeric"], verification: "numeric", testProblems: ["C(5,2) = 10"] },
      { id: "discrete-computation.graphs", title: "Graph theory", status: "implemented_partial", aliases: ["graph", "tree", "path", "cycle", "coloring"], methods: ["discrete"], verification: "numeric" },
      { id: "discrete-computation.complexity", title: "Complexity & computability", status: "ai_reasoning", aliases: ["np", "p versus np", "reduction"], methods: ["explain"], verification: "ai_only" },
      { id: "discrete-computation.recurrences", title: "Recurrences & summations", status: "implemented_partial", aliases: ["sum", "series", "recurrence relation"], methods: ["numeric", "symbolic"], verification: "numeric" },
    ],
  },
  {
    id: "applied",
    title: "Applied mathematics & mathematical physics",
    msc: "70-XX, 76-XX, 78-XX, 80-XX, 81-XX, 83-XX, 90-XX, 92-XX, 94-XX",
    status: "ai_reasoning",
    aliases: ["mathematical physics", "quantum mechanics", "relativity", "fluid dynamics", "electromagnetism", "control theory", "operations research", "game theory", "information theory", "actuarial", "mathematical biology", "optimization", "linear programming"],
    methods: ["numeric", "explain", "strategy"],
    verification: "ai_only",
    verificationNote: "Physical modeling claims are reasoned and explained; numeric sub-computations are verified only when the problem reduces to a supported engine.",
    subfields: [
      { id: "applied.optimization", title: "Optimization & operations research", status: "implemented_partial", aliases: ["linear programming", "maximize", "minimize", "simplex"], methods: ["numeric", "strategy"], verification: "numeric" },
      { id: "applied.math-physics", title: "Mathematical physics (QM, relativity, fluids, EM)", status: "planned", aliases: ["schrodinger", "maxwell", "navier-stokes", "lagrangian"], methods: ["explain"], verification: "ai_only" },
      { id: "applied.info-theory", title: "Information theory & coding", status: "planned", aliases: ["entropy", "shannon"], methods: ["numeric"], verification: "numeric" },
    ],
  },
  {
    id: "specialized",
    title: "Specialized & interdisciplinary fields",
    status: "planned",
    aliases: ["descriptive set theory", "quantum complexity", "algorithmic randomness", "ahlfors theory", "advanced special functions", "ricci calculus"],
    methods: ["explain", "research"],
    verification: "ai_only",
    verificationNote: "These fields are classified and researched honestly; no dedicated engine — every claim is labeled unverified.",
    subfields: [
      { id: "specialized.set-theory", title: "Descriptive set theory", status: "planned", aliases: [], methods: ["explain"], verification: "ai_only" },
      { id: "specialized.quantum-computing", title: "Quantum computing & complexity", status: "planned", aliases: ["qubit", "bqp"], methods: ["explain"], verification: "ai_only" },
      { id: "specialized.special-functions", title: "Advanced special functions", status: "planned", aliases: ["hypergeometric", "bessel", "elliptic"], methods: ["numeric"], verification: "numeric" },
    ],
  },
];

/** Flat id → node lookup (integrity-checked by the test suite). */
export function flattenRegistry(nodes: MathFieldNode[] = MATHEMATICS_REGISTRY): MathFieldNode[] {
  const out: MathFieldNode[] = [];
  const walk = (list: MathFieldNode[]) => {
    for (const n of list) { out.push(n); if (n.subfields) walk(n.subfields); }
  };
  walk(nodes);
  return out;
}

export function findField(id: string): MathFieldNode | undefined {
  return flattenRegistry().find((n) => n.id === id);
}
