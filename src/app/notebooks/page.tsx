"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Spinner, useToast } from "@/components/ui";
import { NotebookPen, Plus } from "lucide-react";

/**
 * Notebooks home (2026-10-06): a private, source-grounded research
 * notebook per topic. Owner-only (RLS server-side).
 */

interface NotebookRow {
  id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export default function NotebooksPage() {
  const { toast } = useToast();
  const say = (text: string) => toast("info", text);
  const [rows, setRows] = useState<NotebookRow[] | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notebooks");
      if (res.ok) {
        const data = await res.json();
        setRows(data.notebooks ?? []);
      } else {
        setRows([]);
      }
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (title.trim().length < 2) {
      say("Give the notebook a title.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/notebooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description }),
      });
      const data = await res.json();
      if (!res.ok) {
        say(data.error ?? "Could not create the notebook.");
      } else {
        setTitle("");
        setDescription("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="Notebooks">
      <div className="mx-auto max-w-3xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <NotebookPen className="h-4 w-4" /> New research notebook
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-ink/60">
              A private, academic, source-grounded workspace: sources, notes, questions, evidence, research, study
              materials, and artifacts. Chat is grounded ONLY in the sources you add — every answer is labeled
              SOURCE-SUPPORTED, INFERENCE, or NOT VERIFIED, with citations that open the exact source location.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-ink/70">Title</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 1920s economy essay research" />
              </div>
              <div>
                <label className="text-xs font-medium text-ink/70">Description (optional)</label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this notebook for?" />
              </div>
            </div>
            <Button onClick={create} disabled={busy}>
              {busy ? <Spinner /> : <Plus className="mr-1 h-4 w-4" />} Create notebook
            </Button>
          </CardContent>
        </Card>

        {rows === null ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : rows.length === 0 ? (
          <EmptyState title="No notebooks yet" description="Create one above — it stays private to your account." />
        ) : (
          <div className="grid gap-3">
            {rows.map((n) => (
              <Link key={n.id} href={`/notebooks/${n.id}`} className="block">
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="py-4">
                    <p className="font-medium">{n.title}</p>
                    <p className="text-sm text-ink/60">{n.description || "No description."}</p>
                    <p className="mt-1 text-xs text-ink/40">updated {new Date(n.updated_at).toLocaleString()}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
