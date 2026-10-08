import { NextResponse, type NextRequest } from "next/server";
import { Client } from "pg";
import { connectionString, sslConfigFor, stripSslmode, directPostgresConfigured } from "../../../lib/db-ddl";

export const dynamic = "force-dynamic";

/**
 * TEMPORARY first-run verification endpoint (2026-10-07) - REMOVED in the
 * final commit of this verification series. It exists ONLY to clean up the
 * disposable end-to-end test accounts after the owner-flow acceptance test,
 * so the real owner slot stays open for the actual owner.
 *
 * Security: requires a one-time random secret header; touches ONLY the two
 * hardcoded disposable test emails; refuses everything else categorically.
 */
const E2E_EMAILS = ["sophira-e2e-1@bridgeline.services", "sophira-e2e-2@bridgeline.services"];

export async function POST(request: NextRequest) {
  const secret = process.env.E2E_RESET_SECRET;
  if (!secret || request.headers.get("x-e2e-secret") !== secret) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (!directPostgresConfigured()) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  const url = connectionString();
  if (!url) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const client = new Client({ connectionString: stripSslmode(url), ssl: sslConfigFor(url) });
  try {
    await client.connect();
    await client.query(
      `delete from public.owner_bootstrap where claimed_by in (select id from auth.users where email = any($1::text[]))`,
      [E2E_EMAILS]
    );
    const r = await client.query(
      `delete from auth.users where email = any($1::text[]) returning id`,
      [E2E_EMAILS]
    );
    return NextResponse.json({ removed: r.rows.length });
  } catch (err) {
    return NextResponse.json(
      { error: "failed", detail: String((err as { message?: string }).message ?? "").slice(0, 120) },
      { status: 500 }
    );
  } finally {
    try {
      await client.end();
    } catch {
      /* already closed */
    }
  }
}
