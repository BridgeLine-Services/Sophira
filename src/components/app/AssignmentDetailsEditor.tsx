"use client";

/**
 * ASSIGNMENT DETAILS EDITOR (Phase 6, 2026-11-10).
 *
 * The member's own words about their own assignment: its name and the brief
 * (whatever the teacher actually asked for). Before this, the name could only be
 * changed with a manual save button and the brief could not be edited at all
 * after creation — so a typo in the instructions stayed wrong forever.
 *
 * Saving goes through the autosave engine, so "Saved" appears only after the
 * server confirms, a failure offers Retry, and a concurrent change from another
 * tab is a visible choice rather than a silent overwrite. While the member types,
 * the text is also kept in the encrypted device draft, so a closed tab does not
 * lose a pasted brief.
 */
import { useEffect, useRef, useState } from "react";
import { Input, Label, Textarea } from "@/components/ui";
import SaveStatus from "@/components/ui/SaveStatus";
import { useAutosave } from "@/lib/save/useAutosave";
import { RevisionConflictError } from "@/lib/save/draft";
import { useComposerDraft } from "@/lib/save/useComposerDraft";
import { browserDraftStorage } from "@/lib/save/composer-draft-browser";
import { draftKey } from "@/lib/save/composer-draft";

export interface AssignmentDetailsInitial {
  id: string;
  title: string;
  instructions_text: string | null;
  updated_at: string | null;
}

export default function AssignmentDetailsEditor({
  initial,
  onSaved,
}: {
  initial: AssignmentDetailsInitial;
  onSaved?: (details: { title: string; instructions_text: string }) => void;
}) {
  const [title, setTitle] = useState(initial.title ?? "");
  const [brief, setBrief] = useState(initial.instructions_text ?? "");

  const autosave = useAutosave<{ title: string; instructions_text: string }>({
    initialVersion: initial.updated_at ?? null,
    save: async (payload, baseVersion) => {
      const res = await fetch(`/api/assignments/${initial.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(baseVersion ? { "x-sophira-base-version": baseVersion } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) throw new RevisionConflictError(data?.assignment?.updated_at ?? null);
      if (!res.ok) throw new Error(data?.error ?? "Could not save the assignment details.");
      return { version: data?.assignment?.updated_at ?? null };
    },
  });
  const { markEdited, snapshot, retry, resolveConflict, flush } = autosave;

  // The draft covers the gap between a keystroke and the debounced save, and the
  // gap between a closed tab and the next visit.
  const draft = useComposerDraft({
    storage: browserDraftStorage,
    key: draftKey(["assignment-details", initial.id]),
  });
  const { restore: restoreDraft, keep: keepDraft, clear: clearDraft, message: draftMessage } = draft;
  const restoredRef = useRef<string | null>(null);
  useEffect(() => {
    if (restoredRef.current === initial.id) return;
    restoredRef.current = initial.id;
    void (async () => {
      const kept = await restoreDraft();
      if (!kept) return;
      // Only fills what the member has not started: the saved brief always wins
      // over an older draft, and a draft never overwrites fresh typing.
      setTitle((cur) => (cur.trim() ? cur : kept.title ?? cur));
      setBrief((cur) => (cur.trim() ? cur : kept.text ?? cur));
    })();
  }, [initial.id, restoreDraft]);

  const edit = (next: { title?: string; instructions_text?: string }) => {
    const merged = {
      title: next.title ?? title,
      instructions_text: next.instructions_text ?? brief,
    };
    markEdited(merged);
    keepDraft({ title: merged.title, text: merged.instructions_text });
  };

  // A saved version is the truth; the draft has done its job and is removed so it
  // cannot reappear over newer server text.
  useEffect(() => {
    if (snapshot.phase !== "saved") return;
    void clearDraft();
    onSaved?.({ title, instructions_text: brief });
  }, [snapshot.phase, clearDraft, onSaved, title, brief]);

  return (
    <section aria-labelledby="assignment-details-heading" className="panel-flat p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="assignment-details-heading" className="text-sm font-semibold text-ink">
          Assignment details
        </h3>
        <SaveStatus
          snapshot={snapshot}
          onRetry={retry}
          onKeepMine={() => resolveConflict("mine")}
          onUseTheirs={() => resolveConflict("theirs")}
        />
      </div>
      <p className="mt-1 text-xs text-ink-soft">
        Your own words about this assignment. Changes save as you type.
      </p>

      <div className="mt-3">
        <Label htmlFor="assignment-title">Title</Label>
        <Input
          id="assignment-title"
          className="mt-1.5"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            edit({ title: e.target.value });
          }}
          onBlur={() => void flush()}
        />
      </div>

      <div className="mt-3">
        <Label htmlFor="assignment-brief">What the teacher asked for</Label>
        <Textarea
          id="assignment-brief"
          className="mt-1.5"
          rows={6}
          value={brief}
          placeholder="Paste or type the brief, questions, or deliverables"
          onChange={(e) => {
            setBrief(e.target.value);
            edit({ instructions_text: e.target.value });
          }}
          onBlur={() => void flush()}
        />
      </div>

      {draftMessage ? (
        <p role="status" className="mt-2 text-xs text-ink-soft">
          {draftMessage}
        </p>
      ) : null}
    </section>
  );
}
