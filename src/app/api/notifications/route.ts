import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { listNotifications, markAllRead, markRead, readPreferences, CATEGORIES, type NotificationCategory } from "@/lib/notifications/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The member's own notification list (2026-11-02).
 *
 * Every action is scoped to the signed-in member by requireUser AND by an explicit user_id
 * filter AND by RLS: three independent reasons one member cannot touch another's notices.
 * There is no owner action here on purpose: the owner cannot read a member's notifications.
 */
export async function GET() {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const [{ items, unread }, preferences] = await Promise.all([
    listNotifications(supabase, guard.data.user.id),
    readPreferences(supabase, guard.data.user.id),
  ]);

  return NextResponse.json({ items, unread, preferences });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const userId = guard.data.user.id;

  let body: { action?: string; id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Sophira couldn't read that request. Please try again." }, { status: 400 });
  }

  if (body.action === "mark_all_read") {
    const ok = await markAllRead(supabase, userId);
    return ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "Sophira couldn't update your notifications just now. Please try again." }, { status: 500 });
  }

  if (body.action === "mark_read" && typeof body.id === "string") {
    const ok = await markRead(supabase, userId, body.id);
    return ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "Sophira couldn't update that notification just now. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ error: "Sophira didn't recognise that action." }, { status: 400 });
}

/** Preferences: categories the member turned off, plus the existing email digest switch. */
export async function PUT(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const userId = guard.data.user.id;

  let body: { categories?: Record<string, unknown>; email_enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Sophira couldn't read that request. Please try again." }, { status: 400 });
  }

  // Only known categories are stored, and only a real boolean is accepted.
  const categories: Partial<Record<NotificationCategory, boolean>> = {};
  for (const category of CATEGORIES) {
    const value = body.categories?.[category];
    if (typeof value === "boolean") categories[category] = value;
  }
  const emailEnabled = typeof body.email_enabled === "boolean" ? body.email_enabled : undefined;

  const { error } = await supabase.from("notification_preferences").upsert(
    {
      user_id: userId,
      categories,
      ...(emailEnabled === undefined ? {} : { email_enabled: emailEnabled }),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  return error
    ? NextResponse.json({ error: "Sophira couldn't save your notification choices just now. Please try again." }, { status: 500 })
    : NextResponse.json({ ok: true });
}
