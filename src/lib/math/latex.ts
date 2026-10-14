/**
 * LaTeX <-> canonical plain-math conversion (2026-10-14).
 * MathLive produces LaTeX; the shared solver pipeline consumes the SAME
 * canonical plain syntax used by Type to Solve and OCR normalization.
 * Both input methods converge before solving - never two engines.
 */
export function latexToCanonical(input: string): string {
  let s = input ?? "";
  // strip \left \right and sizing
  s = s.replace(/\\(left|right|big|Big|bigg|Bigg|,|;|!|quad|qquad)/g, " ");
  // \frac{a}{b} -> (a)/(b)  (innermost-first loop)
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/\\(?:frac|dfrac|tfrac)\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)");
  }
  // \sqrt[n]{x} -> (x)^(1/n), \sqrt{x} -> sqrt(x)
  s = s.replace(/\\sqrt\[(.*?)\]\{([^{}]*)\}/g, "($2)^(1/($1))");
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, "sqrt($1)");
  // integrals: \int f \, dx / \int_{a}^{b} f dx
  s = s.replace(/\\int_\{([^{}]*)\}\^\{([^{}]*)\}/g, "∫[$1,$2] ");
  s = s.replace(/\\int_\{([^{}]*)\}(?!\^)/g, "∫[$1,∞] ");
  s = s.replace(/\\int\^\{([^{}]*)\}/g, "∫[-∞,$1] ");
  s = s.replace(/\\int/g, "∫");
  // functions & constants
  s = s.replace(/\\(sin|cos|tan|log|ln|exp)\b/g, "$1");
  s = s.replace(/\\(cdot|times)/g, "*").replace(/\\div/g, "/");
  s = s.replace(/\\pi/g, "pi").replace(/\\infty/g, "∞");
  // exponents ^{...} -> ^(...)
  s = s.replace(/\^\{([^{}]*)\}/g, "^($1)");
  s = s.replace(/_\{([^{}]*)\}/g, "_$1");
  // braces that survived (grouping) -> parentheses
  s = s.replace(/\{([^{}]*)\}/g, "($1)");
  // spacing commands
  s = s.replace(/\\/g, " ").replace(/\s+/g, " ").trim();
  return s;
}
