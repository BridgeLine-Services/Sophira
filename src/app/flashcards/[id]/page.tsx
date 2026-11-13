"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Button, Card, CardContent, Input } from "@/components/ui";
import { buildQueue } from "@/lib/flashcards/decks";
import { RATING_GUIDE } from "@/lib/flashcards/progress";
import type { Rating } from "@/lib/flashcards/schedule";

/**
 * STUDY ONE DECK (2026-11-13, directive Part 6 + Part 12).
 *
 * A student opens a deck and starts. No settings: the queue is what is due, then
 * what is new, and each answer is four plain words - Not yet, Partially, Correct,
 * Confident. The browser never decides the next date; it sends the answer and the
 * server schedules it, so progress cannot be inflated from here.
 *
 * The card tools below the study area (edit, retire, remove) call the owner-scoped
 * API; an edit cannot touch a card's schedule, so fixing a typo never resets it.
 */

interface CardRow {
  id: string;
  front: string;
  back: string;
  citation: string;
  due_at: string;
  reps: number;
  lapses: number;
  retired: boolean;
}

interface DeckBody {
  deck: { id: string; title: string; description: string };
  cards: CardRow[];
  summary: { total: number; due: number; learned: number; newCards: number; lapses: number };
}

export default function StudyDeckPage() {
  const params = useParams<{ id: string }>();
  const deckId = params?.id ?? "";
  const [body, setBody] = useState<DeckBody | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const nowISO = new Date().toISOString();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/flashcards/decks/${deckId}`, { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? "That deck could not be loaded.");
      setBody(payload.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That deck could not be loaded.");
    } finally {
      setLoaded(true);
    }
  }, [deckId]);

  useEffect(() => { void load(); }, [load]);

  const queue = useMemo(
    () => (body ? buildQueue(body.cards.map((c) => ({ ...c, dueAt: c.due_at })), nowISO, 20).queue : []),
    // nowISO is derived per render on purpose: the queue is rebuilt after every answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [body],
  );
  const current = queue[index] ?? null;

  async function answer(rating: Rating) {
    if (!current || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/flashcards/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_id: current.id, rating }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? "That answer could not be saved.");
      if (payload?.data?.warning) setNotice(payload.data.warning);
      setAnswered((n) => n + 1);
      setShown(false);
      setIndex((i) => i + 1);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That answer could not be saved, so nothing changed.");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(cardId: string) {
    if (!editFront.trim() || !editBack.trim()) {
      setNotice("A card needs both a question and an answer.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/flashcards/cards/${cardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front: editFront, back: editBack }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? "That card could not be saved.");
      setEditing(null);
      setNotice("Card saved. Its review schedule was left alone.");
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That card could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function patchCard(cardId: string, patch: Record<string, unknown>, message: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/flashcards/cards/${cardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? "That change could not be saved.");
      setNotice(message);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That change could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function removeCard(cardId: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/flashcards/cards/${cardId}`, { method: "DELETE" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? "That card could not be removed.");
      setConfirmRemove(null);
      setNotice("Card removed.");
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That card could not be removed.");
    } finally {
      setSaving(false);
    }
  }

  const title = body?.deck.title ?? "Flashcards";

  return (
    <AppShell
      subtitle="Answer each card honestly. Sophira decides when it comes back, so you do not have to keep track."
      title={title}
      actions={<Link href="/flashcards"><Button size="sm" variant="ghost">All decks</Button></Link>}
    >
      {notice ? (
        <p className="mb-4 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-soft" role="status">{notice}</p>
      ) : null}

      {!loaded ? (
        <p className="py-10 text-sm text-ink-soft">Loading this deck…</p>
      ) : error ? (
        <Card>
          <CardContent className="space-y-3">
            <p className="text-sm text-ink">This deck could not be opened just now. Nothing has been changed or lost.</p>
            <p className="text-sm text-ink-soft">{error}</p>
            <Button size="sm" onClick={() => { setLoaded(false); void load(); }}>Try again</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {body ? (
            <p className="text-sm text-ink-soft">
              {body.summary.total} card{body.summary.total === 1 ? "" : "s"} in this deck ·{" "}
              {body.summary.due} due now · {body.summary.learned} learned · {answered} answered in this session
            </p>
          ) : null}

          {current ? (
            <Card>
              <CardContent className="space-y-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  Card {index + 1} of {queue.length}
                </p>
                <p className="text-lg font-medium text-ink">{current.front}</p>
                {shown ? (
                  <div className="space-y-2">
                    <div className="h-px w-full bg-line" />
                    <p className="whitespace-pre-wrap text-base text-ink">{current.back}</p>
                    {current.citation ? <p className="text-xs text-ink-soft">Source: {current.citation}</p> : null}
                  </div>
                ) : null}

                {!shown ? (
                  <Button onClick={() => setShown(true)}>Show the answer</Button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-ink-soft">How did that go?</p>
                    <div className="flex flex-wrap gap-2">
                      {RATING_GUIDE.map((g) => (
                        <Button
                          key={g.rating}
                          variant={g.rating === "again" ? "secondary" : "primary"}
                          disabled={saving}
                          onClick={() => void answer(g.rating)}
                          title={g.meant}
                        >
                          {g.label}
                        </Button>
                      ))}
                    </div>
                    <ul className="mt-2 space-y-1 text-xs text-ink-soft">
                      {RATING_GUIDE.map((g) => <li key={g.rating}><span className="font-medium text-ink">{g.label}:</span> {g.meant}</li>)}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="space-y-3">
                <h2 className="text-base font-semibold text-ink">
                  {answered > 0 ? "That is everything for now" : "Nothing is due right now"}
                </h2>
                <p className="text-sm text-ink-soft">
                  {answered > 0
                    ? `You answered ${answered} card${answered === 1 ? "" : "s"}. Sophira will bring each one back when it is worth reviewing again.`
                    : "Every card in this deck is scheduled for later. Come back when one is due, or add another card below."}
                </p>
                <Link href="/flashcards"><Button size="sm" variant="secondary">Back to your decks</Button></Link>
              </CardContent>
            </Card>
          )}

          <section aria-labelledby="cards-in-deck">
            <h2 id="cards-in-deck" className="mb-3 text-base font-semibold text-ink">Cards in this deck</h2>
            <ul className="space-y-2">
              {(body?.cards ?? []).map((card) => (
                <li key={card.id}>
                  <Card>
                    <CardContent className="space-y-2">
                      {editing === card.id ? (
                        <div className="space-y-2">
                          <label className="block text-sm font-medium text-ink" htmlFor={`front-${card.id}`}>Question</label>
                          <Input id={`front-${card.id}`} value={editFront} onChange={(e) => setEditFront(e.target.value)} />
                          <label className="block text-sm font-medium text-ink" htmlFor={`back-${card.id}`}>Answer</label>
                          <Input id={`back-${card.id}`} value={editBack} onChange={(e) => setEditBack(e.target.value)} />
                          <div className="flex gap-2">
                            <Button size="sm" disabled={saving} onClick={() => void saveEdit(card.id)}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm font-medium text-ink">{card.front}</p>
                            {card.retired ? <Badge tone="neutral">Retired</Badge> : card.lapses >= 2 ? <Badge tone="warn">Needs work</Badge> : null}
                          </div>
                          <p className="text-sm text-ink-soft">{card.back}</p>
                          {confirmRemove === card.id ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm text-ink">Remove this card for good?</p>
                              <Button size="sm" variant="danger" disabled={saving} onClick={() => void removeCard(card.id)}>Yes, remove it</Button>
                              <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(null)}>Keep it</Button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" variant="ghost" onClick={() => { setEditing(card.id); setEditFront(card.front); setEditBack(card.back); }}>Edit</Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={saving}
                                onClick={() => void patchCard(card.id, { retired: !card.retired }, card.retired ? "Card back in rotation." : "Card retired. Its history is kept.")}
                              >
                                {card.retired ? "Bring back" : "Retire"}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(card.id)}>Remove</Button>
                            </div>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </AppShell>
  );
}
