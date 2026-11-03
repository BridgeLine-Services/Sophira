/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Hostile audit 2026-10-06: the app uses no next/image component and
  // allows no remote image hosts — the Image Optimizer endpoint is pure
  // attack surface (DoS via remotePatterns on self-hosted builds), so it
  // is disabled outright. Re-enabling it is a conscious security decision
  // that must come with remotePatterns reviewed.
  images: { unoptimized: true },
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  // The in-app legal pages read the REAL repository documents at request
  // time (single source of truth — never a duplicated copy). Standalone /
  // serverless deployments only include traced files, so the three documents
  // are force-included for exactly those routes.
  // 2026-11-03: the built app sent NONE of the standard security headers (verified by probing
  // the running server), so every page was sniffable, leaky via Referer, and framable - the
  // worst case being /create-owner, which a hostile page could frame to trick an owner into
  // clicking through account creation. These four cost nothing and break nothing.
  //
  // Deliberately NOT added yet: a Content-Security-Policy. Next injects inline hydration
  // scripts and the app talks to Supabase and provider APIs, so a wrong policy white-screens
  // the app - and this environment has no browser to verify a policy against. It is tracked as
  // pending browser verification rather than shipped untested. X-Frame-Options below already
  // closes the clickjacking hole that frame-ancestors would cover.
  async headers() {
    const base = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    ];
    // HSTS is gated on NODE_ENV=production, which covers deployed builds and `next start`
    // (it sets NODE_ENV itself, so a local `next start` does send this header - verified).
    // That is harmless: browsers only honour HSTS received over HTTPS, and plain http ignores it.
    const withHsts = process.env.NODE_ENV === "production"
      ? [...base, { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
      : base;
    return [
      { source: "/:path*", headers: withHsts },
      // Private data must not sit in a shared cache (2026-11-03). These routes answer with a
      // member's own academic work, and nothing told any intermediary not to keep a copy.
      // no-store is the conservative choice: correctness over a marginal cache hit.
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, private" }],
      },
      // Authenticated pages are also per-member; a cached copy served to the next visitor would
      // be a data leak, so they are no-store too. Public pages keep their normal caching.
      {
        source: "/:path(dashboard|notebooks|assignments|essay|research|tutor|courses|writing|math|schedule|memory|extract|teachers|settings|notifications|owner)/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, private" }],
      },
    ];
  },
  outputFileTracingIncludes: {
    "/terms": ["./docs/legal/TERMS_OF_SERVICE.md"],
    "/privacy": ["./docs/legal/PRIVACY_POLICY.md"],
    "/license": ["./LICENSE"],
  },
};
export default nextConfig;
