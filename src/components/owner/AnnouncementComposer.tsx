"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, Card, CardContent, EmptyState, Input, Textarea } from "@/components/ui";
import { Megaphone } from "lucide-react";

type Row = {
  id: string;
  title: string;
  body: string;
  status: "draft" | "published";
  published_at: string | null;
  created_at: string;
};

/** Staff-only authoring surface. RLS enforces the same rule server-side. */
export function AnnouncementComposer({ rows, authorId }: { rows: Row[]; authorId: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(publish: boolean) {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("announcements").insert({
      author_id: authorId,
      title: title.trim(),
      body: body.trim(),
      status: publish ? "published" : "draft",
      published_at: publish ? new Date().toISOString() : null,
    });
    setBusy(false);
    if (err) {
      setError("That announcement could not be saved just now. Nothing was published.");
      return;
    }
    setTitle("");
    setBody("");
    router.refresh();
  }

  async function setStatus(id: string, publish: boolean) {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("announcements")
      .update({ status: publish ? "published" : "draft", published_at: publish ? new Date().toISOString() : null })
      .eq("id", id);
    setBusy(false);
    if (err) setError("That change could not be saved just now.");
    else router.refresh();
  }

  return (
    <div className="space-y-4">
      <Card><CardContent className="space-y-3 p-4">
        <p className="meta-strong">New announcement</p>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What is this about?" aria-label="Announcement title" />
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="The message itself. Plain and short is best." aria-label="Announcement body" />
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => create(true)} disabled={busy || !title.trim()}>Publish to everyone</Button>
          <Button variant="secondary" onClick={() => create(false)} disabled={busy || !title.trim()}>Save as draft</Button>
        </div>
      </CardContent></Card>

      <section aria-labelledby="ann-list-h">
        <h2 id="ann-list-h" className="mb-3 meta-strong">All announcements</h2>
        {rows.length === 0 ? (
          <EmptyState icon={<Megaphone className="h-5 w-5" aria-hidden />} title="Nothing announced yet" description="When you publish an update it appears here and in every member's notifications." />
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <Card key={r.id}><CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-ink">{r.title}</p>
                  <Badge tone={r.status === "published" ? "success" : "neutral"}>{r.status === "published" ? "Published" : "Draft"}</Badge>
                  {r.published_at && <span className="text-xs text-ink-soft">{new Date(r.published_at).toLocaleDateString()}</span>}
                </div>
                {r.body && <p className="whitespace-pre-line text-sm text-ink-soft">{r.body}</p>}
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setStatus(r.id, r.status !== "published")}>
                  {r.status === "published" ? "Retract (back to draft)" : "Publish"}
                </Button>
              </CardContent></Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
