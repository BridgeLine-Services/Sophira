import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";

/**
 * Server-side authorization guard for API routes (workflow §21).
 *
 * Middleware hides pages from unauthenticated users, but EVERY protected API
 * endpoint independently checks authentication AND account status. A revoked
 * user must not reach the AI, files, feedback, or learning APIs even by
 * calling them directly.
 */

export interface GuardResult {
  user: { id: string; email?: string | null };
  profile: Profile;
}

export async function requireUser(
  supabase: SupabaseClient
): Promise<{ ok: true; data: GuardResult } | { ok: false; response: NextResponse }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!profile) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Your profile is missing. Please sign out and sign back in." },
        { status: 403 }
      ),
    };
  }
  if ((profile as Profile).status === "revoked") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Your access to this network has been revoked by the owner." },
        { status: 403 }
      ),
    };
  }
  return { ok: true, data: { user: { id: user.id, email: user.email }, profile: profile as Profile } };
}

export async function requireOwner(
  supabase: SupabaseClient
): Promise<{ ok: true; data: GuardResult } | { ok: false; response: NextResponse }> {
  const result = await requireUser(supabase);
  if (!result.ok) return result;
  if (result.data.profile.role !== "owner") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Only the owner can do this." }, { status: 403 }),
    };
  }
  return result;
}
