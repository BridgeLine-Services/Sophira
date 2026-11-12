# Empty-state audit (2026-11-12)

`scripts/page-conformance.mjs` reports **36 routes without an empty state**. That number is a
source-level heuristic, not a defect count: it looks for the shared `EmptyState` component or
copy matching a short pattern, and it cannot follow a page into the shared component it renders.
This audit is the manual follow-up, so the number is not mistaken for 36 broken screens.

Verdicts below come from reading each page. A page is a **genuine gap** only when a brand-new
account would see an unexplained blank region with no way forward.

| Route | What the page does | Verdict |
|---|---|---|
| `/tutor` | Explanatory paragraph, question box, answer thread. Thread hidden when empty. | Not a gap: the input is the call to action and the copy explains the screen. |
| `/teachers/[id]` | Courses sit inside a `courses.length > 0` guard; proposals panel below. | Not a gap: nothing to list on a teacher with no courses. |
| `/owner/activity` | Builds a name lookup from the roster; activity comes from a shared component. | Not a gap: `.map` builds data, not markup. |
| `/owner/status` | Diagnostic rows are computed and always present. | Not a gap. |
| `/owner/ai-providers` | Same diagnostic table shape. | Not a gap. |
| `/math` | The `.map` renders three static mode tabs. | Not a gap. |
| `/writing/new` | The `.map`s fill `<option>` lists in a form. | Not a gap. |
| `/notifications` | Already renders a first-class empty branch plus an announcements block. | Already handled; heuristic miss. |
| `/downloads` | Already branches on `appAssets.length === 0`. | Already handled; heuristic miss. |
| `/learning` | Already branches on `(changeHistory ?? []).length === 0`. | Already handled; heuristic miss. |
| `/offline`, `/setup`, `/onboarding` | Static platform and step lists, never empty. | Not applicable. |
| `/install`, `/local`, `/online`, `/access-denied`, `/create-owner`, `/license` | Pages whose body is fixed copy or a single action. | Not applicable. |
| `/courses/english` and the nine subject routes | Thin wrappers; the empty case lives inside `SubjectWorkspace`. | Already handled there; heuristic miss. |
| `/owner/members` | Filterable roster. `MemberDirectory` already prints "No member matches these filters. Clear a filter to see everyone again." | Already handled in the child component; heuristic miss. |
| `/owner/invitations` | `InvitationsPanel` holds two `EmptyState` branches. | Already handled; heuristic miss. |
| `/owner/qa` | `QaTriage` guards its queue (nothing waiting is the healthy case). | Not a gap. |
| `/owner/health` | `SystemHealthPanel` guards its rows. | Not a gap. |
| `/owner/analytics`, `/owner/ai-operations`, `/owner/features`, `/owner/database`, `/owner/integrations` | Fixed diagnostic and settings content; no user-data list to be empty. | Not applicable. |

**Conclusion, after reading all 36 flagged routes:** none of them shows a brand-new account an
unexplained blank region. Every list either owns an empty branch, owns explanatory copy plus a
call to action, or is fixed content that cannot be empty. The application does not have 36 broken
screens; it has a metric that cannot see through a component boundary. No empty state was invented
to make the number go down.
