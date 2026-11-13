"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Button, Card, CardContent, EmptyState, Input, Spinner } from "@/components/ui";
import { Layers, Plus } from "lucide-react";

/**
 * FLASHCARDS: YOUR DECKS (2026-11-13, directive Part 6 + Part 12).
 *
 * Everything on this screen is counted from the student's own cards and review
 * log by the server (GET /api/flashcards/decks). Nothing here shows a percentage
 * the server did not compute, and nothing uses a scheduler word: a student sees
 * "cards due", "learned" and "new", never an interval or an ease factor.
 *
 * An empty account is told, in one sentence, how to get cards: open a notebook and
 * generate flashcards, or make a deck by hand here.
 */

interface Deck {
  id: string;
  title: string;
  description: string;
  course_id: string | null;
  updated_at: string;
  summary: { total: number; due: number; learned: number; newCards: number; lapses: number };
}

export default function FlashcardsPage() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState("");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/flashcards/decks", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Your decks could not be loaded.");
      setDecks(body.data ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your decks could not be loaded.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createDeck() {
    const cleanTitle = title.trim();
    const cleanFront = front.trim();
    const cleanBack = back.trim();
    if (!cleanTitle || !cleanFront || !cleanBack) {
      setNotice("A deck needs a name, and its first card needs both a question and an answer.");
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/flashcards/decks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: cleanTitle, cards: [{ front: cleanFront, back: cleanBack }] }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "That deck could not be saved.");
      setTitle(""); setFront(""); setBack(""); setShowNew(false);
      setNotice("Deck saved. Add more cards or start studying.");
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That deck could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell
      subtitle="Study the cards Sophira made from your notebooks, and see what is due today."
      title="Flashcards"
      actions={<Button size="sm" onClick={() => setShowNew((v) => !v)}><Plus className="h-4 w-4" /> New deck</Button>}
    >
      {notice ? (
        <p className="mb-4 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-soft" role="status">
          {notice}
        </p>
      ) : null}

      {showNew ? (
        <Card className="mb-6">
          <CardContent className="space-y-3">
            <h2 className="text-base font-semibold text-ink">Make a deck by hand</h2>
            <p className="text-sm text-ink-soft">
              Useful for a quick set of your own questions. To turn study material into cards, open a
              notebook and choose Flashcards.
            </p>
            <label className="block text-sm font-medium text-ink" htmlFor="deck-title">Deck name</label>
            <Input id="deck-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Cell transport" />
            <label className="block text-sm font-medium text-ink" htmlFor="card-front">Question</label>
            <Input id="card-front" value={front} onChange={(e) => setFront(e.target.value)} placeholder="What does osmosis move?" />
            <label className="block text-sm font-medium text-ink" htmlFor="card-back">Answer</label>
            <Input id="card-back" value={back} onChange={(e) => setBack(e.target.value)} placeholder="Water, across a semi-permeable membrane." />
            <div className="flex gap-2">
              <Button onClick={createDeck} disabled={saving}>{saving ? "Saving…" : "Save deck"}</Button>
              <Button variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!loaded ? (
        <div className="flex items-center gap-3 py-10 text-sm text-ink-soft"><Spinner /> Loading your decks…</div>
      ) : error ? (
        <Card>
          <CardContent className="space-y-3">
            <p className="text-sm text-ink">Your decks could not be loaded just now. Nothing has been changed or lost.</p>
            <p className="text-sm text-ink-soft">{error}</p>
            <Button size="sm" onClick={() => { setLoaded(false); void load(); }}>Try again</Button>
          </CardContent>
        </Card>
      ) : decks.length === 0 ? (
        <EmptyState
          icon={<Layers className="h-6 w-6" />}
          title="No decks yet"
          description="Open a notebook, generate flashcards from your sources, then press “Study these cards”. You can also make a deck by hand with the New deck button."
          action={<Link href="/notebooks"><Button size="sm">Open notebooks</Button></Link>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {decks.map((deck) => (
            <Card key={deck.id}>
              <CardContent className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-semibold text-ink">{deck.title}</h2>
                  {deck.summary.due > 0 ? <Badge>{deck.summary.due} due</Badge> : <Badge tone="neutral">Nothing due</Badge>}
                </div>
                {deck.description ? <p className="text-sm text-ink-soft">{deck.description}</p> : null}
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-ink-soft">Cards</dt><dd className="font-semibold text-ink">{deck.summary.total}</dd></div>
                  <div><dt className="text-ink-soft">Learned</dt><dd className="font-semibold text-ink">{deck.summary.learned}</dd></div>
                  <div><dt className="text-ink-soft">New</dt><dd className="font-semibold text-ink">{deck.summary.newCards}</dd></div>
                </dl>
                <div className="flex gap-2">
                  <Link href={`/flashcards/${deck.id}`}>
                    <Button size="sm">{deck.summary.due > 0 ? "Study now" : "Open deck"}</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
