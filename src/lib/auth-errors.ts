/**
 * Authentication error classification (2026-10-07).
 *
 * SECURITY CONTRACT:
 *  - An attacker who probes random emails must NEVER learn whether an
 *    account exists. "Invalid credentials" stays generic.
 *  - Safe operational states are distinguished WITHOUT leaking account
 *    existence: email-not-confirmed only ever appears AFTER a successful
 *    signup or when Supabase itself already returned it on a correct
 *    password — the caller was already in an authenticated context of
 *    knowledge, so repeating Supabase's own categorical state is safe.
 *  - Configuration/transport failures are reported as configuration
 *    problems — never as "wrong password" (the old behavior told owners
 *    their fresh credentials were wrong while the real issue was an
 *    unconfirmed email or an unreachable auth service).
 *
 * Classification prefers the machine-readable error CODE Supabase
 * (GoTrue) returns and falls back to message matching only as a second
 * signal — brittle substring matching alone was a past source of the
 * misleading "wrong credentials" message.
 */

export type AuthErrorKind =
  | "invalid_credentials" // generic — never reveals account existence
  | "email_not_confirmed" // actionable: confirm, then sign in
  | "user_already_exists" // signup race/retry — no duplicate account
  | "invitation_required" // the database rejected a non-invited signup
  | "service_unavailable" // transport/config — see /setup
  | "unexpected";

export interface AuthErrorInput {
  code?: string | null;
  message?: string | null;
  status?: number | null;
}

export interface ClassifiedAuthError {
  kind: AuthErrorKind;
  /** Safe, user-facing message. Never contains secret or account material. */
  userMessage: string;
}

const INVALID_CREDENTIALS_MESSAGE = "That email or password is not right. Please try again.";
const EMAIL_NOT_CONFIRMED_MESSAGE =
  "Your email is not confirmed yet. Check your inbox for the confirmation message (look in spam too), then sign in with the same email and password.";
const USER_EXISTS_MESSAGE =
  "An account with this email already exists. If you just created it, check your inbox for the confirmation message, then sign in.";
const INVITATION_MESSAGE =
  "Sophira is invitation-only. Sign-up needs a valid, unused invitation for your email address.";
const SERVICE_MESSAGE =
  "The authentication service cannot be reached right now — this is a server configuration problem, not a problem with your email or password. See the setup status.";

export function classifyAuthError(err: AuthErrorInput): ClassifiedAuthError {
  const code = (err.code ?? "").toLowerCase();
  const message = (err.message ?? "").toLowerCase();
  const combined = `${code} ${message}`;

  // 1. Email not confirmed — actionable guidance, never a fake credential error.
  if (
    code === "email_not_confirmed" ||
    message.includes("email not confirmed") ||
    message.includes("email address not confirmed")
  ) {
    return { kind: "email_not_confirmed", userMessage: EMAIL_NOT_CONFIRMED_MESSAGE };
  }

  // 2. Signup: the auth user already exists (previous attempt / retry).
  if (
    code === "user_already_exists" ||
    message.includes("already registered") ||
    message.includes("already exists") ||
    message.includes("a user with this email address has already been registered")
  ) {
    return { kind: "user_already_exists", userMessage: USER_EXISTS_MESSAGE };
  }

  // 3. Database trigger rejection: invitation-only (0008/0025 contract).
  if (message.includes("invitation")) {
    return { kind: "invitation_required", userMessage: INVITATION_MESSAGE };
  }

  // 3b. DATABASE failure during signup/sign-in (the drifted-database bug,
  // 2026-10-07): Supabase wraps a failed trigger (missing relation, missing
  // function, invitation check hitting a table that does not exist) in
  // HTTP 400 "Database error saving new user" (code 50026). This MUST be
  // reported as a setup problem - previously it fell into the status-400
  // branch below and the owner was told their fresh password was wrong.
  if (
    code === "50026" ||
    code === "database_error" ||
    code === "unexpected_failure" ||
    message.includes("database error saving") ||
    message.includes("db error saving") ||
    message.includes("database error") ||
    message.includes("could not find the function") ||
    message.includes("does not exist") && (message.includes("relation") || message.includes("schema"))
  ) {
    return {
      kind: "service_unavailable",
      userMessage:
        "Sophira's database is not fully set up yet - this is a server configuration problem, not a problem with your email or password. Open /setup and use Repair Setup (or see the setup status) to finish the one-time initialization.",
    };
  }

  // 4. Invalid credentials — the ONLY generic case, by design.
  if (
    code === "invalid_credentials" ||
    code === "bad_password" ||
    message.includes("invalid login") ||
    message.includes("wrong email or password") ||
    err.status === 400
  ) {
    return { kind: "invalid_credentials", userMessage: INVALID_CREDENTIALS_MESSAGE };
  }

  // 5. Transport / configuration failure (missing Supabase env, DNS,
  //    network, 5xx): an honest operational state — NOT a credential error.
  if (
    message.includes("failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("network request failed") ||
    message.includes("unable to connect") ||
    (typeof err.status === "number" && err.status >= 500)
  ) {
    return { kind: "service_unavailable", userMessage: SERVICE_MESSAGE };
  }

  // 6. Anything else: pass Supabase's own message through (it already
  //    avoids account-existence leaks) — never invent a state.
  return { kind: "unexpected", userMessage: err.message || SERVICE_MESSAGE };
}
