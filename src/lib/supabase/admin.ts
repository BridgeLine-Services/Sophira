import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicSupabaseUrl, serviceRoleKey } from "../supabase-config";

/**
 * Service-role client. SERVER USE ONLY (API routes). Bypasses RLS.
 * Never import from a client component. Used strictly for:
 *  - marking invitations accepted during invite signup
 *  - account deletion requests
 */
export function createAdminClient() {
  return createSupabaseClient(
    publicSupabaseUrl()!,
    serviceRoleKey()!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
