/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Hostile audit 2026-10-06: the app uses no next/image component and
  // allows no remote image hosts — the Image Optimizer endpoint is pure
  // attack surface (DoS via remotePatterns on self-hosted builds), so it
  // is disabled outright. Re-enabling it is a conscious security decision
  // that must come with remotePatterns reviewed.
  images: { unoptimized: true },
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse"],
  },
  // The in-app legal pages read the REAL repository documents at request
  // time (single source of truth — never a duplicated copy). Standalone /
  // serverless deployments only include traced files, so the three documents
  // are force-included for exactly those routes.
  outputFileTracingIncludes: {
    "/terms": ["./docs/legal/TERMS_OF_SERVICE.md"],
    "/privacy": ["./docs/legal/PRIVACY_POLICY.md"],
    "/license": ["./LICENSE"],
  },
};
export default nextConfig;
