"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, Input, Label,
  Select, Spinner, useToast,
} from "@/components/ui";
import { fmtDate } from "@/lib/format";
import type { Invitation, Profile } from "@/lib/types";
import { Copy, Smartphone } from "lucide-react";

const LEVELS = ["Kindergarten/Elementary", "Middle school", "High school", "College/Undergraduate", "Graduate/Master's", "PhD", "Other"];
const EXPLANATION = ["Simple", "Standard", "Advanced"];

export default function SettingsPage() {
  const supabase = createClient();
  const router = useRouter();
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState({ display_name: "", academic_level: "", explanation_level: "", answer_style: "", formatting_pref: "", preferred_language: "" });
  const [saving, setSaving] = useState(false);

  // Invitations (owner)
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  // Account deletion
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      setUserId(user.id);
      setEmail(user.email ?? "");
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (p) {
        setProfile(p as Profile);
        setForm({
          display_name: p.display_name || "",
          academic_level: p.academic_level || "",
          explanation_level: p.explanation_level || "",
          answer_style: p.answer_style || "",
          formatting_pref: p.formatting_pref || "",
          preferred_language: p.preferred_language || "",
        });
      }
      if ((p as Profile)?.role === "owner") {
        fetch("/api/invitations")
          .then((r) => (r.ok ? r.json() : { data: [] }))
          .then((j) => setInvitations(j.data ?? []))
          .catch(() => undefined);
      }
    });
  }, [supabase, router]);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: form.display_name.trim(),
        academic_level: form.academic_level || null,
        explanation_level: form.explanation_level || null,
        answer_style: form.answer_style.trim() || null,
        formatting_pref: form.formatting_pref.trim() || null,
        preferred_language: form.preferred_language.trim() || null,
      })
      .eq("id", userId!);
    setSaving(false);
    if (error) {
      toast("error", "Could not save: " + error.message);
      return;
    }
    toast("success", "Saved. New answers will use these preferences.");
  }

  async function createInvite(e: FormEvent) {
    e.preventDefault();
    setInviteBusy(true);
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail }),
      });
      const json = await res.json();
      if (res.ok) {
        setInvitations((list) => [json.data, ...list]);
        setInviteLink(json.data.link);
        setInviteEmail("");
        toast("success", "Invitation created — copy the link and send it.");
      } else {
        toast("error", json.error || "Could not create the invitation.");
      }
    } catch {
      toast("error", "Could not reach the server.");
    } finally {
      setInviteBusy(false);
    }
  }

  async function revokeInvite(id: string) {
    setInviteBusy(true);
    const res = await fetch(`/api/invitations?id=${id}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    setInviteBusy(false);
    setConfirmRevoke(null);
    if (res.ok) {
      setInvitations((list) => list.filter((i) => i.id !== id));
      toast("success", "Invitation removed.");
    } else {
      toast("error", json.error || "Could not remove the invitation.");
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      const json = await res.json();
      if (res.ok) {
        await supabase.auth.signOut();
        toast("success", "Account deleted. Take care.");
        router.push("/login");
      } else {
        toast("error", json.error || "Could not delete the account.");
        setDeleting(false);
      }
    } catch {
      toast("error", "Could not reach the server.");
      setDeleting(false);
    }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    toast("success", "Copied.");
  }

  return (
    <AppShell title="Settings">
      <div className="space-y-6">
        {/* Profile */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>You &amp; how I explain things</CardTitle>
              {profile?.role === "owner" ? <Badge tone="accent">Owner</Badge> : <Badge>User</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveProfile} className="space-y-4">
              <p className="text-sm text-ink-soft">{email}</p>
              <div>
                <Label htmlFor="dn">Display name</Label>
                <Input id="dn" className="mt-1.5" value={form.display_name} onChange={(e) => set("display_name", e.target.value)} placeholder="How should I greet you?" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="al">Academic level</Label>
                  <Select id="al" className="mt-1.5" value={form.academic_level} onChange={(e) => set("academic_level", e.target.value)}>
                    <option value="">Choose one</option>
                    {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="el">Explanation style</Label>
                  <Select id="el" className="mt-1.5" value={form.explanation_level} onChange={(e) => set("explanation_level", e.target.value)}>
                    <option value="">Choose one</option>
                    {EXPLANATION.map((l) => <option key={l} value={l}>{l}</option>)}
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor="as">Answer style</Label>
                <Input id="as" className="mt-1.5" value={form.answer_style} onChange={(e) => set("answer_style", e.target.value)} placeholder="e.g. brief bullet points, or full paragraphs" />
              </div>
              <div>
                <Label htmlFor="fp">Formatting preference</Label>
                <Input id="fp" className="mt-1.5" value={form.formatting_pref} onChange={(e) => set("formatting_pref", e.target.value)} placeholder="e.g. headings + numbered steps" />
              </div>
              <div>
                <Label htmlFor="pl">Preferred language</Label>
                <Input id="pl" className="mt-1.5" value={form.preferred_language} onChange={(e) => set("preferred_language", e.target.value)} placeholder="Optional" />
              </div>
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </form>
          </CardContent>
        </Card>

        {/* Privacy */}
        <Card>
          <CardHeader><CardTitle>Privacy</CardTitle></CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-soft">
              <li>Your assignments, documents, writing samples, and profiles are stored privately and can only be read by your account (row-level security).</li>
              <li>Nobody else — not even the owner — can browse your academic work in the app.</li>
              <li>Sophira never uses your data to personalize someone else&apos;s AI.</li>
              <li>Uploaded files live in a private storage bucket only you can open.</li>
            </ul>
          </CardContent>
        </Card>

        {/* Install */}
        <Card>
          <CardHeader><CardTitle>Install on your phone</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-ink-soft">Add Sophira to your home screen so it opens like any app.</p>
            <Link href="/install" className="mt-3 inline-flex items-center gap-2">
              <Button variant="secondary"><Smartphone className="h-4 w-4" /> How to install</Button>
            </Link>
          </CardContent>
        </Card>

        {/* Invitations (owner) */}
        {profile?.role === "owner" && (
          <Card>
            <CardHeader><CardTitle>Invitations</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={createInvite} className="flex flex-col gap-2 sm:flex-row">
                <Input
                  type="email"
                  required
                  className="flex-1"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="friend@example.com"
                  aria-label="Invite email"
                />
                <Button type="submit" disabled={inviteBusy}>{inviteBusy ? "Creating…" : "Create invitation"}</Button>
              </form>
              {inviteLink && (
                <div className="flex items-center gap-2 rounded-lg bg-accent-soft p-3">
                  <code className="min-w-0 flex-1 truncate text-xs text-accent">{inviteLink}</code>
                  <Button size="sm" variant="secondary" onClick={() => copy(inviteLink)}>
                    <Copy className="h-4 w-4" /> Copy
                  </Button>
                </div>
              )}
              {invitations.length > 0 ? (
                <div className="divide-y divide-ink/5 rounded-lg border border-ink/10">
                  {invitations.map((i) => (
                    <div key={i.id} className="flex flex-wrap items-center gap-2 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{i.email}</p>
                        <p className="text-xs text-ink-soft">{fmtDate(i.created_at)}</p>
                      </div>
                      <Badge tone={i.status === "pending" ? "warn" : i.status === "accepted" ? "success" : "neutral"}>{i.status}</Badge>
                      <Button size="sm" variant="ghost" onClick={() => copy(`${window.location.origin}/signup?invite=${i.token}`)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      {i.status === "pending" && (
                        <Button size="sm" variant="ghost" className="text-danger" onClick={() => setConfirmRevoke(i.id)}>
                          Revoke
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-soft">No invitations yet. Sophira is invite-only — share a personal link with people you trust.</p>
              )}
              {inviteBusy && <Spinner />}
            </CardContent>
          </Card>
        )}

        {/* Danger zone */}
        <Card className="border-danger/30">
          <CardHeader><CardTitle className="text-danger">Danger zone</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-ink-soft">
              Deleting your account removes everything — permanently. There is no undo.
            </p>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete my account</Button>
          </CardContent>
        </Card>

        <ConfirmDialog
          open={confirmRevoke !== null}
          title="Remove this invitation?"
          message="The link will stop working. The person can be invited again later."
          confirmLabel="Remove"
          destructive
          onConfirm={() => confirmRevoke && revokeInvite(confirmRevoke)}
          onCancel={() => setConfirmRevoke(null)}
        />

        {/* Typed-delete panel (replaces a simple confirm: this action is permanent) */}
        {confirmDelete && (
          <Card className="border-danger/50">
            <CardHeader><CardTitle className="text-danger">Delete your account</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-ink-soft">
                This permanently deletes your account and ALL your data — assignments, courses, teachers,
                writing samples, everything. This cannot be undone.
              </p>
              <div>
                <Label htmlFor="delconfirm">Type DELETE to confirm</Label>
                <Input
                  id="delconfirm"
                  className="mt-1.5"
                  value={deleteText}
                  onChange={(e) => setDeleteText(e.target.value)}
                  placeholder="DELETE"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" disabled={deleteText.trim() !== "DELETE" || deleting} onClick={deleteAccount}>
                  {deleting ? "Deleting…" : "Delete everything"}
                </Button>
                <Button variant="secondary" onClick={() => { setConfirmDelete(false); setDeleteText(""); }}>
                  Cancel
                </Button>
              </div>
              {deleting && <Spinner />}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
