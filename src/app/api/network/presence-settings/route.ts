import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/supabase/guard";
import {
  DEFAULT_THRESHOLDS,
  THRESHOLD_BOUNDS,
  THRESHOLD_LABELS,
  clampThresholds,
  validateThresholds,
  type PresenceThresholds,
} from "@/lib/presence/thresholds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = [
  "heartbeat_interval_seconds",
  "connection_timeout_seconds",
  "active_threshold_seconds",
  "idle_threshold_seconds",
  "session_expiration_seconds",
  "presence_update_interval_seconds",
] as const;

const FROM_COLUMN: Record<(typeof COLUMNS)[number], keyof PresenceThresholds> = {
  heartbeat_interval_seconds: "heartbeatIntervalSeconds",
  connection_timeout_seconds: "connectionTimeoutSeconds",
  active_threshold_seconds: "activeThresholdSeconds",
  idle_threshold_seconds: "idleThresholdSeconds",
  session_expiration_seconds: "sessionExpirationSeconds",
  presence_update_interval_seconds: "presenceUpdateIntervalSeconds",
};

/**
 * PRESENCE THRESHOLDS (2026-11-12).
 *
 * The six numbers that decide when a member reads Active, Idle or Offline. They existed in
 * the database and in validation but had no way in from the interface, so the published
 * defaults were the only values an owner could ever have.
 *
 * Owner only, in three places: requireOwner here, the permission matrix, and the RLS policy
 * `presence_settings_owner_write`. A Co-Owner manages members but does not retune the clock
 * everyone is measured against.
 *
 * Validation runs before the write and again as CHECK constraints in the database, so a value
 * that would make every member flicker offline cannot be stored even by direct SQL. Refusals
 * are sentences, because "violates check constraint" is not something an owner can act on.
 */
export async function GET() {
  const supabase = createClient();
  const guard = await requireOwner(supabase);
  if (!guard.ok) return guard.response;

  const { data } = await supabase
    .from("presence_settings")
    .select(COLUMNS.join(", "))
    .eq("id", 1)
    .maybeSingle();

  const thresholds = data ? clampThresholds(readRow(data as unknown as Record<string, unknown>)) : DEFAULT_THRESHOLDS;

  return NextResponse.json({
    thresholds,
    bounds: THRESHOLD_BOUNDS,
    labels: THRESHOLD_LABELS,
    defaults: DEFAULT_THRESHOLDS,
  });
}

export async function PUT(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireOwner(supabase);
  if (!guard.ok) return guard.response;

  let body: { thresholds?: Record<string, unknown> };
  try {
    body = (await request.json()) as { thresholds?: Record<string, unknown> };
  } catch {
    return NextResponse.json({ error: "That request could not be read." }, { status: 400 });
  }

  if (!body?.thresholds || typeof body.thresholds !== "object") {
    return NextResponse.json({ error: "No presence settings were sent." }, { status: 400 });
  }

  const problems = validateThresholds(body.thresholds);
  if (problems.length > 0) {
    return NextResponse.json({ error: problems[0], problems }, { status: 400 });
  }

  const next = clampThresholds({ ...DEFAULT_THRESHOLDS, ...pick(body.thresholds) });

  const { error } = await supabase
    .from("presence_settings")
    .update({
      heartbeat_interval_seconds: next.heartbeatIntervalSeconds,
      connection_timeout_seconds: next.connectionTimeoutSeconds,
      active_threshold_seconds: next.activeThresholdSeconds,
      idle_threshold_seconds: next.idleThresholdSeconds,
      session_expiration_seconds: next.sessionExpirationSeconds,
      presence_update_interval_seconds: next.presenceUpdateIntervalSeconds,
      updated_at: new Date().toISOString(),
      updated_by: guard.data.user.id,
    })
    .eq("id", 1);

  if (error) {
    return NextResponse.json(
      {
        error:
          "Those presence settings could not be saved, so nothing changed. Check that each number is inside its range and that the order makes sense.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, thresholds: next });
}

/** Keep only known keys, so an unexpected field in the body can never reach the write. */
function pick(input: Record<string, unknown>): Partial<PresenceThresholds> {
  const out: Partial<PresenceThresholds> = {};
  for (const key of Object.keys(DEFAULT_THRESHOLDS) as Array<keyof PresenceThresholds>) {
    const value = input[key];
    if (value !== undefined && value !== null && value !== "") {
      out[key] = Number(value) as never;
    }
  }
  return out;
}

function readRow(row: Record<string, unknown>): PresenceThresholds {
  const out = { ...DEFAULT_THRESHOLDS };
  for (const column of COLUMNS) {
    const value = row[column];
    if (value !== undefined && value !== null) out[FROM_COLUMN[column]] = Number(value) as never;
  }
  return out;
}
