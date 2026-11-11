"use client";

/**
 * ESSAY SECTION EDITOR (Phase 6, 2026-11-10).
 *
 * Sections arrive drafted, audited and paced out. But the essay is the member's
 * own work: a sentence they disagree with has to be fixable here, not only by
 * copying the text somewhere else.
 *
 * What this deliberately does NOT do is let an edit inherit the audits. Those
 * three audits (citation, rubric, style) ran on the drafted text, so the server
 * moves them to `audits_of_drafted_version`, clears the live ones, and puts the
 * essay's final verification back to NEEDS REVIEW. The panel says so in plain
 * language rather than showing a passed audit over words it never read.
 *
 * Saving uses the autosave engine: "Saved" only once the server confirms, a
 * failure offers Retry, and a concurrent change is a visible choice. Typed text is
 * also kept in the encrypted device draft, so a closed tab loses no paragraph.
 */
import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui";
import SaveStatus from "@/components/ui/SaveStatus";
import { useAutosave } from "@/lib/save/useAutosave";
import { RevisionConflictError } from "@/lib/save/draft";
import { useComposerDraft } from "@/lib/save/useComposerDraft";
import { browserDraftStorage } from "@/lib/save/composer-draft-browser";
import { draftKey } from "@/lib/save/composer-draft";

export default function EssaySectionEditor({
  sessionId,
  sectionId,
  draft: drafted,
  updatedDate,
  editedAt,
  onSaved,
}: {
  sessionId: string;
  sectionId: string;
  draft: string;
  updatedDate: string | null;
  editedAt: string | null;
  onSaved?: (text: string) => void;
}) {
  const [text, setText] = useState(drafted);
  const [open, setOpen] = useState(false);

  const autosave = useAutosave<{ session_id: string; section_id: string; draft: string }>({
    initialVersion: updatedDate ?? null,
    save: async (payload, baseVersion) => {
      const res = await fetch("/api/essay/sections", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(baseVersion ? { "x-sophira-base-version": baseVersion } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) throw new RevisionConflictError(data?.data?.updated_date ?? null);
      if (!res.ok) throw new Error(data?.error ?? "Could not save this section.");
      return { version: data?.data?.updated_date ?? null };
    },
  });
  const { markEdited, snapshot, retry, resolveConflict, flush } = autosave;

  const draft = useComposerDraft({
    storage: browserDraftStorage,
    key: draftKey(["essay-section", sessionId, sectionId]),
  });
  const { restore: restoreDraft, keep: keepDraft, clear: clearDraft, message: draftMessage } = draft;
  const restoredRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${sessionId}:${sectionId}`;
    if (restoredRef.current === key) return;
    restoredRef.current = key;
    void (async () => {
      const kept = await restoreDraft();
      if (!kept || !kept.text?.trim()) return;
      // A draft means an edit was left unsaved, so it wins over the server copy -
      // but never over text the member has already retyped in this panel.
      setText((cur) => (cur !== drafted ? cur : kept.text));
      setOpen(true);
    })();
  }, [sessionId, sectionId, drafted, restoreDraft]);

  useEffect(() => {
    if (snapshot.phase !== "saved") return;
    void clearDraft();
    onSaved?.(text);
  }, [snapshot.phase, clearDraft, onSaved, text]);

  const edited = text !== drafted || Boolean(editedAt);

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="text-sm font-medium text-accent underline-offset-2 hover:underline"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide the editor" : edited ? "Continue editing this section" : "Edit this section"}
        </button>
        <SaveStatus
          snapshot={snapshot}
          onRetry={retry}
          onKeepMine={() => resolveConflict("mine")}
          onUseTheirs={() => resolveConflict("theirs")}
        />
      </div>

      {edited && (
        <p role="status" className="mt-2 text-xs text-ink-soft">
          Your own wording. The citation, rubric and style audits were run on the drafted text, so they
          are kept with that version and this essay needs another check before you submit it.
        </p>
      )}

      {open && (
        <div className="mt-2">
          <label htmlFor={`essay-section-edit-${sectionId}`} className="sr-only">
            Edit this section
          </label>
          <Textarea
            id={`essay-section-edit-${sectionId}`}
            rows={14}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              keepDraft({ title: "", text: e.target.value });
              if (e.target.value.trim()) {
                markEdited({ session_id: sessionId, section_id: sectionId, draft: e.target.value });
              }
            }}
            onBlur={() => void flush()}
          />
          {draftMessage ? (
            <p role="status" className="mt-2 text-xs text-ink-soft">
              {draftMessage}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
