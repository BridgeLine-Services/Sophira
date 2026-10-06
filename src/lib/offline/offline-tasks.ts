/**
 * Offline subsystem — the offline AI feature set (STEP 6).
 *
 * Capabilities that are REAL while offline (implemented + tested here):
 *   - writing assistance (improve/continue/outline) via the local model
 *   - rewriting (tone/length/constraints) via the local model
 *   - basic text generation via the local model
 *   - math problem solving for computable expressions — via the
 *     deterministic mathjs engine, NO network involved
 *   - offline verification via the existing machine-check engine
 *     (src/lib/ai/mathverify.ts — pure TypeScript)
 *   - teacher-rule application via the pure learning-patterns engine over
 *     the local mirror (selectApplicablePatterns + prompt formatting)
 *   - academic memory retrieval over the local encrypted mirror
 *
 * Explicitly ONLINE-ONLY (documented, not faked):
 *   - live web research / new citations (needs the search provider)
 *   - extraction of NEW uploaded documents (pdf/docx parsing runs
 *     server-side; offline you can paste/type text into documents)
 *   - large-context tasks exceeding a small model's realistic quality
 *     (the UI warns that offline answers are from a small local model)
 */

import type { LocalInferenceEngine } from "./local-engine";
import type { OfflineStore } from "./store";
import type { OfflineRecord } from "./store";
import type { LearningPattern } from "@/lib/learning/patterns";
import { selectApplicablePatterns } from "@/lib/learning/patterns";
import { runMachineChecks } from "@/lib/ai/mathverify";

export type OfflineTaskKind =
  | "write-assist"
  | "rewrite"
  | "generate"
  | "math-solve"
  | "verify"
  | "apply-teacher-rules"
  | "memory-recall";

export interface OfflineTaskResult {
  kind: OfflineTaskKind;
  ok: boolean;
  output: string;
  provenance: import("./local-engine").AiProvenance;
  /** extra structured data (e.g. matched patterns / verification) */
  detail?: unknown;
  error?: string;
}

/** All tasks that can genuinely run offline on this device. */
export const OFFLINE_CAPABLE_TASKS: OfflineTaskKind[] = [
  "write-assist",
  "rewrite",
  "generate",
  "math-solve",
  "verify",
  "apply-teacher-rules",
  "memory-recall",
];

/** Tasks that are honestly online-only (surfaced in the UI, never faked). */
export const ONLINE_ONLY_TASKS: { kind: string; why: string }[] = [
  { kind: "live web research", why: "requires the online search provider and source fetching" },
  { kind: "new document extraction (PDF/DOCX upload)", why: "file parsing runs server-side; offline you can paste text instead" },
  { kind: "cross-check with fresh sources", why: "verification against the live web needs connectivity" },
];

export class OfflineTasks {
  constructor(
    private readonly engine: LocalInferenceEngine,
    private readonly store: OfflineStore,
    private readonly modelId: string
  ) {}

  private async fail(kind: OfflineTaskKind, error: string): Promise<OfflineTaskResult> {
    return {
      kind, ok: false, output: "",
      provenance: { origin: "local", model: this.modelId, latencyMs: 0, generatedOffline: true },
      error,
    };
  }

  async writingAssist(task: "improve" | "continue" | "outline", text: string): Promise<OfflineTaskResult> {
    const prompt =
      task === "improve"
        ? `Improve this text, keeping the meaning:\n\n${text}`
        : task === "continue"
          ? `Continue this text naturally:\n\n${text}`
          : `Write a short outline for the following topic or text:\n\n${text}`;
    try {
      const r = await this.engine.generate(this.modelId, prompt);
      return { kind: "write-assist", ok: r.text.length > 0, output: r.text, provenance: r.provenance };
    } catch (e) {
      return this.fail("write-assist", (e as Error).message);
    }
  }

  async rewrite(text: string, instruction: string): Promise<OfflineTaskResult> {
    try {
      const r = await this.engine.generate(this.modelId, `Rewrite the text as follows: ${instruction}\n\nText:\n${text}`);
      return { kind: "rewrite", ok: r.text.length > 0, output: r.text, provenance: r.provenance };
    } catch (e) {
      return this.fail("rewrite", (e as Error).message);
    }
  }

