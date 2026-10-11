/**
 * PROVIDER CONNECTION STORAGE (server-only, 2026-10-11).
 * OAuth tokens live in public.provider_connections — a table with RLS
 * enabled and NO policies, so anon/authenticated roles are denied by
 * default: client code can never read a token. Only the service role
 * (used here, exclusively in API routes) can read or write tokens, and
 * every query is additionally scoped to the requesting user's id.
 */
import { createAdminClient } from "@/lib/supabase/admin";

export type Provider = "microsoft" | "google";

export interface StoredConnection {
  provider: Provider;
  account_label: string | null;
  provider_account_id: string | null;
  granted_scopes: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
}

export async function getConnection(userId: string, provider: Provider): Promise<StoredConnection | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("provider_connections")
    .select("provider, account_label, provider_account_id, granted_scopes, access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (!data) return null;
  return data as StoredConnection;
}

export async function upsertConnection(
  userId: string,
  provider: Provider,
  tokens: { access_token: string; refresh_token: string | null; expires_at: string | null; granted_scopes?: string | null },
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("provider_connections")
    .upsert(
      {
        user_id: userId,
        provider,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
        granted_scopes: tokens.granted_scopes ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    );
  if (error) throw new Error("Could not save the connection.");
}

export async function updateTokens(userId: string, provider: Provider, accessToken: string, expiresAt: string | null): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("provider_connections")
    .update({ access_token: accessToken, expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("provider", provider);
  if (error) throw new Error("Could not refresh the connection.");
}

export async function deleteConnection(userId: string, provider: Provider): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("provider_connections").delete().eq("user_id", userId).eq("provider", provider);
  if (error) throw new Error("Could not remove the connection.");
}

/**
 * Persist the provider-side account identity (captured from a verified
 * provider response — never client-supplied) so every future operation is
 * auditable against the exact account the user connected.
 */
export async function saveConnectionMeta(
  userId: string,
  provider: Provider,
  meta: { account_label?: string | null; provider_account_id?: string | null },
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("provider_connections")
    .update({ ...meta, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("provider", provider);
  if (error) throw new Error("Could not update the connection metadata.");
}
