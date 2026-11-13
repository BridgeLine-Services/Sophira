/**
 * PROVIDER SETUP STATUS (server-only, 2026-10-13).
 * Safe presence checks for the owner dashboard's Needs Attention section.
 * Booleans ONLY — never values. Pages must not reference secret variable
 * names directly (client-bundle boundary), so they ask here instead.
 */
import { microsoftConfigured } from "./microsoft";
import { googleConfigured } from "./google";
import { emailProviderConfigured, smsConfigured } from "../invitations/delivery";

/**
 * 2026-11-13 (directive Part 13): the readiness report had to say "unknown" for the
 * Google, Microsoft and invitation-email rows because /api/health did not expose them.
 * They are now reported from the SAME functions the real features call, so a status
 * page can never claim a service is ready while the feature that uses it is off.
 * Still booleans only - never a value, a key name or a hostname.
 */
export function providerSetupStatus(): {
  microsoft: boolean;
  google: boolean;
  search: boolean;
  email: boolean;
  sms: boolean;
} {
  return {
    microsoft: microsoftConfigured(),
    google: googleConfigured(),
    search: Boolean(process.env.SEARCH_API_KEY && process.env.SEARCH_API_KEY.trim() !== ""),
    email: emailProviderConfigured(),
    sms: smsConfigured(),
  };
}