  async generate(prompt: string): Promise<OfflineTaskResult> {
    try {
      const r = await this.engine.generate(this.modelId, prompt);
      return { kind: "generate", ok: r.text.length > 0, output: r.text, provenance: r.provenance };
    } catch (e) {
      return this.fail("generate", (e as Error).message);
    }
  }

  /**
   * Deterministic math solving for computable expressions via mathjs —
   * fully local, no model round-trip needed, no network. Word problems
   * fall back to the local model's limited ability (honestly labeled).
   */
  async mathSolve(expression: string): Promise<OfflineTaskResult> {
    const started = Date.now();
    const math = await import("mathjs");
    try {
      const value = math.evaluate(expression);
      const output = `= ${math.format(value, { precision: 12 })}`;
      return {
        kind: "math-solve", ok: true, output,
        provenance: { origin: "local", model: "mathjs (deterministic)", latencyMs: Date.now() - started, generatedOffline: true },
      };
    } catch {
      // not directly computable — try the small local model, honestly labeled
      try {
        const r = await this.engine.generate(this.modelId, `Solve this math problem step by step. Problem: ${expression}`);
        return {
          kind: "math-solve",
          ok: r.text.length > 0,
          output: r.text + "\n\n(computed offline by a small local model — verify against the shown steps)",
          provenance: r.provenance,
        };
      } catch (e) {
        return this.fail("math-solve", `not computable offline: ${(e as Error).message}`);
      }
    }
  }

  /** Offline machine verification — pure TS checker, no network. */
  async verify(checks: unknown): Promise<OfflineTaskResult> {
    const started = Date.now();
    const result = runMachineChecks(checks);
    const lines = [
      result.allPassed ? "MACHINE CHECKS PASSED" : "MACHINE CHECKS FAILED",
      ...result.results.map((r) => `${r.passed ? "PASS" : "FAIL"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`),
    ];
    return {
      kind: "verify", ok: result.allPassed, output: lines.join("\n"), detail: result,
      provenance: { origin: "local", model: "deterministic checks (no model needed)", latencyMs: Date.now() - started, generatedOffline: true },
    };
  }

  /** Apply teacher methods/learning rules from the LOCAL mirror. */
  async applyTeacherRules(
    patterns: LearningPattern[],
    ctx: import("@/lib/learning/patterns").PatternContext
  ): Promise<OfflineTaskResult> {
    const started = Date.now();
    const applicable = selectApplicablePatterns(patterns, ctx);
    const output =
      applicable.length === 0
        ? "No applicable teacher rules in local memory for this context."
        : applicable.map((p) => `[${p.scope}] ${p.description}${p.kind === "mistake" ? " (avoid this mistake)" : ""}`).join("\n");
    return {
      kind: "apply-teacher-rules", ok: applicable.length > 0, output, detail: applicable,
      provenance: { origin: "local", model: "pattern engine (deterministic)", latencyMs: Date.now() - started, generatedOffline: true },
    };
  }

  /** Retrieve academic memory from the LOCAL encrypted mirror. */
  async memoryRecall(query: string): Promise<OfflineTaskResult> {
    const started = Date.now();
    const recs = await this.store.list<Record<string, unknown>>("memories");
    const q = query.toLowerCase();
    const words = q.split(/\s+/).filter((w) => w.length > 2);
    const scored = recs
      .map((r: OfflineRecord<Record<string, unknown>>) => {
        const text = JSON.stringify(r.row).toLowerCase();
        const score = words.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
        return { r, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    const output =
      scored.length === 0
        ? `No locally synced academic memory matches "${query}".`
        : scored.map((x) => `• ${describeMemory(x.r.row)}`).join("\n");
    return {
      kind: "memory-recall", ok: scored.length > 0, output,
      provenance: { origin: "local", model: "local encrypted mirror", latencyMs: Date.now() - started, generatedOffline: true },
    };
  }
}

function describeMemory(row: Record<string, unknown>): string {
  const kind = (row.kind ?? row.category ?? "memory") as string;
  const text = (row.content ?? row.text ?? row.description ?? JSON.stringify(row)) as string;
  return `${kind}: ${String(text).slice(0, 160)}`;
}
