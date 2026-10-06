/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
