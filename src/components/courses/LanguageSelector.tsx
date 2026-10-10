"use client";
import { useState } from "react";

const LANGUAGES = [
  "Spanish", "French", "German", "Italian", "Portuguese", "Japanese",
  "Chinese (Mandarin)", "Korean", "Arabic", "Russian", "Latin", "American Sign Language",
];
const PROFICIENCY = ["Beginner", "Intermediate", "Advanced"];

export interface LanguagePreference {
  target_language: string | null;
  explanation_language: string | null;
  proficiency: string | null;
}

/**
 * FUNCTIONING language selector (nav spec): a real control, saved to the
 * authenticated user's account (subject_preferences, migration 0030, RLS).
 * No static label, no invented data.
 */
export function LanguageSelector({ initial }: { initial: LanguagePreference | null }) {
  const [target, setTarget] = useState(initial?.target_language ?? "");
  const [explanation, setExplanation] = useState(initial?.explanation_language ?? "English");
  const [level, setLevel] = useState(initial?.proficiency ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save(next: Partial<LanguagePreference>) {
    const body = {
      target_language: next.target_language ?? target,
      explanation_language: next.explanation_language ?? explanation,
      proficiency: next.proficiency ?? level,
    };
    setState("saving");
    try {
      const r = await fetch("/api/preferences/foreign-language", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setState(r.ok ? "saved" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-sm font-medium text-ink">
          Target language
          <select
            className="mt-1 w-full rounded-md border border-ink/15 bg-paper px-3 py-2"
            value={target}
            onChange={(e) => { setTarget(e.target.value); save({ target_language: e.target.value }); }}
          >
            <option value="">Select a language…</option>
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-ink">
          Explanation language
          <select
            className="mt-1 w-full rounded-md border border-ink/15 bg-paper px-3 py-2"
            value={explanation}
            onChange={(e) => { setExplanation(e.target.value); save({ explanation_language: e.target.value }); }}
          >
            <option value="English">English</option>
            {target ? <option value={target}>{target}</option> : null}
          </select>
        </label>
        <label className="block text-sm font-medium text-ink">
          Proficiency level
          <select
            className="mt-1 w-full rounded-md border border-ink/15 bg-paper px-3 py-2"
            value={level}
            onChange={(e) => { setLevel(e.target.value); save({ proficiency: e.target.value }); }}
          >
            <option value="">Select your level…</option>
            {PROFICIENCY.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
      </div>
      <p aria-live="polite" className="text-sm text-ink-soft">
        {state === "saving" && "Saving…"}
        {state === "saved" && "Saved to your account."}
        {state === "error" && "Could not save right now — try again."}
        {state === "idle" && "Your choices are saved automatically and apply to the language tools."}
      </p>
    </div>
  );
}
