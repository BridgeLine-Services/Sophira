import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { AiNotConfiguredError, aiChat, aiConfigured } from "@/lib/ai/client";
import {
  buildStudyPrompt,
  coverageNotice,
  renderTranscriptForModel,
  sanitizeCitations,
  splitStudySections,
  type StudySegment,
  type StudyTask,
} from "@/lib/media/study";

export const runtime = "nodejs";
export const maxDuration = 120;

const TASKS: StudyTask[] = ["summary", "notes", "questions"];

/**
 * POST /api/media/[id]/study  { task: "summary" | "notes" | "questions", ask?: string }
 *
 * Produces study material from a transcript Sophira already stored. The model
 * sees only timestamped transcript lines and is told how much of the audio was
 * actually transcribed; every timestamp it emits is then checked against the
 * real segments, and a citation that does not exist is replaced with
 * "timestamp unavailable" rather than shown as a source.
 *
 * A free-form `ask` question is answered the same way (lecture Q&A).
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  let body: { task?: string; ask?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* an empty body means "summary" */
  }
  const ask = typeof body.ask === "string" && body.ask.trim() ? body.ask.trim().slice(0, 800) : null;
  const task: StudyTask = ask ? "summary" : TASKS.includes(body.task as StudyTask) ? (body.task as StudyTask) : "summary";

  // RLS-scoped: only the owner's own recording and transcript are visible.
  const { data: asset } = await supabase
    .from("media_assets")
    .select("id, duration_sec, status, original_filename")
    .eq("id", id)
    .maybeSingle();
  if (!asset) {
    return NextResponse.json({ error: "That recording was not found in your library." }, { status: 404 });
  }

  const { data: transcript } = await supabase
    .from("media_transcripts")
    .select("id, coverage, confidence, language")
    .eq("asset_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!transcript?.id) {
    return NextResponse.json(
      { error: "There is no transcript for this recording yet. Start transcription first, then Sophira can write notes from it." },
      { status: 409 }
    );
  }

  const { data: segmentRows } = await supabase
    .from("media_segments")
    .select("start_sec, end_sec, text, speaker")
    .eq("transcript_id", transcript.id)
    .order("start_sec", { ascending: true })
    .limit(4000);

  const segments: StudySegment[] = (segmentRows ?? []).map((r) => ({
    start_sec: Number(r.start_sec),
    end_sec: Number(r.end_sec),
    text: String(r.text ?? ""),
    speaker: (r.speaker as string | null) ?? null,
  }));

  if (segments.length === 0) {
    return NextResponse.json(
      { error: "This recording has no readable speech in its transcript, so there is nothing to summarize. Nothing was invented." },
      { status: 409 }
    );
  }

  if (!aiConfigured()) {
    return NextResponse.json(
      { error: "Study notes need an AI model. Connect your local model or add a provider key in Settings, then try again." },
      { status: 501 }
    );
  }

  const rendered = renderTranscriptForModel(segments);
  const coverage = typeof transcript.coverage === "number" ? Number(transcript.coverage) : null;

  const prompt = ask
    ? buildStudyPrompt({
        task: "summary",
        transcript: rendered.text,
        coverage,
        durationSec: asset.duration_sec ? Number(asset.duration_sec) : null,
        truncated: rendered.truncated,
      }) +
      `\n\nTHE STUDENT ASKS: ${ask}\nAnswer the question using only the transcript, with a real timestamp in [m:ss] for each point. If the recording does not answer it, say "not covered in the recording".`
    : buildStudyPrompt({
        task,
        transcript: rendered.text,
        coverage,
        durationSec: asset.duration_sec ? Number(asset.duration_sec) : null,
        truncated: rendered.truncated,
      });

  let raw: string;
  try {
    raw = await aiChat(
      [
        { role: "system", content: "You are Sophira, a careful study assistant. You never invent sources or timestamps." },
        { role: "user", content: prompt },
      ],
      { temperature: 0.2, maxTokens: 1600 }
    );
  } catch (e) {
    if (e instanceof AiNotConfiguredError) {
      return NextResponse.json(
        { error: "The AI model is not reachable right now. Your transcript is safe; try again once the model is available." },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "Sophira could not produce study notes just now. Nothing was changed." },
      { status: 502 }
    );
  }

  const { text, removed } = sanitizeCitations(raw, segments);
  const notice = coverageNotice(coverage, removed);

  return NextResponse.json({
    data: {
      task: ask ? "question" : task,
      answer: text,
      sections: task === "summary" && !ask ? [] : splitStudySections(text),
      notice,
      coverage,
      usedSegments: rendered.usedSegments,
      truncated: rendered.truncated,
      removedCitations: removed,
      transcriptConfidence: transcript.confidence,
      language: transcript.language,
    },
  });
}
