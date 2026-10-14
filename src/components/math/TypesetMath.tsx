"use client";
import { useEffect, useState } from "react";

/**
 * Typeset a canonical (mathjs-syntax) expression with KaTeX. The mathjs ->
 * LaTeX conversion and KaTeX are loaded lazily so the editor route stays
 * light. ANY failure falls back to the plain expression - never a crash,
 * never arbitrary HTML from untrusted input (KaTeX output is its own
 * sanitized markup; we pass throwOnError: false).
 */
export function TypesetMath({ expr, display = false }: { expr: string; display?: boolean }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ create, all }, katex] = await Promise.all([
          import("mathjs"),
          import("katex"),
        ]);
        const math = create(all, {});
        let tex = expr;
        try {
          tex = math.parse(expr).toTex();
        } catch {
          /* plain text fallback */
        }
        const rendered = katex.renderToString(tex, {
          throwOnError: false,
          displayMode: display,
          trust: false,
          strict: "ignore",
        });
        if (!cancelled) setHtml(rendered);
      } catch {
        if (!cancelled) setHtml(null);
      }
    })();
    return () => { cancelled = true; };
  }, [expr, display]);

  if (html) return <span aria-label={expr} title={expr} dangerouslySetInnerHTML={{ __html: html }} />;
  return <span className="font-mono text-sm">{expr}</span>;
}
