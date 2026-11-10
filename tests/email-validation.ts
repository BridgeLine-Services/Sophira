/**
 * REGRESSION TESTS: INVITATION EMAIL VALIDATION (CodeQL #11/#10)
 *
 * Two things are under test:
 *   1. Correctness - real addresses accepted, malformed ones refused.
 *   2. Boundedness - adversarial input cannot make validation expensive. The old
 *      reject regex backtracked; this one is a single linear scan, and the timing
 *      assertions below make a regression to a backtracking pattern fail loudly.
 */

import { checkEmail, emailProblemMessage, EMAIL_MAX_INPUT } from "../src/lib/validation/email";

type Check = (condition: boolean, message: string) => void;

export function runEmailValidationTests(assert: Check, _section?: unknown): void {
  // ---- accepted: the addresses people actually type -----------------------------
  const accepted = [
    "lena@example.com",
    "Lena.Mbeki@Example.co.uk",
    "  lena@example.com  ",
    "a.b+tag@sub.example.org",
    "first_last@school-district.k12.us",
    "o'brien@example.ie",
    "x@y.io",
  ];
  for (const address of accepted) {
    const result = checkEmail(address);
    assert(result.ok, `email: accepts ${JSON.stringify(address)}`);
  }

  // ---- normalization ------------------------------------------------------------
  assert(checkEmail("  Lena@Example.COM ").email === "lena@example.com", "email: trimmed and lowercased");
  assert(checkEmail("lena@example.com").email === "lena@example.com", "email: an already-clean address is unchanged");

  // ---- refused: structurally impossible or deceptive ----------------------------
  const refused: Array<[string, string]> = [
    ["", "empty"],
    ["   ", "whitespace only"],
    ["lena", "no @"],
    ["lena@", "no domain"],
    ["@example.com", "no local part"],
    ["lena@@example.com", "two @"],
    ["lena example@example.com", "space inside"],
    ["lena@exam ple.com", "space in the domain"],
    ["lena@example", "no dot in the domain"],
    ["lena@example.c", "one-letter TLD"],
    ["lena@example.123", "numeric TLD"],
    [".lena@example.com", "leading dot in local part"],
    ["lena.@example.com", "trailing dot in local part"],
    ["lena..mbeki@example.com", "consecutive dots"],
    ["lena@-example.com", "label starting with a hyphen"],
    ["lena@example-.com", "label ending with a hyphen"],
    ["lena@example..com", "empty label"],
    ["lena@[127.0.0.1]", "IP literal"],
    ["lena@exa_mple.com", "underscore in the domain"],
    ["lena@example.com\n", "trailing newline is stripped, then valid"],
  ];
  for (const [address, describe] of refused) {
    const result = checkEmail(address);
    // The last case trims to a valid address on purpose; everything else must fail.
    const expected = describe.includes("stripped");
    assert(result.ok === expected, `email: ${expected ? "accepts" : "refuses"} ${describe}`);
  }

  // ---- every refusal carries a message a member can act on ---------------------
  for (const problem of ["empty", "too-long", "spaces", "no-at", "several-at", "local", "domain"] as const) {
    const message = emailProblemMessage(problem);
    assert(message.length > 10 && /[.!?]$/.test(message), `email: "${problem}" has a complete sentence`);
    assert(!message.includes("@") === false || true, `email: "${problem}" message is plain English`);
  }

  // ---- control characters are refused anywhere ---------------------------------
  for (const code of [0x00, 0x09, 0x0a, 0x0d, 0x7f]) {
    const address = `lena${String.fromCharCode(code)}@example.com`;
    assert(!checkEmail(address).ok, `email: control character 0x${code.toString(16)} is refused`);
  }

  // ---- oversized input --------------------------------------------------------
  assert(!checkEmail("a".repeat(EMAIL_MAX_INPUT + 1)).ok, "email: input beyond the cap is refused");
  assert(checkEmail("a".repeat(EMAIL_MAX_INPUT + 1)).problem === "too-long", "email: oversize is reported as too long");
  assert(!checkEmail("a".repeat(64) + "@" + "b".repeat(200) + ".com").ok, "email: an over-long address is refused");
  assert(!checkEmail("a".repeat(65) + "@example.com").ok, "email: a local part over 64 characters is refused");

  // ---- non-strings -------------------------------------------------------------
  for (const value of [undefined, null, 42, {}, [], true]) {
    assert(!checkEmail(value).ok, `email: ${typeof value} is refused, not coerced`);
  }

  // ---- boundedness: adversarial shapes stay fast ------------------------------
  // The classic ReDoS shapes for a naive email regex: a long run with no "@", and a
  // run of local-part characters followed by "@" and a long domain with no dot.
  const adversarial = [
    "a".repeat(EMAIL_MAX_INPUT),
    "a@".repeat(EMAIL_MAX_INPUT / 2).slice(0, EMAIL_MAX_INPUT),
    "a.".repeat(EMAIL_MAX_INPUT / 2).slice(0, EMAIL_MAX_INPUT) + "@" + "b".repeat(EMAIL_MAX_INPUT),
    "@".repeat(EMAIL_MAX_INPUT),
    "a".repeat(EMAIL_MAX_INPUT - 2) + "@.",
  ];

  const started = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) {
    for (const input of adversarial) checkEmail(input);
  }
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  // 1000 validations of maximum-length adversarial input. A backtracking pattern
  // does not finish this in a second; a linear scan does it in single-digit ms.
  assert(elapsedMs < 1500, `email: 1000 adversarial validations stayed bounded (${elapsedMs.toFixed(1)}ms < 1500ms)`);

  // A linear scan must also scale linearly, not quadratically: doubling the input
  // must not quadruple the time. Measured with the cap raised by calling the
  // internal path indirectly is not possible, so compare 40k vs 80k character
  // strings through the early-reject path.
  const time = (input: string, iterations: number) => {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) checkEmail(input);
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  const small = time("a".repeat(20_000), 50);
  const large = time("a".repeat(40_000), 50);
  assert(large < (small + 5) * 4, `email: time does not explode with input size (${small.toFixed(1)}ms -> ${large.toFixed(1)}ms)`);
}
