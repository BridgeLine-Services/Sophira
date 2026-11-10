/**
 * REGRESSION TESTS: WHICH DATABASE ARE WE MIGRATING? (CodeQL #43/#33/#26/#24/#21/#20)
 *
 * The rule under test is the one that matters: a connection string is accepted only
 * when its host and role match SUPABASE'S EXACT SHAPES for our project ref. Hostname
 * containment is not identity, and the cases below are the ones that used to pass
 * the old `host.includes(ref)` check.
 */

import { analyzeConnection, isSameProjectConnection } from "../src/lib/db/connection-identity";

type Check = (condition: boolean, message: string) => void;

const REF = "abcdefghijklmnopqrst";

export function runDbConnectionIdentityTests(assert: Check, _section?: unknown): void {
  // ---- the two legitimate shapes ------------------------------------------------
  assert(
    isSameProjectConnection(`postgresql://postgres:secret@db.${REF}.supabase.co:5432/postgres`, REF),
    "db-identity: a direct connection to db.<ref>.supabase.co is accepted",
  );
  assert(
    analyzeConnection(`postgresql://postgres:secret@db.${REF}.supabase.co:5432/postgres`, REF).kind === "direct",
    "db-identity: the direct connection is classified as direct (tried last)",
  );
  assert(
    isSameProjectConnection(`postgresql://postgres.${REF}:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres`, REF),
    "db-identity: a pooled connection naming the ref in the role is accepted",
  );
  assert(
    analyzeConnection(`postgresql://postgres.${REF}:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres`, REF).kind === "pooled",
    "db-identity: the pooled connection is classified as pooled (tried first)",
  );
  assert(
    isSameProjectConnection(`postgres://postgres.${REF}:pw@aws-0.pooler.supabase.com:5432/postgres`, REF),
    "db-identity: the region-less supavisor host is accepted",
  );
  assert(
    isSameProjectConnection(`postgresql://postgres:secret@db.${REF}.supabase.co/postgres`, REF),
    "db-identity: a URL with no explicit port uses the protocol default and is accepted",
  );
  assert(
    isSameProjectConnection(`postgresql://postgres:secret@db.${REF}.supabase.co:5432/postgres?sslmode=require`, REF),
    "db-identity: sslmode in the query string does not change identity",
  );

  // ---- a hostname that merely BEGINS with the legitimate host ------------------
  assert(
    !isSameProjectConnection(`postgresql://postgres:pw@db.${REF}.supabase.co.attacker.example:5432/postgres`, REF),
    "db-identity: db.<ref>.supabase.co.attacker.example is refused (prefix spoof)",
  );
  assert(
    !isSameProjectConnection(`postgresql://postgres:pw@db.${REF}.supabase.co.evil:5432/postgres`, REF),
    "db-identity: a suffixed host is refused even though it starts with ours",
  );

  // ---- a hostname that CONTAINS the ref as a substring -------------------------
  assert(
    !isSameProjectConnection(`postgresql://postgres:pw@db-${REF}-clone.neon.tech:5432/postgres`, REF),
    "db-identity: a foreign host containing the ref is refused",
  );
  assert(
    !isSameProjectConnection(`postgresql://postgres:pw@${REF}.db.example.com:5432/postgres`, REF),
    "db-identity: the ref as a leading label of a foreign domain is refused",
  );
  assert(
    !isSameProjectConnection(`postgresql://postgres:pw@pooler.supabase.com.evil.example:6543/postgres`, REF),
    "db-identity: a lookalike pooler domain is refused",
  );

  // ---- a DIFFERENT project ref -------------------------------------------------
  assert(
    !isSameProjectConnection("postgresql://postgres:pw@db.zzzzzzzzzzzzzzzzzzzz.supabase.co:5432/postgres", REF),
    "db-identity: another Supabase project's direct host is refused",
  );
  assert(
    !isSameProjectConnection("postgresql://postgres.zzzzzzzzzzzzzzzzzzzz:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres", REF),
    "db-identity: another project's pooled role is refused",
  );
  assert(
    analyzeConnection("postgresql://postgres.zzzzzzzzzzzzzzzzzzzz:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres", REF).reason === "project-mismatch",
    "db-identity: a foreign project on the real pooler is reported as a project mismatch",
  );

  // ---- unexpected protocol -----------------------------------------------------
  for (const protocol of ["http:", "https:", "mysql:", "file:", "redis:"]) {
    const url = `${protocol}//postgres:pw@db.${REF}.supabase.co:5432/postgres`;
    assert(!isSameProjectConnection(url, REF), `db-identity: ${protocol} is refused even with the right host`);
  }

  // ---- unexpected port ---------------------------------------------------------
  for (const port of ["3306", "6379", "1", "5433", "0"]) {
    const url = `postgresql://postgres:pw@db.${REF}.supabase.co:${port}/postgres`;
    assert(!isSameProjectConnection(url, REF), `db-identity: port ${port} is refused`);
  }

  // ---- credentials that try to move the host ------------------------------------
  // WHATWG parsing takes the LAST "@" as the host separator, so this string is
  // still our host and the stray "@" is part of the password. That is safe, and the
  // test records it so nobody "fixes" the parser expectation wrongly.
  assert(
    isSameProjectConnection(`postgresql://postgres:pw@evil.example@db.${REF}.supabase.co:5432/postgres`, REF),
    "db-identity: an @ inside the password still resolves to our host",
  );
  assert(
    !isSameProjectConnection(`postgresql://postgres:pw@db.${REF}.supabase.co@evil.example:5432/postgres`, REF),
    "db-identity: when the LAST @ names a foreign host, the connection is refused",
  );
  assert(
    !isSameProjectConnection(`postgresql://postgres%40evil.example:pw@db.${REF}.supabase.co:5432/postgres`, REF),
    "db-identity: a percent-encoded @ in the role is refused",
  );
  assert(
    !isSameProjectConnection(`postgresql://postgres%2F..%2F:pw@db.${REF}.supabase.co:5432/postgres`, REF),
    "db-identity: encoded path separators in the role are refused",
  );

  // ---- a redirect-style chain to a foreign host (the redirect case) ------------
  assert(
    !isSameProjectConnection(`postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres#@evil.example`, REF),
    "db-identity: a fragment is refused outright, so no parser disagreement can be engineered",
  );

  // ---- malformed input ---------------------------------------------------------
  for (const bad of ["", "not a url", "postgresql://", "postgresql://postgres", "db.${REF}.supabase.co", "://db.${REF}.supabase.co"]) {
    assert(!isSameProjectConnection(bad, REF), `db-identity: malformed input is refused: "${bad.slice(0, 24)}"`);
  }
  assert(analyzeConnection("nonsense", REF).reason === "malformed", "db-identity: garbage is reported as malformed, not as foreign");

  // ---- an unusable expected ref never authorizes anything ----------------------
  assert(!isSameProjectConnection(`postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`, ""), "db-identity: no expected ref means no connection is allowed");
  assert(!isSameProjectConnection(`postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`, "../etc"), "db-identity: a ref that is not a ref authorizes nothing");

  // ---- case handling: hostnames are case-insensitive, refs are too -------------
  assert(
    isSameProjectConnection(`postgresql://postgres:pw@DB.${REF.toUpperCase()}.SUPABASE.CO:5432/postgres`, REF),
    "db-identity: host case does not change identity (URL parser normalizes it)",
  );
}
