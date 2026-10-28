/**
 * CONFIGURATION DISCOVERY (2026-10-28) - the ONE authoritative resolver.
 *
 * Composes what the app can learn about its own environment using the modules
 * that already own each concern (never a competing catalog):
 *   - Supabase project identity + key generation -> src/lib/supabase-config
 *   - canonical public origin                    -> src/lib/auth-redirect
 *   - invitation delivery providers              -> src/lib/invitations/delivery
 *   - database initialization channel            -> src/lib/db-bootstrap
 *
 * Contract: categorical results only. No key, token, password or connection
 * string is ever returned, so this may be rendered in a browser response.
 */
import { supabaseConfigStatus } from "../supabase-config";
import { appOrigin } from "../auth-redirect";
import { deliveryDiagnostics } from "../invitations/delivery";
import { setupChannel } from "../db-ddl";

export type DiscoveryState = "verified" | "missing" | "partial" | "unavailable";

export interface DiscoveryItem {
  key: string;
  label: string;
  state: DiscoveryState;
  missing: string[];
  note: string;
}

export interface DiscoveryReport {
  items: DiscoveryItem[];
  actions: string[];
  blocked: { action: string; reason: string }[];
}

export function discoverConfiguration(): DiscoveryReport {
  const supa = supabaseConfigStatus();
  const origin = appOrigin();
  const delivery = deliveryDiagnostics();
  const channel = setupChannel();

  const items: DiscoveryItem[] = [
    {
      key: "supabase",
      label: "Supabase project",
      state: supa.publicUrl && supa.anonKey && supa.serviceRole ? "verified" : supa.publicUrl ? "partial" : "missing",
      missing: [
        ...(supa.publicUrl ? [] : ["NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)"]),
        ...(supa.anonKey ? [] : ["NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY)"]),
        ...(supa.serviceRole ? [] : ["SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)"]),
      ],
      note: supa.publicUrl
        ? `URL source ${supa.urlSource ?? "unknown"}; server key source ${supa.serviceRoleSource ?? "none"}.`
        : "No Supabase URL was found in this environment.",
    },
    {
      key: "site_url",
      label: "Public site address",
      state: origin ? "verified" : "missing",
      missing: origin ? [] : ["NEXT_PUBLIC_SITE_URL (or a Vercel production domain)"],
      note: origin
        ? "Resolved and validated; used for invitation, confirmation and reset links."
        : "No safe public https address could be resolved, so emailed links cannot be built.",
    },
    {
      key: "database_initialization",
      label: "Database initialization",
      state: channel === "none" ? "unavailable" : "verified",
      missing: channel === "none"
        ? ["POSTGRES_URL_NON_POOLING (or SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF)"]
        : [],
      note: channel === "none"
        ? "No privileged channel exists, so Sophira cannot create its own tables from code."
        : `Automatic initialization is available via ${channel}.`,
    },
    {
      key: "email",
      label: "Invitation email",
      state: delivery.email.configured ? "verified" : "missing",
      missing: delivery.email.missing,
      note: delivery.email.configured
        ? `Provider ${delivery.email.provider ?? "configured"}.`
        : "Optional: without it the owner shares the invitation link manually.",
    },
    {
      key: "sms",
      label: "Invitation text message",
      state: delivery.sms.configured ? "verified" : "missing",
      missing: delivery.sms.missing,
      note: delivery.sms.configured ? "Twilio configured." : "Optional: text delivery stays off until configured.",
    },
  ];

  const actions: string[] = ["verify_setup"];
  if (channel !== "none") actions.unshift("initialize_database");
  if (supa.publicUrl && supa.anonKey) actions.push("create_owner_account");

  const blocked: { action: string; reason: string }[] = [];
  if (channel === "none") {
    blocked.push({
      action: "initialize_database",
      reason: "No server-side database connection or Supabase management token is configured, so the schema cannot be created from the app.",
    });
  }
  blocked.push({
    action: "persist_generated_secrets",
    reason: "Sophira authenticates with Supabase Auth, so it has no application secret to generate; persisting variables would require a Vercel API token, which is not configured.",
  });

  return { items, actions, blocked };
}
