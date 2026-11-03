import type { MetadataRoute } from "next";

/**
 * Crawler guidance (2026-11-03).
 *
 * Honest scope: robots.txt is a request, not access control. Every private area listed below is
 * already gated by the middleware, and this file does not change that - it exists so a crawler
 * that ignores nothing still does not enumerate a private member's screens or the first-run
 * owner setup page. Treat it as tidiness, never as a security boundary.
 */
export default function robots(): MetadataRoute.Robots {
  const privatePaths = [
    "/dashboard", "/notebooks", "/assignments", "/essay", "/research", "/tutor",
    "/courses", "/writing", "/math", "/schedule", "/memory", "/extract",
    "/teachers", "/settings", "/notifications", "/owner",
    "/create-owner", "/setup", "/reset-password", "/api/",
  ];
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: privatePaths }],
  };
}
