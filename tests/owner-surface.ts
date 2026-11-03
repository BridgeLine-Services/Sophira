import { readFileSync } from "fs";

/**
 * The owner UI is no longer one file (2026-11-03, phase 1).
 *
 * The dashboard is now an overview and each management workflow lives on its own route with its
 * own panel. Assertions that describe the owner experience as a whole read this surface, so a
 * requirement cannot be satisfied "somewhere" it is not actually rendered - the list below is
 * explicit about which files count.
 */
const OWNER_FILES = [
  "src/components/app/OwnerDashboard.tsx",
  "src/components/app/MembersPanel.tsx",
  "src/components/app/MemberDirectory.tsx",
  "src/components/app/InvitationsPanel.tsx",
  "src/components/app/RequestsPanel.tsx",
  "src/app/owner/members/page.tsx",
  "src/app/owner/invitations/page.tsx",
  "src/app/owner/requests/page.tsx",
  "src/app/owner/activity/page.tsx",
];

export function readOwnerUi(): string {
  return OWNER_FILES.map((f) => readFileSync(f, "utf8")).join("\n");
}

/** The invitation surface only: the form and its list. */
export function readInviteUi(): string {
  return ["src/components/app/InvitationsPanel.tsx", "src/app/owner/invitations/page.tsx"]
    .map((f) => readFileSync(f, "utf8")).join("\n");
}

/** The membership surface only: the directory and the member actions. */
export function readMemberUi(): string {
  return ["src/components/app/MembersPanel.tsx", "src/components/app/MemberDirectory.tsx"]
    .map((f) => readFileSync(f, "utf8")).join("\n");
}
