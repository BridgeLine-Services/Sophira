/**
 * Offline subsystem — Supabase remote adapter.
 *
 * Real implementation of RemoteAdapter over the existing browser client.
 * Optimistic concurrency: updates/deletes carry the base server
 * updated_at; the server-side SQL function (supabase migration) applies
 * them only when the row still matches — see the offline RPC migration.
 * This module never invents data: on any doubt it reports what it saw.
 */

import type { QueueOp } from "./queue";
import type { OfflineRecord, OfflineTable } from "./store";
import type { ApplyResult, RemoteAdapter, RemoteRow } from "./sync";

/** Map offline tables to Supabase table + user scoping. */
const SUPABASE_TABLE: Record<OfflineTable, string> = {
  assignments: "assignments",
  materials: "study_materials",
  memories: "student_memories",
  learning_patterns: "learning_patterns",
  courses: "courses",
  teachers: "teachers",
  teacher_profiles: "teacher_profiles",
  typing_profile: "typing_profiles",
  schedules: "work_schedules",
  writing_profiles: "writing_profiles",
  rubric_context: "rubric_audits",
  preferences: "profiles",
  conflicts: "app_config", // never actually mirrored; placeholder mapping
};

type SupabaseClient = import("@supabase/supabase-js").SupabaseClient;

export class SupabaseRemoteAdapter implements RemoteAdapter {
  private client: SupabaseClient | null = null;

  constructor(
    /** lazy factory — the browser client is async-created and may fail when degraded */
    private readonly clientFactory: () => Promise<SupabaseClient> | SupabaseClient
  ) {}

  private async sb(): Promise<SupabaseClient> {
    if (!this.client) this.client = await this.clientFactory();
    return this.client;
  }

  async getRow(table: OfflineTable, id: string): Promise<RemoteRow | null> {
    const sb = SUPABASE_TABLE[table];
    const { data, error } = await (await this.sb()).from(sb).select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const d = data as Record<string, unknown>;
    return { id, row: data, updated_at: ((d.updated_at ?? d.created_at) as string) ?? "" };
  }

  async fetchChanged(table: OfflineTable, since: string | null): Promise<RemoteRow[]> {
    const sb = SUPABASE_TABLE[table];
    let q = (await this.sb()).from(sb).select("*");
    if (since) q = q.gt("updated_at", since);
    const { data, error } = await q.order("updated_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((d) => ({
      id: (d as Record<string, unknown>).id as string,
      row: d,
      updated_at: ((d as Record<string, unknown>).updated_at as string) ?? "",
    }));
  }

  async applyOp(op: QueueOp, record: OfflineRecord | null): Promise<ApplyResult> {
    const sb = SUPABASE_TABLE[op.table];
    if (op.kind === "create") {
      const payload = { ...(record?.row as Record<string, unknown>), id: op.id };
      const { error } = await (await this.sb()).from(sb).insert(payload);
      if (error) return classifyError(error);
      return { ok: true, updated_at: new Date().toISOString() };
    }
    if (op.kind === "update") {
      const payload = { ...(record?.row as Record<string, unknown>), id: op.id };
      // optimistic concurrency: only when the row still matches our base
      let q = (await this.sb()).from(sb).update(payload).eq("id", op.id);
      if (op.base_server_updated_at) q = q.eq("updated_at", op.base_server_updated_at);
      const { data, error } = await q.select();
      if (error) return classifyError(error);
      if (!data || data.length === 0) {
        // base no longer matches — conflict detected server-side
        return { ok: false, failure: { kind: "server", detail: "base-mismatch" } };
      }
      const d = data[0] as Record<string, unknown>;
      return { ok: true, updated_at: ((d.updated_at ?? d.created_at) as string) ?? new Date().toISOString() };
    }
    // delete
    const { data, error } = await (await this.sb()).from(sb).delete().eq("id", op.id).select();
    if (error) return classifyError(error);
    if (!data || data.length === 0) {
      // row gone or changed — let sync-side conflict logic decide via getRow
      return { ok: false, failure: { kind: "server", detail: "delete-noop" } };
    }
    return { ok: true, updated_at: new Date().toISOString() };
  }

  async isAuthorized(): Promise<boolean> {
    const sb = await this.sb().catch(() => null);
    if (!sb) return false;
    const { data } = await sb.auth.getSession();
    if (!data.session) return false;
    // probe with a cheap RLS-guarded call — revoked users fail here
    const { error } = await sb.from("profiles").select("id").limit(1);
    return !error;
  }
}

function classifyError(error: { message?: string; code?: string }): ApplyResult {
  const msg = (error.message ?? "").toLowerCase();
  if (msg.includes("revoked") || msg.includes("row-level security") || msg.includes("permission denied") || (error.code === "42501")) {
    return { ok: false, failure: { kind: "revoked" } };
  }
  if (msg.includes("jwt") || msg.includes("token") || msg.includes("not authenticated")) {
    return { ok: false, failure: { kind: "auth" } };
  }
  return { ok: false, failure: { kind: "server", detail: error.message } };
}
