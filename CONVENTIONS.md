# SOPHIRA — Build Conventions (READ FIRST)

You are writing part of a Next.js 14 (App Router, TypeScript) application called **Sophira**, a private AI academic assistant. Another process is assembling the whole app; you own ONLY the files listed in your task. Never modify files outside your list, never run `npm install`, never touch `package.json` or the database migration.

Project root: `/app/conversations/6ab54c877f5a9262295a48a8/sophira`

## Stack (already scaffolded — do not change)
- Next.js 14.2 App Router + TypeScript (strict), Tailwind CSS 3.4, lucide-react icons.
- Supabase for auth/db/storage. RLS is enforced on EVERY table: rows are visible only to their owner (`user_id = auth.uid()`), so you never need to filter by other users, but always `.eq("user_id", user.id)` in queries for clarity.
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only), `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `SOPHIRA_MODEL`, `NEXT_PUBLIC_SITE_URL`.

## Data access
- Server components / route handlers: `import { createClient } from "@/lib/supabase/server"` → `const supabase = createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/login");`
- Client components: `import { createClient } from "@/lib/supabase/client"` → `const supabase = createClient();` (then `supabase.auth.getUser()`, `supabase.from(...)`).
- Admin (service-role, bypasses RLS): `import { createAdminClient } from "@/lib/supabase/admin"` — ONLY inside `/src/app/api/**` route handlers, never client code.

## Full DB schema
Read `/app/conversations/6ab54c877f5a9262295a48a8/sophira/supabase/migrations/0001_init.sql` for exact tables/columns. TypeScript interfaces for every table are in `src/lib/types.ts` (import types from `@/lib/types`).

## Shared UI kit (import from `@/components/ui/...`)
- `Button` props: `variant?: "primary"|"secondary"|"ghost"|"danger"`, `size?: "sm"|"md"|"lg"`, standard button props.
- `Card`, `CardHeader`, `CardTitle`, `CardContent` from `@/components/ui/Card`.
- `Input`, `Textarea`, `Select`, `Label` from `@/components/ui/Input`.
- `Badge` props: `tone?: "neutral"|"accent"|"success"|"warn"|"danger"`.
- `EmptyState` props: `{ icon?, title, description?, action?, className? }`.
- `Spinner` props: `{ className? }`.
- `ConfirmDialog` props: `{ open, title, message, confirmLabel?, destructive?, onConfirm, onCancel }`.
- `useToast()` from `@/components/ui/Toast` → `const { toast } = useToast(); toast("success"|"error"|"info", "text")`. Only usable inside `<ToastProvider>` (root layout already wraps everything).
- `MODES` / `MODE_MAP` from `@/lib/modes` — the seven AI modes (learn, assignment, check, writing, study, explain, custom).
- `fmtDate`, `fmtDateTime` from `@/lib/format`.
- `cn` from `@/lib/cn` for conditional class merging.

## Styling rules (calm academic aesthetic)
Tailwind custom tokens available: `bg-paper` (page background, already on body), `text-ink`, `text-ink-soft`, `bg-accent` / `text-accent` / `bg-accent-soft`, `text-success`, `text-warn`, `text-danger`, `rounded-card`. Prefer white cards (`Card`) on the paper background. Generous spacing, min 44px touch targets, never cause horizontal scroll. No new color hex values; use the tokens only.

## Next.js gotchas (these break `next build` — obey them)
- Any page that calls `useSearchParams()` MUST render that content inside `<Suspense>` (wrap the inner component, keep the default export a simple wrapper).
- Client components need `"use client"` at the top. Server components cannot use event handlers, hooks, or browser APIs.
- Dynamic route pages: `export default async function Page({ params }: { params: { id: string } })`.
- API route handlers in `src/app/api/**/route.ts` export named functions (`GET`, `POST`, ...). Always return `NextResponse.json(...)`.
- Do not use `next/image` config features beyond defaults; plain `<img>` is fine for user content.

## API route conventions
- Every route handler first authenticates: `const supabase = createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });`
- Error shape: `{ "error": "human readable message" }` with proper status. Success: `{ "data": ... }` or the resource directly.
- Validate inputs (missing/malformed → 400 with a clear message). Never trust client-supplied `user_id`: always take the id from the session and scope reads/writes with RLS.

## Honesty requirements (product-critical)
- Never fake AI output. If `OPENAI_API_KEY` is unset, AI routes return 503 with `{ error: "AI is not configured..." }` and the UI shows a clear, friendly explanation, PRESERVING the user's input.
- Never claim a verification test ran unless it did. Uncertain results must surface a "Needs verification" status.
- Do not fabricate data, citations, or personal experiences anywhere.
