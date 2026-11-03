/**
 * MEMBER IDENTITY DISPLAY (2026-11-03).
 *
 * The owner could not tell who a member was: rows read "(no name)" whenever
 * profiles.display_name was empty, which happens for accounts created before the
 * signup form captured a name. The email was known the whole time and simply was
 * not shown as the identifier.
 *
 * Rules, in order: the name the person chose, else their email, else an honest
 * placeholder. Sophira never invents a name from an email address — "jsmith" is not
 * a person's name, and showing it as one would put words in their mouth.
 *
 * The identity is for display only. Comparisons elsewhere use profiles.id, never
 * this string (see scripts/member-preservation.mjs).
 */

export interface MemberIdentityInput {
  display_name?: string | null;
  email?: string | null;
  user_id?: string | null;
}

export interface MemberIdentity {
  /** What the owner reads first. Never empty. */
  title: string;
  /** Supporting line: the email, or an honest statement of what is missing. */
  subtitle: string;
  /** 1-2 characters for the avatar. */
  initials: string;
  /** True when the member has not supplied a name. Not an error: display only. */
  nameMissing: boolean;
  /** True when no name AND no email exist. Still a valid member. */
  identityIncomplete: boolean;
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function initialsFrom(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function memberIdentity(member: MemberIdentityInput): MemberIdentity {
  const name = clean(member.display_name);
  const email = clean(member.email);

  if (name) {
    return {
      title: name,
      subtitle: email || "No email on file",
      initials: initialsFrom(name),
      nameMissing: false,
      identityIncomplete: !email,
    };
  }

  if (email) {
    // The email IS the identity here: it is shown, not converted into a fake name.
    return {
      title: email,
      subtitle: "Name not set — this member has not added one yet",
      initials: email.slice(0, 1).toUpperCase(),
      nameMissing: true,
      identityIncomplete: false,
    };
  }

  return {
    title: "Unnamed member",
    subtitle: "No name or email on file. This account is still a valid member.",
    initials: "?",
    nameMissing: true,
    identityIncomplete: true,
  };
}
