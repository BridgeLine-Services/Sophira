import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PRESENCE HEARTBEAT (2026-11-12).
 *
 * One small authenticated call per signed-in tab, at the interval the owner configured.
 * The server decides everything: it confirms who the caller is (requireUser), refuses a
 * suspended or revoked account, writes the heartbeat, and returns the resulting session
 * count. A failed heartbeat is never retried into a fake success — the tab simply stops
 * reporting, and its row expires.
 *
 * POST   { session_id, interacted }  -> heartbeat
 * DELETE { session_id }              -> "I am leaving this tab"
 * GET                               -> the caller's own availability + thresholds
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const { session_id, interacted } = await readBody(request);
  if (!isSessionId(session_id)) {
    return NextResponse.json({ error: "Invalid session." }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("presence_heartbeat", {
    p_session_id: session_id,
    p_interacted: interacted === true,
  });
  if (error) {
    // Older database without migration 0050: report honestly, do not fake "connected".
    return NextResponse.json({ ok: false, presence: "unavailable" }, { status: 200 });
  }
  const result = (data ?? {}) as { ok?: boolean; error?: string; sessions?: number };
  if (result.ok !== true) {
    return NextResponse.json({ ok: false, reason: result.error ?? "not permitted" }, { status: 403 });
  }
  return NextResponse.json({ ok: true, sessions: result.sessions ?? 1 });
}

export async function DELETE(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const { session_id } = await readBody(request);
  if (!isSessionId(session_id)) {
    return NextResponse.json({ error: "Invalid session." }, { status: 400 });
  }
  await supabase.rpc("presence_release", { p_session_id: session_id });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const [{ data: availability }, { data: settings }] = await Promise.all([
    supabase.from("member_availability").select("availability, share_with_members").maybeSingle(),
    supabase
      .from("presence_settings")
      .select("heartbeat_interval_seconds, connection_timeout_seconds, active_threshold_seconds, idle_threshold_seconds, session_expiration_seconds, presence_update_interval_seconds")
      .eq("id", 1)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    availability: availability?.availability ?? "available",
    shareWithMembers: availability?.share_with_members ?? false,
    settings: settings ?? null,
  });
}

/** Set the member's own availability. Never touches account standing. */
export async function PUT(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  let body: { availability?: string; share_with_members?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That request could not be read." }, { status: 400 });
  }
  const availability = String(body.availability ?? "");
  if (!["available", "away", "busy", "dnd"].includes(availability)) {
    return NextResponse.json(
      { error: "Choose Available, Away, Busy or Do Not Disturb." },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc("presence_set_availability", {
    p_availability: availability,
    p_share_with_members: body.share_with_members === true,
  });
  if (error) {
    return NextResponse.json(
      { error: "Your availability could not be saved. Nothing was changed." },
      { status: 503 },
    );
  }
  const result = (data ?? {}) as { ok?: boolean; error?: string };
  if (result.ok !== true) {
    return NextResponse.json({ error: result.error ?? "That change was refused." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, availability });
}

async function readBody(request: NextRequest): Promise<{ session_id?: string; interacted?: boolean }> {
  try {
    return (await request.json()) as { session_id?: string; interacted?: boolean };
  } catch {
    return {};
  }
}

/** An opaque per-tab value: long enough to be unique, short enough to stay cheap. */
function isSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{8,64}$/.test(value);
}
