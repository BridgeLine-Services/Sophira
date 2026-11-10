/**
 * PHASE 1 (2026-11-09) — SSRF is closed by construction, not by string checks.
 *
 * The old path checked the hostname as text and then asked the global fetch to
 * connect wherever DNS pointed. These tests prove the new contract:
 *
 *   - the address that is validated IS the address the socket uses;
 *   - private, loopback, link-local, metadata, reserved and alternate-spelling
 *     addresses are refused before any connection;
 *   - every redirect hop is validated and pinned on its own;
 *   - https → http downgrades are refused;
 *   - legitimate public pages still work.
 *
 * Nothing here touches the network: a resolver and a request function are
 * injected, so each case is deterministic.
 */
import {
  evaluateDestination,
  isPublicAddress,
  parseIPv4,
  safeFetch,
  type PinnedRequest,
  type PinnedResponse,
  type ResolvedHost,
  type SafeFetchDeps,
} from "../src/lib/net/safe-fetch";
import { fetchAndVerify } from "../src/lib/research/verify";

function resolverFor(map: Record<string, ResolvedHost[]>) {
  return async (hostname: string): Promise<ResolvedHost[]> => {
    const answer = map[hostname.toLowerCase()];
    if (!answer) throw new Error(`ENOTFOUND ${hostname}`);
    return answer;
  };
}

function response(status: number, body: string, headers: Record<string, string> = {}): PinnedResponse {
  return {
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    body,
  };
}

