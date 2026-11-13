import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { cardsFromArtifact, normalizeCard, type ArtifactLike } from "@/lib/flashcards/decks";
import { deckSummary, type ReviewableCard } from "@/lib/flashcards/schedule";

export const runtime = "nodejs";

/**
 * FLASHCARD DECKS (2026-11-13, directive Part 6).
 *
 *   GET  /api/flashcards/decks   → the student's decks with honest counts
 *   POST /api/flashcards/decks   { title?, artifact_id?, notebook_id?, course_id?, cards?[] }
 *        → a deck built from a GENERATED flashcards artifact (the normal path,
 *          keeping its provenance) or from hand-written cards.
 *
 * Every read and write is filtered by the signed-in student's id on top of RLS.
 * Nothing here invents cards: sections of an artifact that lack a question and
 * an answer are reported back as `skipped`, never filled in.
 */

interface CardRow extends ReviewableCard {
  reps: number;
  lapses: number;
}

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  // Optional narrowing by course, so decks can be organised by subject (Part 6).
  const courseId = new URL(request.url).searchParams.get("course_id");
  let deckQuery = supabase
    .from("flashcard_decks")
    .select("id, title, description, notebook_id, course_id, source_artifact_id, created_at, updated_at")
    .eq("user_id", guard.data.user.id)
    .order("updated_at", { ascending: false });
  if (courseId) deckQuery = deckQuery.eq("course_id", courseId);
  const { data: decks, error } = await deckQuery;
  if (error) return NextResponse.json({ error: "Could not load your decks." }, { status: 500 });

  const { data: cards } = await supabase
    .from("flashcards")
    .select("id, deck_id, due_at, reps, lapses, retired")
    .eq("user_id", guard.data.user.id);

  const nowISO = new Date().toISOString();
  const byDeck = new Map<string, CardRow[]>();
  for (const c of cards ?? []) {
    const key = (c as { deck_id: string }).deck_id;
    const list = byDeck.get(key) ?? [];
    list.push({ id: (c as { id: string }).id, dueAt: (c as { due_at: string }).due_at, reps: (c as { reps: number }).reps ?? 0, lapses: (c as { lapses: number }).lapses ?? 0, retired: (c as { retired: boolean }).retired ?? false });
    byDeck.set(key, list);
  }

  return NextResponse.json({
    data: (decks ?? []).map((d) => ({ ...d, summary: deckSummary(byDeck.get(d.id) ?? [], nowISO) })),
  });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  let body: {
    title?: string; description?: string; artifact_id?: string; notebook_id?: string | null;
    course_id?: string | null; cards?: { front?: unknown; back?: unknown; citation?: unknown }[];
  } = {};
  try { body = await request.json(); } catch { /* empty */ }

  let built: { front: string; back: string; citation: string; position: number }[] = [];
  let skipped: { heading: string; reason: string }[] = [];
  let title = (body.title ?? "").trim();
  let notebookId = body.notebook_id ?? null;
  let sourceArtifactId: string | null = null;

  if (body.artifact_id) {
    const { data: artifact, error } = await supabase
      .from("notebook_artifacts")
      .select("id, notebook_id, artifact_type, title, content")
      .eq("id", body.artifact_id)
      .eq("user_id", guard.data.user.id)
      .single();
    if (error || !artifact) return NextResponse.json({ error: "That set of flashcards could not be found." }, { status: 404 });
    if ((artifact as { artifact_type: string }).artifact_type !== "flashcards") {
      return NextResponse.json({ error: "That notebook item is not a flashcard set." }, { status: 400 });
    }
    const content = (artifact as { content?: ArtifactLike }).content ?? {};
    const result = cardsFromArtifact(content, (artifact as { title?: string }).title || "Flashcards");
    built = result.cards;
    skipped = result.skipped;
    if (!title) title = result.title;
    notebookId = (artifact as { notebook_id: string }).notebook_id ?? notebookId;
    sourceArtifactId = (artifact as { id: string }).id;
  } else if (Array.isArray(body.cards) && body.cards.length) {
    body.cards.forEach((c, i) => {
      const card = normalizeCard(c, i);
      if (card) built.push(card);
      else skipped.push({ heading: `card ${i + 1}`, reason: "a card needs both a front and a back" });
    });
  }

  if (built.length === 0) {
    return NextResponse.json({
      error: "There are no cards to study yet. Attach a flashcard set from a notebook, or add a card with both sides filled in.",
      skipped,
    }, { status: 400 });
  }
  if (!title) title = "Flashcards";

  const { data: deck, error: deckError } = await supabase
    .from("flashcard_decks")
    .insert({
      user_id: guard.data.user.id,
      title: title.slice(0, 160),
      description: (body.description ?? "").slice(0, 2000),
      notebook_id: notebookId,
      course_id: body.course_id ?? null,
      source_artifact_id: sourceArtifactId,
    })
    .select("id, title, description, notebook_id, course_id, source_artifact_id, created_at, updated_at")
    .single();
  if (deckError || !deck) return NextResponse.json({ error: "The deck could not be saved." }, { status: 500 });

  const nowISO = new Date().toISOString();
  const { data: inserted, error: cardError } = await supabase
    .from("flashcards")
    .insert(built.map((c) => ({
      deck_id: (deck as { id: string }).id,
      user_id: guard.data.user.id,
      front: c.front,
      back: c.back,
      citation: c.citation,
      position: c.position,
      due_at: nowISO,
    })))
    .select("id");
  if (cardError) {
    // Never leave a half-built deck behind.
    await supabase.from("flashcard_decks").delete().eq("id", (deck as { id: string }).id).eq("user_id", guard.data.user.id);
    return NextResponse.json({ error: "The cards could not be saved, so the deck was not created." }, { status: 500 });
  }

  return NextResponse.json({
    data: { deck, cards_saved: (inserted ?? []).length, skipped },
  }, { status: 201 });
}
