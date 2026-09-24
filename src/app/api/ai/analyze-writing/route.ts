import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AiNotConfiguredError, aiChat, aiConfigured, parseJsonLoose } from "@/lib/ai/client";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Analyzes the user's OWN writing samples into a style summary + guidance.
 * Creates a PENDING proposal — nothing is applied until the user approves it.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!aiConfigured()) {
    return NextResponse.json(
      { error: "AI is not configured yet. An administrator needs to set the OPENAI_API_KEY environment variable. Nothing was lost — your samples are saved." },
      { status: 503 }
    );
  }

  let body: { sample_ids?: string[] } = {};
  try {
    body = await request.json();
  } catch {
    // no body → analyze all usable samples
  }

  let query = supabase
    .from("writing_samples")
    .select("*")
    .neq("representativeness", "not_representative")
    .order("created_at", { ascending: false })
    .limit(20);
  if (body.sample_ids?.length) query = query.in("id", body.sample_ids);

  const { data: samples } = await query;
  if (!samples || samples.length === 0) {
    return NextResponse.json(
      { error: "I need at least one writing sample marked as 'preferred' or 'neutral' before I can analyze your style. I will not invent a writing style without examples." },
      { status: 400 }
    );
  }

  const corpus = samples
    .map((s) => `--- Sample: "${s.title}" (genre: ${s.genre || "unspecified"}, ${s.representativeness}${s.academic_level ? `, ${s.academic_level}` : ""}) ---\n${(s.content || "").slice(0, 12000)}`)
    .join("\n\n");
  if (corpus.trim().length < 200) {
    return NextResponse.json(
      { error: "Your samples are too short to analyze reliably. Add a bit more writing (a full paragraph or more) and try again." },
      { status: 400 }
    );
  }

  let analysis: { summary?: Record<string, string>; guidance?: string } | null = null;
  try {
    const raw = await aiChat(
      [
        { role: "system", content: "You analyze a student's personal writing style from their own samples. You NEVER invent traits that the samples don't show. Respond only with JSON: {\"summary\": {\"sentence_length\": \"...\", \"vocabulary\": \"...\", \"formality\": \"...\", \"tone\": \"...\", \"paragraph_structure\": \"...\", \"transitions\": \"...\", \"use_of_examples\": \"...\", \"common_phrases\": \"...\", \"detail_level\": \"...\", \"person\": \"...\", \"citation_habits\": \"...\"}, \"guidance\": \"2-5 sentences of direct guidance an AI can follow to write like this student. Describe what is OBSERVED, with hedges where the evidence is thin.\"}" },
        { role: "user", content: `Analyze the writing style shown in these samples:\n\n${corpus}` },
      ],
      { temperature: 0.2, maxTokens: 1500, jsonMode: true }
    );
    analysis = parseJsonLoose(raw);
    if (!analysis?.guidance) analysis = null;
  } catch (err) {
    if (err instanceof AiNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 503 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "The analysis failed. Your samples are safe — please try again." }, { status: 502 });
  }
  if (!analysis?.guidance) {
    return NextResponse.json({ error: "I could not produce a reliable analysis from these samples. Please try again or add more writing." }, { status: 502 });
  }

  // Find or create the single writing profile row.
  const { data: existing } = await supabase
    .from("writing_profiles")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1);

  let profileId = existing?.[0]?.id;
  let version = (existing?.[0]?.version ?? 1) + 1;
  if (!profileId) {
    const { data: created, error: cErr } = await supabase
      .from("writing_profiles")
      .insert({ user_id: user.id, summary: {}, guidance: "", status: "draft", version: 1 })
      .select("id")
      .single();
    if (cErr || !created) return NextResponse.json({ error: "Could not create the writing profile record. Please try again." }, { status: 500 });
    profileId = created.id;
    version = 2;
  }

  const { data: proposal, error: pErr } = await supabase
    .from("profile_update_proposals")
    .insert({
      user_id: user.id,
      target_type: "writing",
      target_id: profileId,
      change_summary: `Writing Profile v${version} — analyzed from ${samples.length} sample${samples.length === 1 ? "" : "s"}`,
      proposed_changes: {
        guidance: analysis.guidance,
        summary: JSON.stringify(analysis.summary ?? {}),
        version: String(version),
      },
      context: { sample_ids: samples.map((s) => s.id), sample_count: samples.length },
      status: "pending",
    })
    .select("id")
    .single();
  if (pErr) return NextResponse.json({ error: "Could not save the proposal. Your samples are safe — please try again." }, { status: 500 });

  return NextResponse.json({
    data: {
      proposal_id: proposal.id,
      profile_id: profileId,
      summary: analysis.summary,
      guidance: analysis.guidance,
      sample_count: samples.length,
    },
  });
}