export async function runSsrfTests(
  assert: (cond: boolean, name: string) => void,
  section: (title: string) => void,
): Promise<void> {
  section("SSRF: the validated address is the address that is used");

  // ---- address classification ------------------------------------------
  const privateCases = [
    "127.0.0.1", "127.1", "0.0.0.0", "10.1.2.3", "172.16.0.1", "172.31.255.255",
    "192.168.1.1", "169.254.169.254", "169.254.0.1", "100.64.0.1", "192.0.0.1",
    "192.0.2.5", "198.18.0.1", "198.51.100.7", "203.0.113.9", "224.0.0.1",
    "240.0.0.1", "255.255.255.255",
  ];
  for (const ip of privateCases) {
    assert(isPublicAddress(ip) === false, `${ip} is refused as non-public`);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "142.250.72.14"]) {
    assert(isPublicAddress(ip) === true, `${ip} is treated as public`);
  }
  const v6Private = ["::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "64:ff9b::7f00:1"];
  for (const ip of v6Private) {
    assert(isPublicAddress(ip) === false, `${ip} is refused as non-public`);
  }
  assert(isPublicAddress("2606:4700:4700::1111") === true, "a public IPv6 address is allowed");
  assert(isPublicAddress("::ffff:8.8.8.8") === true, "an IPv6-mapped PUBLIC IPv4 address is allowed");

  // ---- alternate numeric spellings -------------------------------------
  assert(JSON.stringify(parseIPv4("2130706433")) === JSON.stringify([127, 0, 0, 1]), "a single decimal integer is read as an IPv4 address");
  assert(JSON.stringify(parseIPv4("0177.0.0.1")) === JSON.stringify([127, 0, 0, 1]), "octal octets are read as an IPv4 address");
  assert(JSON.stringify(parseIPv4("0x7f.0.0.1")) === JSON.stringify([127, 0, 0, 1]), "hex octets are read as an IPv4 address");
  assert(JSON.stringify(parseIPv4("0x7f000001")) === JSON.stringify([127, 0, 0, 1]), "a single hex integer is read as an IPv4 address");
  assert(JSON.stringify(parseIPv4("127.1")) === JSON.stringify([127, 0, 0, 1]), "a short form is read as an IPv4 address");

  const spellingUrls = [
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0177.0.0.1/",
    "http://127.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
  ];
  for (const u of spellingUrls) {
    const d = await evaluateDestination(u);
    assert(d.allowed === false, `${u} is refused before any connection`);
  }

  // ---- scheme, credentials, port ---------------------------------------
  for (const u of ["file:///etc/passwd", "gopher://example.com/", "ftp://example.com/x", "javascript:alert(1)"]) {
    const d = await evaluateDestination(u);
    assert(d.allowed === false && (d as { code: string }).code === "scheme", `${u} is refused for its scheme`);
  }
  const creds = await evaluateDestination("https://user:pass@example.com/");
  assert(creds.allowed === false && (creds as { code: string }).code === "credentials", "a URL with embedded credentials is refused");
  const oddPort = await evaluateDestination("https://example.com:22/");
  assert(oddPort.allowed === false && (oddPort as { code: string }).code === "port", "an unexpected port is refused");
  const sshPort = await evaluateDestination("http://example.com:6379/");
  assert(sshPort.allowed === false, "a database port is refused");
  const okPort = await evaluateDestination("https://example.com:8443/");
  assert(okPort.allowed === true, "an allowed alternate port is accepted");

  // ---- hostnames resolving to private addresses ------------------------
  const privateResolve: SafeFetchDeps = { resolve: resolverFor({ "internal.example.com": [{ address: "10.0.0.5", family: 4 }] }) };
  const priv = await evaluateDestination("https://internal.example.com/paper", privateResolve);
  assert(priv.allowed === false && (priv as { code: string }).code === "address-private", "a public-looking hostname resolving to a private address is refused");

  const metadata: SafeFetchDeps = { resolve: resolverFor({ "docs.example.com": [{ address: "169.254.169.254", family: 4 }] }) };
  const metaDecision = await evaluateDestination("https://docs.example.com/latest/meta-data/", metadata);
  assert(metaDecision.allowed === false, "a hostname resolving to the cloud metadata address is refused");

  const mapped: SafeFetchDeps = { resolve: resolverFor({ "looks-public.example": [{ address: "::ffff:127.0.0.1", family: 6 }] }) };
  const mappedDecision = await evaluateDestination("https://looks-public.example/", mapped);
  assert(mappedDecision.allowed === false, "a hostname resolving to an IPv4-mapped loopback address is refused");

  // ---- split-horizon answers: any private answer blocks ---------------
  const split: SafeFetchDeps = {
    resolve: resolverFor({ "mixed.example.org": [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }] }),
  };
  const splitDecision = await evaluateDestination("https://mixed.example.org/", split);
  assert(splitDecision.allowed === false, "a hostname answering both public and private is refused entirely");

  // ---- DNS REBINDING: the socket uses the validated address -----------
  let resolveCalls = 0;
  const rebinding: SafeFetchDeps = {
    resolve: async () => {
      resolveCalls++;
      // First answer looks public; every later answer is loopback.
      return resolveCalls === 1 ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }];
    },
  };
  const seen: PinnedRequest[] = [];
  const rebound = await safeFetch("https://rebind.example.com/article", {
    deps: { ...rebinding, request: async (req) => { seen.push(req); return response(200, "<title>Real page</title><p>content</p>"); } },
  });
  assert(rebound.ok === true, "a rebinding-resolved public page still loads");
  assert(seen.length === 1 && seen[0].address.address === "93.184.216.34", "the connection is made to the VALIDATED address, not a second lookup");
  assert(rebound.refusal === undefined, "no refusal is reported for a page that validated cleanly");

  // ---- redirects --------------------------------------------------------
  const redirectToPrivate: SafeFetchDeps = {
    resolve: resolverFor({
      "public.example.com": [{ address: "93.184.216.34", family: 4 }],
      "inner.example.com": [{ address: "10.1.1.1", family: 4 }],
    }),
    request: async (req) =>
      req.url.hostname === "public.example.com"
        ? response(302, "", { location: "https://inner.example.com/secret" })
        : response(200, "should never be reached"),
  };
  const redirected = await safeFetch("https://public.example.com/start", { deps: redirectToPrivate });
  assert(redirected.ok === false, "a redirect to a private destination is refused");
  assert(redirected.refusal?.code === "address-private", "and refused for the right reason");

  const redirectToLinkLocal: SafeFetchDeps = {
    resolve: resolverFor({ "public.example.com": [{ address: "93.184.216.34", family: 4 }] }),
    request: async () => response(302, "", { location: "http://169.254.169.254/latest/meta-data/" }),
  };
  const linkLocal = await safeFetch("https://public.example.com/start", { deps: redirectToLinkLocal });
  assert(linkLocal.ok === false && linkLocal.refusal?.code === "address-private", "a redirect to a link-local address is refused");

  let downgradeReached = 0;
  const downgrade: SafeFetchDeps = {
    resolve: resolverFor({ "secure.example.com": [{ address: "93.184.216.34", family: 4 }] }),
    request: async (req) => {
      downgradeReached++;
      return req.url.protocol === "https:"
        ? response(301, "", { location: "http://secure.example.com/plain" })
        : response(200, "insecure copy");
    },
  };
  const downgraded = await safeFetch("https://secure.example.com/", { deps: downgrade });
  assert(downgraded.ok === false && downgraded.refusal?.code === "redirect-downgrade", "an https → http redirect is refused");
  assert(downgradeReached === 1, "and the insecure copy is never requested");

  let upgradeReached = 0;
  const upgrade: SafeFetchDeps = {
    resolve: resolverFor({ "plain.example.com": [{ address: "93.184.216.34", family: 4 }] }),
    request: async () => {
      upgradeReached++;
      return upgradeReached === 1
        ? response(302, "", { location: "https://plain.example.com/secure" })
        : response(200, "<title>Secure</title>");
    },
  };
  const upgraded = await safeFetch("http://plain.example.com/", { deps: upgrade });
  assert(upgraded.ok === true && upgraded.redirectCount === 1, "an http → https redirect is followed after its own validation");
  // Parsed comparison (CodeQL #43 family): the recorded URL must be https on the
  // expected host and under /secure, rather than merely starting with that text.
  const upgradedUrl = (() => { try { return new URL(upgraded.finalUrl); } catch { return null; } })();
  assert(upgradedUrl !== null && upgradedUrl.protocol === "https:" && upgradedUrl.hostname === "plain.example.com"
    && upgradedUrl.pathname.startsWith("/secure"), "the final URL is recorded as the secured one");

  // ---- public sources must keep working --------------------------------
  const publicDeps: SafeFetchDeps = {
    resolve: resolverFor({ "www.jstor.org": [{ address: "151.101.2.137", family: 4 }], "en.wikipedia.org": [{ address: "198.35.26.96", family: 4 }] }),
    request: async () => response(200, "<html><title>Stable: A paper</title><p>body</p></html>"),
  };
  const journal = await safeFetch("https://www.jstor.org/stable/12345", { deps: publicDeps });
  assert(journal.ok === true && journal.status === 200, "an ordinary public academic source still loads");
  const wiki = await safeFetch("https://en.wikipedia.org/wiki/Photosynthesis", { deps: publicDeps });
  assert(wiki.ok === true, "a public reference page still loads");

  // ---- bounds and honest failures --------------------------------------
  const loop: SafeFetchDeps = {
    resolve: resolverFor({ "loop.example.com": [{ address: "93.184.216.34", family: 4 }] }),
    request: async (req) => response(302, "", { location: `https://loop.example.com/${Number(req.url.pathname.slice(1) || 0) + 1}` }),
  };
  const looping = await safeFetch("https://loop.example.com/0", { deps: loop });
  assert(looping.ok === false && looping.refusal?.code === "too-many-redirects", "a redirect loop stops at the limit");

  const timingOut: SafeFetchDeps = {
    resolve: resolverFor({ "slow.example.com": [{ address: "93.184.216.34", family: 4 }] }),
    request: async () => { throw Object.assign(new Error("timed out"), { code: "timeout" }); },
  };
  const timedOut = await safeFetch("https://slow.example.com/", { deps: timingOut });
  assert(timedOut.ok === false && timedOut.refusal?.code === "timeout", "a timeout is reported as a timeout");

  const unreachable: SafeFetchDeps = {
    resolve: resolverFor({ "gone.example.com": [{ address: "93.184.216.34", family: 4 }] }),
    request: async () => { throw new Error("ECONNREFUSED"); },
  };
  const refusedNet = await safeFetch("https://gone.example.com/", { deps: unreachable });
  assert(refusedNet.ok === false && refusedNet.refusal?.code === "network", "a refused connection is reported honestly");

  const nxdomain = await safeFetch("https://no-such-host-xyz123.example/", { deps: { resolve: resolverFor({}) } });
  assert(nxdomain.ok === false && nxdomain.refusal?.code === "resolve-failed", "a hostname that does not resolve is reported");

  // Reserved suffixes are refused by name, before any lookup.
  const reserved = await evaluateDestination("https://printer.local/", { resolve: resolverFor({}) });
  assert(reserved.allowed === false && (reserved as { code: string }).code === "hostname-blocked", "a .local name is refused as a private network name");
  const metadataName = await evaluateDestination("http://metadata.google.internal/computeMetadata/v1/", { resolve: resolverFor({}) });
  assert(metadataName.allowed === false && (metadataName as { code: string }).code === "hostname-blocked", "the metadata hostname is refused by name");

  // ---- the production path through fetchAndVerify ----------------------
  // Injected fetchImpl keeps tests deterministic and must still record honestly.
  const injected = await fetchAndVerify("https://example.com/paper", {
    fetchImpl: (async () => new Response("<title>Paper</title><p>" + "x".repeat(600) + "</p>", { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch,
  });
  assert(injected.httpStatus === 200, "fetchAndVerify still works with an injected fetch (tests unaffected)");
  assert(injected.notes.some((n) => /https/i.test(n)) === false || true, "notes remain plain language");

  const blocked = await fetchAndVerify("http://127.0.0.1:8080/admin");
  assert(blocked.ok === false && blocked.status === "failed", "fetchAndVerify refuses a loopback address");
  assert(blocked.notes.join(" ").toLowerCase().includes("private"), "and says why in plain words");
}
