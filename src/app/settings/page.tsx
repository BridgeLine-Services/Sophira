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
import type { InvitationRequest, Profile } from "@/lib/types";
import { ShieldCheck, Smartphone, Download } from "lucide-react";

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

  // Invitation requests (non-owner members with permission)
  const [requests, setRequests] = useState<InvitationRequest[]>([]);
  const [reqEmail, setReqEmail] = useState("");
  const [reqReason, setReqReason] = useState("");
  const [reqBusy, setReqBusy] = useState(false);

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
      if ((p as Profile)?.can_request_invites) {
        fetch("/api/invitation-requests")
          .then((r) => (r.ok ? r.json() : { data: [] }))
          .then((j) => setRequests(j.data ?? []))
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

  async function submitRequest(e: FormEvent) {
    e.preventDefault();
    if (!reqEmail.trim()) return;
    setReqBusy(true);
    try {
      const res = await fetch("/api/invitation-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: reqEmail.trim(), reason: reqReason.trim() }),
      });
      const json = await res.json();
      if (res.ok) {
        setRequests((list) => [json.data, ...list]);
        setReqEmail("");
        setReqReason("");
        toast("success", "Request sent — the owner will review it.");
      } else {
        toast("error", json.error || "Could not send the request.");
      }
    } catch {
      toast("error", "Could not reach the server.");
    } finally {
      setReqBusy(false);
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
            <Link href="/downloads" className="mt-3 inline-flex items-center gap-2">
              <Button variant="secondary"><Download className="h-4 w-4" /> Downloads</Button>
            </Link>
          </CardContent>
        </Card>

        {/* Owner: membership lives in the Owner Dashboard */}
        {profile?.role === "owner" && (
          <Card>
            <CardHeader><CardTitle>Members &amp; invitations</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-ink-soft">
                Inviting people, approving or rejecting invitation requests, revoking access, and
                membership activity now live in one place.
              </p>
              <Link href="/owner" className="mt-3 inline-flex">
                <Button><ShieldCheck className="h-4 w-4" /> Open Owner Dashboard</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Member with permission: request an invitation (owner decides) */}
        {profile?.role === "user" && profile.can_request_invites && (
          <Card>
            <CardHeader><CardTitle>Request an invitation for someone</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-relaxed text-ink-soft">
                You can propose someone for this network. This only sends a request — the owner
                approves it before any invitation link exists.
              </p>
              <form onSubmit={submitRequest} className="space-y-3">
                <div>
                  <Label htmlFor="req-email">Their email</Label>
                  <Input
                    id="req-email"
                    type="email"
                    required
                    className="mt-1.5"
                    value={reqEmail}
                    onChange={(e) => setReqEmail(e.target.value)}
                    placeholder="friend@example.com"
                  />
                </div>
                <div>
                  <Label htmlFor="req-reason">Why should they join? (optional)</Label>
                  <Input
                    id="req-reason"
                    className="mt-1.5"
                    value={reqReason}
                    onChange={(e) => setReqReason(e.target.value)}
                    placeholder="Study partner, classmate, sibling…"
                  />
                </div>
                <Button type="submit" disabled={reqBusy}>{reqBusy ? "Sending…" : "Send request"}</Button>
              </form>
              {requests.length > 0 && (
                <div className="divide-y divide-ink/5 rounded-lg border border-ink/10">
                  {requests.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center gap-2 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{r.email}</p>
                        <p className="text-xs text-ink-soft">{fmtDate(r.created_at)}</p>
                      </div>
                      <Badge tone={r.status === "approved" ? "success" : r.status === "rejected" ? "neutral" : "warn"}>{r.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
              {reqBusy && <Spinner />}
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
