/**
 * REGRESSION TESTS: hostIs() / hostOf() (CodeQL #43)
 *
 * These pin the helper that replaced the URL substring assertions. The point of the
 * helper is that a hostname is compared AS A HOSTNAME: "evil-sophira.example.com"
 * and "sophira.example.com.attacker.invalid" both contain the expected text, and
 * neither is that host. Without these cases a future "simplification" back to
 * `.includes()` would still pass every other test in the suite.
 *
 * `hostIs` also treats true subdomains as belonging to the host (dot boundary), which
 * is what the callers mean: `app.sophira.example.com` IS the Sophira host.
 */

import { hostIn, hostIs, hostOf, mentionsHost, originIs, schemeIs } from "./helpers/url";

type Check = (condition: boolean, message: string) => void;

const PLACEHOLDER = "sophira.example.com";

export function runUrlHostHelperTests(assert: Check, _section?: unknown): void {
  // ---- the table the remediation was written against ---------------------------
  assert(hostIs("https://sophira.example.com", PLACEHOLDER) === true,
    "url-helper: the exact host matches");
  assert(hostIs("https://app.sophira.example.com", PLACEHOLDER) === true,
    "url-helper: a true subdomain matches (dot boundary)");
  assert(hostIs("https://evil-sophira.example.com", PLACEHOLDER) === false,
    "url-helper: a host that merely ENDS with the name does not match");
  assert(hostIs("https://sophira.example.com.attacker.invalid", PLACEHOLDER) === false,
    "url-helper: the name as a PREFIX of a foreign domain does not match");
  assert(hostIs("not a url", PLACEHOLDER) === false,
    "url-helper: a malformed URL does not match");
  assert(hostIs("", PLACEHOLDER) === false, "url-helper: an empty string does not match");
  assert(hostIs(null, PLACEHOLDER) === false, "url-helper: null does not match");
  assert(hostIs(undefined, PLACEHOLDER) === false, "url-helper: undefined does not match");

  // ---- the legitimate development URL must NOT be flagged as the placeholder --
  assert(hostIs("http://localhost:3000", PLACEHOLDER) === false,
    "url-helper: the dev URL localhost:3000 is not the placeholder host");
  assert(hostIs("http://127.0.0.1:3000", PLACEHOLDER) === false,
    "url-helper: a loopback IP is not the placeholder host");

  // ---- hostname normalization --------------------------------------------------
  assert(hostIs("https://SOPHIRA.Example.COM/", PLACEHOLDER) === true,
    "url-helper: host comparison is case-insensitive");
  assert(hostIs("https://sophira.example.com./path", PLACEHOLDER) === true,
    "url-helper: a trailing root dot is ignored");
  assert(hostIs(`https://${PLACEHOLDER}`, `.${PLACEHOLDER}`) === true,
    "url-helper: a leading dot in the expected host is tolerated");
  assert(hostIs("https://user:pw@sophira.example.com", PLACEHOLDER) === true,
    "url-helper: credentials do not change the host");
  assert(hostIs("https://sophira.example.com:8443/x?y=1#z", PLACEHOLDER) === true,
    "url-helper: port, path, query and fragment do not change the host");

  // ---- other helpers keep their contracts --------------------------------------
  assert(hostOf("https://app.sophira.example.com/x") === "app.sophira.example.com",
    "url-helper: hostOf returns the parsed hostname");
  assert(hostOf("nonsense") === "", "url-helper: hostOf returns an empty string for garbage");
  assert(hostIn("https://app.sophira.example.com", [PLACEHOLDER, "other.test"]) === true,
    "url-helper: hostIn matches any listed host");
  assert(hostIn("https://evil-sophira.example.com", [PLACEHOLDER]) === false,
    "url-helper: hostIn does not accept a lookalike host");
  assert(originIs("https://sophira.app/x", "https://sophira.app") === true,
    "url-helper: originIs compares scheme, host and port");
  assert(originIs("http://sophira.app/x", "https://sophira.app") === false,
    "url-helper: originIs rejects a different scheme");
  assert(originIs("https://sophira.app.evil.test", "https://sophira.app") === false,
    "url-helper: originIs rejects a suffixed lookalike");
  assert(schemeIs("http://localhost:3000", "http") === true,
    "url-helper: schemeIs compares the scheme exactly");
  assert(schemeIs("https://sophira.app", "http") === false,
    "url-helper: schemeIs does not treat https as http");

  // ---- mentionsHost: formatted text, not a bare URL ---------------------------
  assert(mentionsHost("Nature paper (https://www.nature.com/articles/1)", "nature.com") === true,
    "url-helper: mentionsHost finds the host inside formatted text");
  assert(mentionsHost("see evil-nature.com for details", "nature.com") === false,
    "url-helper: mentionsHost rejects a lookalike inside text");
  assert(mentionsHost("nature.com.attacker.invalid/page", "nature.com") === false,
    "url-helper: mentionsHost rejects the host as a prefix of a foreign domain");
  assert(mentionsHost("", "nature.com") === false, "url-helper: mentionsHost refuses empty text");
}
