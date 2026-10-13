/**
 * PROVIDER SETUP STATUS (server-only, 2026-10-13).
 * Safe presence checks for the owner dashboard's Needs Attention section.
 * Booleans ONLY — never values. Pages must not reference secret variable
 * names directly (client-bundle boundary), so they ask here instead.
 */
import { microsoftConfigured } from "./microsoft";
import { googleConfigured } from "./google";

export function providerSetupStatus(): { microsoft: boolean; google: boolean; search: boolean } {
  return {
    microsoft: microsoftConfigured(),
    google: googleConfigured(),
    search: Boolean(process.env.SEARCH_API_KEY && process.env.SEARCH_API_KEY.trim() !== ""),
  };
}
