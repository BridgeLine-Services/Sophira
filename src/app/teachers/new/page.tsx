"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { Button, Input, Label, Textarea, useToast } from "@/components/ui";

export default function NewTeacherPage() {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast("error", "Please give the teacher a name.");
      return;
    }
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("teachers")
      .insert({ user_id: user!.id, name: name.trim(), notes: notes.trim() })
      .select("id")
      .single();
    if (error) {
      setBusy(false);
      toast("error", "Could not save the teacher: " + error.message);
      return;
    }
    // Best effort: create the (usually trigger-created) profile row too.
    await supabase.from("teacher_profiles").insert({ user_id: user!.id, teacher_id: data.id });
    setBusy(false);
    toast("success", "Teacher added. Now add their requirements.");
    router.push(`/teachers/${data.id}`);
  }

  return (
    <AppShell title="New teacher" backHref="/teachers">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="name">Teacher&apos;s name *</Label>
          <Input id="name" required className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mrs. Okafor" />
        </div>
        <div>
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" className="mt-1.5 min-h-24" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything that helps identify this teacher's style" />
        </div>
        <Button type="submit" disabled={busy} className="w-full" size="lg">
          {busy ? "Saving…" : "Add teacher"}
        </Button>
      </form>
    </AppShell>
  );
}
