# SOPHIRA — Build Conventions (READ FIRST)

You are writing part of a Next.js 14 (App Router, TypeScript) application called **Sophira**, a private AI academic assistant. Another process is assembling the whole app; you own ONLY the files listed in your task. Never modify files outside your list, never run `npm install`, never run `next build`/`tsc`, never touch `package.json` or the database migrations.

Project root: `/app/conversations/6ab551847f5a9262295ae144/sophira`

## Stack (already scaffolded — do not change)
- Next.js 14.2 App Router + TypeScript (strict), Tailwind CSS 3.4, lucide-react icons.
- Supabase for auth/db/storage. RLS is enforced on EVERY table: rows are visible only to their owner (`user_id = auth.uid()`), so you never need to filter by other users, but always `.eq("user_id", user.id)` in queries for clarity.
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only), `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `SOPHIRA_MODEL`, `NEXT_PUBLIC_SITE_URL`.

## Data access
- Server components / route handlers: `import { createClient } from "@/lib/supabase/server"` → `const supabase = createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/login");`
- Client components: `import { createClient } from "@/lib/supabase/client"` → `const supabase = createClient();` (then `supabase.auth.getUser()`, `supabase.from(...)`).
- Admin (service-role, bypasses RLS): `import { createAdminClient } from "@/lib/supabase/admin"` — ONLY inside `/src/app/api/**` route handlers, never client code.

## Full DB schema
Read `supabase/migrations/0001_init.sql` and `supabase/migrations/0002_owner_only_invitations.sql` for exact tables/columns. TypeScript interfaces for every table are in `src/lib/types.ts` (import types from `@/lib/types`).

## SHARED MODULES (already built — import, never rewrite)
- `AppShell` from `@/components/app/AppShell` — props: `{ title: string; backHref?: string; actions?: ReactNode; children: ReactNode }`. Client component. Wrap EVERY authenticated page's content in it.
- `ResultBody` from `@/components/app/ResultBody` — props: `{ content: string }`. Renders AI markdown (server component, safe to use anywhere). Use for AI response text.
- `ProposalsPanel` from `@/components/app/ProposalsPanel` — props: `{ targetType?: "teacher"|"writing"; targetId?: string }`. Renders pending profile-update proposals with approve/reject. Put it on teacher detail pages (`targetType="teacher"`) and the writing page (`targetType="writing"`).
- `MODES` / `MODE_MAP` from `@/lib/modes` — the seven AI modes (learn, assignment, check, writing, study, explain, custom).

## Shared UI kit (import from `@/components/ui` or `@/components/ui/...`)
- `Button` props: `variant?: "primary"|"secondary"|"ghost"|"danger"`, `size?: "sm"|"md"|"lg"`, standard button props.
- `Card`, `CardHeader`, `CardTitle`, `CardContent` from `@/components/ui/Card`.
- `Input`, `Textarea`, `Select`, `Label` from `@/components/ui/Input`.
- `Badge` props: `tone?: "neutral"|"accent"|"success"|"warn"|"danger"`.
- `EmptyState` props: `{ icon?, title, description?, action?, className? }`.
- `Spinner` props: `{ className? }`.
- `ConfirmDialog` props: `{ open, title, message, confirmLabel?, destructive?, onConfirm, onCancel }`.
- `useToast()` from `@/components/ui/Toast` → `const { toast } = useToast(); toast("success"|"error"|"info", "text")`. Only usable inside `<ToastProvider>` (root layout already wraps everything).
- `fmtDate`, `fmtDateTime` from `@/lib/format`.
- `cn` from `@/lib/cn` for conditional class merging.

## Styling rules (calm academic aesthetic)
Tailwind custom tokens available: `bg-paper` (page background, already on body), `text-ink`, `text-ink-soft`, `bg-accent` / `text-accent` / `bg-accent-soft`, `text-success`, `text-warn`, `text-danger`, `rounded-card`. Prefer white cards (`Card`) on the paper background. Generous spacing, min 44px touch targets, never cause horizontal scroll. No new color hex values; use the tokens only.

## Next.js gotchas (these break `next build` — obey them)
- Any page that calls `useSearchParams()` MUST render that content inside `<Suspense>` (wrap the inner component, keep the default export a simple wrapper).
- Client components need `"use client"` at the top. Server components cannot use event handlers, hooks, or browser APIs.
- Dynamic route pages: `export default async function Page({ params }: { params: { id: string } })`.
- API route handlers in `src/app/api/**/route.ts` export named functions (`GET`, `POST`, ...). Always return `NextResponse.json(...)`.
- Plain `<img>` is fine for user content (no next/image config).

## API ROUTES (already built — call these, never rebuild them)
- `POST /api/extract` — multipart form field `file` (PDF/txt/image, ≤10MB). 200 → `{ data: { file_name, mime_type, storage_path, extracted_text, confidence: "high"|"medium"|"low", notes } }`. Errors: 413 too big, 415 unreadable/unsupported (the `error` message is ALREADY user-friendly and honest — display it verbatim).
- `POST /api/ai/solve` — body: `{ assignment_id?, session_id?, mode, question, title?, course_id?, teacher_id?, output_type?, custom_instructions?, files?: [{file_name, extracted_text}], images?: [dataUrl] }`. 200 → `{ data: { assignment_id, session_id, response_id, content, verification: {status, checks, warnings}, classification, model_used } }`. 503 = AI not configured (show the error, PRESERVE the user's input on screen). 502/500 = honest failure, preserve input.
- `POST /api/ai/analyze-writing` — body: `{ sample_ids?: string[] }`. 200 → `{ data: { proposal_id, guidance, summary, sample_count } }` (a PENDING proposal is created; the user approves it in ProposalsPanel). 400 when no usable samples.
- `POST /api/ai/extract-teacher-doc` — body: `{ teacher_id, kind: "official"|"rubric"|"example"|"correction", title, content }`. 200 → `{ data: { proposal_id, fields? } }` (PENDING proposal). `proposal_id: null` + `message` when nothing concrete was found.
- `GET/POST/DELETE /api/invitations` — owner only. POST `{ email }` → `{ data: { ..., link } }`.
- `POST /api/invitations/accept` — body `{ token }`, called right after invited signup.
- `POST /api/account/delete` — permanently deletes the signed-in account (all data cascades).

Client-side data changes (CRUD on courses, teachers, samples, assignments, feedback, study_materials, writing_profiles, teacher_profiles) go DIRECTLY through the supabase client SDK — RLS protects everything.

## Auth flows (auth module owns the pages, but other pages rely on these routes)
- `/login`, `/signup?invite=TOKEN`, `/reset-password`, `/auth/callback` (route handler).
- Signup is invite-only: call the RPC `get_invitation_by_token` with `{ p_token }` to show the invited email; after `supabase.auth.signUp`, POST `/api/invitations/accept` with the token. Without a token, show an honest "Sophira is invite-only" notice.
- `/install` is public (install guide). `/dashboard` etc. are private (middleware redirects).

## Honesty requirements (product-critical)
- Never fake AI output. If AI is not configured, show the 503 error text and PRESERVE the user's input.
- Never claim a verification test ran unless it did. Surface "Needs verification" statuses.
- Do not fabricate data, citations, or personal experiences anywhere. No fake content in empty states — use guidance text instead.
- Confirm before destructive actions (use ConfirmDialog).
- Never call `/api/ai/*` in a loop; one click = one request, and disable the button while pending.
