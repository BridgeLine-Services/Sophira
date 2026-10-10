import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { LanguageSelector } from "@/components/courses/LanguageSelector";

export const dynamic = "force-dynamic";

export default async function LanguageSelectorPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data } = await supabase
    .from("subject_preferences")
    .select("target_language, explanation_language, proficiency")
    .eq("user_id", user.id)
    .eq("subject", "foreign-language")
    .maybeSingle();

  return (
    <AppShell title="Language Selector" backHref="/courses/foreign-language">
      <div className="space-y-6">
        <p className="max-w-2xl text-ink-soft">
          Your target language, explanation language, and proficiency apply to the
          Foreign Language tools. Not every language shares the same grammar, writing
          system, or learning workflow — tools use your selection, and nothing is
          invented for languages that are not selected.
        </p>
        <Card>
          <CardHeader>
            <CardTitle>Your language setup</CardTitle>
          </CardHeader>
          <CardContent>
            <LanguageSelector initial={data ?? null} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
