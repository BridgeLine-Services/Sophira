/**
 * THE WORDS FOR A MEMBERSHIP NOTICE (2026-11-13).
 *
 * A role change is the kind of thing a member must be able to understand without asking
 * anyone: what they can do now, and what they can no longer do. The wording lives here, as
 * pure data, so it can be tested and so three routes cannot describe the same change three
 * different ways.
 *
 * These sentences describe the change to the person it happened to. They deliberately carry
 * nothing administrative: no actor name, no internal identifiers, no audit detail.
 */

import { roleLabel, type Role } from "../roles";

export interface MembershipNote {
  title: string;
  body: string;
}

export function roleChangedNote(nextRole: Role): MembershipNote {
  const label = roleLabel(nextRole);
  switch (nextRole) {
    case "owner":
      return {
        title: `Your Sophira role is now ${label}`,
        body: "You now hold full authority over Sophira, including people, invitations, security, billing and settings.",
      };
    case "co_owner":
      return {
        title: `Your Sophira role is now ${label}`,
        body: "You can now manage members, invite people and decide invitation requests. Security, billing and Owner settings stay with the Owner, and you still cannot open anyone's academic work.",
      };
    case "tester":
      return {
        title: `Your Sophira role is now ${label}`,
        body: "You can now use Sophira's testing features and the feedback channel. You still cannot see other members, roles or settings.",
      };
    default:
      return {
        title: `Your Sophira role is now ${label}`,
        body: "Administrative access is no longer part of your account. Your courses, assignments, notebooks and notes are unchanged.",
      };
  }
}

/** Told after access is given back, so the member knows why they can sign in again. */
export const ACCOUNT_RESTORED_NOTE: MembershipNote = {
  title: "Your Sophira access was restored",
  body: "You can sign in again and everything in your workspace is where you left it.",
};

/** Told to the person who sent an invitation, once registration genuinely succeeded. */
export function invitationAcceptedNote(email: string): MembershipNote {
  return {
    title: "The invitation you sent was accepted",
    body: `${email} has joined Sophira and can now sign in with that address.`,
  };
}

/**
 * Told to a requester once their approved invitation has actually been sent (2026-11-13).
 *
 * Two different situations, two different sentences: "we emailed them" is only said when the
 * provider accepted it, and a failed send tells the staff requester the truthful next step
 * instead of implying the person has been contacted.
 */
export function invitationRequestApprovedNote(email: string, emailStatus: string): MembershipNote {
  const sent = emailStatus === "sent";
  return {
    title: "Your invitation request was approved",
    body: sent
      ? `An invitation for ${email} has been emailed to them. The same link is on the Invitations page and works only for that email address.`
      : `An invitation for ${email} has been created, but Sophira could not email it. The link is on the Invitations page — please send it to them yourself.`,
  };
}
