"use client";

/**
 * RESPONSE EDITOR (Phase 6, 2026-11-10).
 *
 * An answer arrives generated, checked and paced out. Then the member reads it,
 * disagrees with a sentence, and until now could only copy it elsewhere. This
 * lets them correct the text in place, in their own words.
 *
 * Two honesty rules live here:
 *  1. The server marks an edited answer `unverified` and keeps the original
 *     verdict under `verification.member_edited`. The page says that in plain
 *     language instead of letting a stale "verified" badge ride along.
 *  2. Saving goes through the autosave engine: "Saved" only after the server
 *     confirms, a failure offers Retry, and a concurrent change is a visible
 *     choice. The typed text is also kept in the encrypted device draft so a
 *     closed tab does not lose a rewritten paragraph.
 */
import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui";
import SaveStatus from "@/components/ui/SaveStatus";
import { useAutosave } from "@/lib/save/useAutosave";
import { RevisionConflictError } from "@/lib/save/draft";
import { useComposerDraft } from "@/lib/save/useComposerDraft";
import { browserDraftStorage } from "@/lib/save/composer-draft-browser";
import { draftKey } from "@/lib/save/composer-draft";

export default function ResponseEditor({
  responseId,
  content,
  updatedAt,
  onSaved,
}: {
  responseId: string;
  content: string;
  updatedAt: string | null;
  onSaved?: (content: string) => void;
}) {
  const [text, setText] = useState(content);
  const [showEditor, setShowEditor] = useState(false);

  const autosave = useAutosave<{ content: string }>({
    initialVersion: updatedAt ?? null,
    save: async (payload, baseVersion) => {
      const res = await fetch(`/api/responses/${responseId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(baseVersion ? { "x-sophira-base-version": baseVersion } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) throw new RevisionConflictError(data?.data?.updated_at ?? null);
      if (!res.ok) throw new Error(data?.error ?? "Could not save your edit.");
      return { version: data?.data?.updated_at ?? null };
    },
  });
  const { markEdited, snapshot, retry, resolveConflict, flush } = autosave;

  const draft = useComposerDraft({
    storage: browserDraftStorage,
    key: draftKey(["response-edit", responseId]),
  });
  const { restore: restoreDraft, keep: keepDraft, clear: clearDraft, message: draftMessage } = draft;
  const restoredRef = useRef<string | null>(null);
  useEffect(() => {
    if (restoredRef.current === responseId) return;
    restoredRef.current = responseId;
    void (async () => {
      const kept = await restoreDraft();
      if (!kept || !kept.text?.trim()) return;
      // A draft exists only when an edit was left unsaved, so it wins over the
      // generated text — but never over text the member has already retyped here.
      setText((cur) => (cur !== content ? cur : kept.text));
      setShowEditor(true);
    })();
  }, [responseId, restoreDraft, content]);

  useEffect(() => {
    if (snapshot.phase !== "saved") return;
    void clearDraft();
    onSaved?.(text);
  }, [snapshot.phase, clearDraft, onSaved, text]);

  const edited = text !== content;

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="text-sm font-medium text-accent underline-offset-2 hover:underline"
          aria-expanded={showEditor}
          onClick={() => setShowEditor((v) => !v)}
        >
          {showEditor ? "Hide the editor" : edited ? "Continue editing this answer" : "Correct this answer"}
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
          Your own wording. The original check was run on the generated text, so this answer is
          shown as unverified from your first change onward.
        </p>
      )}

      {showEditor && (
        <div className="mt-2">
          <label htmlFor={`response-edit-${responseId}`} className="sr-only">
            Edit this answer
          </label>
          <Textarea
            id={`response-edit-${responseId}`}
            rows={12}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              keepDraft({ title: "", text: e.target.value });
              if (e.target.value.trim()) markEdited({ content: e.target.value });
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
