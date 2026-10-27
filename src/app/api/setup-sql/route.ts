import { BOOTSTRAP_SQL } from "@/lib/bootstrap-sql.generated";

/**
 * GET /api/setup-sql — the one-paste database setup text, served by the app
 * itself so the owner never depends on GitHub or a raw link.
 *
 * Security: accepts NO input, returns ONLY the fixed schema text built from
 * supabase/migrations (already public in the repository), never any secret
 * or connection string. Safe to expose on the public setup page.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(BOOTSTRAP_SQL, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
