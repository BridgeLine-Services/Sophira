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

/**
 * ACTIVE-ACCESS allow-list (hostile audit 2026-10-06). A profile status
 * is trusted ONLY if it is on this list — revoked users and ANY status
 * added later (typos included) fail CLOSED. Deny-list checks ("status
 * === revoked") would let an unknown status through; this cannot.
 * 'pending' is the status every invited signup is created with (the
 * invitation claim in the DB trigger IS the approval step); 'active' is
 * a restored member; 'accepted' is legacy.
 */
const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["pending", "accepted", "active"]);

export async function requireUser(
  supabase: SupabaseClient
): Promise<{ ok: true; data: GuardResult } | { ok: false; response: NextResponse }> {
  // Crash-audit 2026-10-07: EVERY protected API route flows through this
  // guard. If Supabase is unconfigured, unreachable, or misbehaves, the
  // error is converted to an honest 503 — never an unhandled 500 on all
  // 37 guarded routes. Fail CLOSED: the degraded state denies access.
  try {
    return await requireUserInner(supabase);
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sophira cannot reach its database right now. Please try again later or contact the operator." },
        { status: 503 }
      ),
    };
  }
}

async function requireUserInner(
  supabase: SupabaseClient
): Promise<{ ok: true; data: GuardResult } | { ok: false; response: NextResponse }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  // SELF-HEALING READ (2026-10-08): a failed profile read (permission
  // denied from the missing grants contract, or a genuinely absent row)
  // triggers ONE idempotent repair over the verified direct channel and a
  // retry. Only a still-failing read returns an error — and it now names
  // the ACTUAL failing reason instead of a dead-end "sign out and back in".
  const { data: profile, error: profileError } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!profile) {
    let repaired = false;
    let reason = profileError?.message ?? "profile record not found";
    try {
      const { provisionSignedInUser } = await import("@/lib/db-privileged");
      const repair = await provisionSignedInUser(user.id);
      if (repair.ok) {
        const retry = await supabase.from("profiles").select("*").eq("id", user.id).single();
        if (retry.data) {
          return { ok: true, data: { user, profile: retry.data as unknown as Profile } };
        }
        reason = retry.error?.message ?? reason;
      } else {
        reason = "the server's database channel is unavailable right now";
      }
    } catch {
      // direct channel unavailable — report the original reason below
    }
    void repaired;
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Your profile record could not be read (${reason}). Please try again in a moment; if it persists, contact the operator.` },
        { status: 403 }
      ),
    };
  }
  if (!ACTIVE_STATUSES.has((profile as Profile).status)) {
    // revoked, or a status the guard does not know → fail closed
    return {
      ok: false,
      response: NextResponse.json(
        (profile as Profile).status === "revoked"
          ? { error: "Your access to this network has been revoked by the owner." }
          : { error: "Your account status does not allow access. Contact the owner." },
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
