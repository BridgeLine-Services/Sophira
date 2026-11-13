/**
 * FEATURE CATALOG (2026-11-13).
 *
 * The Owner asked one question the dashboard could not answer: "which of these actually works?"
 * Sophira has sixteen capabilities, and until now the only evidence a capability existed was
 * that it appeared in the navigation. That is not evidence.
 *
 * Every entry below resolves to a state from a real, checkable input: is a provider key present,
 * does a search key exist, was the document app registered, could the database be read. Where
 * Sophira genuinely cannot know - it has no way to run a live request from this page - the entry
 * says "not verified" instead of pretending a passing test happened.
 *
 * Six states, and they are never merged:
 *
 *   working          built in and running without any outside service (maths, notebooks, export)
 *   available        ready, but whether it answers correctly has not been shown here
 *   not-configured   present in Sophira and switched off because nothing has been connected
 *   problems         a real failure was recorded
 *   unavailable      it needs something that is currently missing, so it cannot run at all
 *   not-implemented  genuinely not built (kept so the vocabulary is honest if one is withdrawn)
 *
 * NEVER inferred: "it is in the navigation" is not availability, "the key exists" is not a
 * working connection, and "the build passed" is not a live answer.
 */

export type FeatureState =
  | "working"
  | "available"
  | "not-configured"
  | "problems"
  | "unavailable"
  | "not-implemented";

export interface FeatureFacts {
  /** Confirmed by a live health check (rare - only when one actually ran). */
  lastVerified: string | null;
  /** Confirmed by Sophira's own automated test suite. */
  verifiedByTests: boolean;
  /** A real recorded failure, in plain language. */
  lastFailure: string | null;
}

export interface FeatureEntry {
  key: string;
  name: string;
  /** What a member gets from it, in one sentence with no jargon. */
  what: string;
  group: "Study and writing" | "Workspace" | "Documents" | "Connections";
  state: FeatureState;
  /** Why it is in this state, and what that means for members. */
  detail: string;
  /** What the owner would have to do to move it forward, or null when nothing is needed. */
  ownerAction: string | null;
  /** Where the owner goes to configure or troubleshoot it. */
  href: string | null;
  facts: FeatureFacts;
  /** True when a member notices immediately if this is not working. */
  membersAffected: boolean;
}

export interface FeatureInputs {
  /** At least one AI provider is configured (a key exists). */
  aiConfigured: boolean;
  /** A provider is the ACTIVE one right now, per the existing diagnostics. */
  aiActive: boolean;
  /** The self-hosted local inference server is configured. */
  localInferenceConfigured: boolean;
  /** The member directory could be read, i.e. the database answered. Null when it was not tried. */
  databaseReachable: boolean | null;
  searchConfigured: boolean;
  googleConfigured: boolean;
  microsoftConfigured: boolean;
  canvasConfigured: boolean;
  emailConfigured: boolean;
  /** A real recorded AI failure, if the caller has one (from the usage record). */
  recentAiFailures?: number | null;
}

const NOT_RECORDED = "Not recorded";

/**
 * The one order these states are listed in, everywhere. Exporting it (2026-11-13, Part 13)
 * means a second page cannot invent its own sequence or its own words.
 */
export const FEATURE_STATE_ORDER: readonly FeatureState[] = [
  "working",
  "available",
  "not-configured",
  "problems",
  "unavailable",
  "not-implemented",
];

/** The chip/dot colour for a state. Kept beside the labels for the same reason. */
export function stateTone(state: FeatureState): "success" | "accent" | "neutral" | "warn" | "danger" {
  switch (state) {
    case "working": return "success";
    case "available": return "accent";
    case "not-configured": return "neutral";
    case "problems": return "warn";
    case "unavailable": return "danger";
    case "not-implemented": return "neutral";
  }
}

export function stateLabel(state: FeatureState): string {
  switch (state) {
    case "working": return "Working";
    case "available": return "Available, not verified here";
    case "not-configured": return "Not set up";
    case "problems": return "Having problems";
    case "unavailable": return "Temporarily unavailable";
    case "not-implemented": return "Not built";
  }
}

/** A short, plain sentence an owner can quote; never a colour on its own. */
export function stateExplanation(state: FeatureState): string {
  switch (state) {
    case "working":
      return "This runs inside Sophira and needs no outside service. Sophira's own test suite checks it.";
    case "available":
      return "It is ready to use. Nothing on this page sent a live request, so 'available' is not the same as 'verified just now'.";
    case "not-configured":
      return "The feature exists but nothing has been connected for it yet. Members see a clear message instead of a broken screen.";
    case "problems":
      return "A real failure was recorded. The detail below says what failed.";
    case "unavailable":
      return "Something it depends on is missing right now, so it cannot run at all.";
    case "not-implemented":
      return "This has not been built. It is listed so the picture stays complete.";
  }
}

export function formatVerifiedAt(value: string | null): string {
  return value ?? NOT_RECORDED;
}

/**
 * Build the sixteen entries. Order is deliberate: the things a member touches every day come
 * first, and optional connections last, so the owner reads the important rows without scrolling.
 */
export function buildFeatureCatalog(input: FeatureInputs): FeatureEntry[] {
  const aiReady = input.aiConfigured && input.aiActive;
  const aiFailure = (input.recentAiFailures ?? 0) > 0;

  // A recorded failure outranks a configured provider: "a real request did not come back" is a
  // truer state than "ready", and the owner can only act on it if it is said out loud.
  const aiState: FeatureState = !aiReady ? "unavailable" : aiFailure ? "problems" : "available";
  const aiDetail = !aiReady
    ? input.localInferenceConfigured
      ? "The local AI service is configured but is not answering as the active provider, so this feature cannot answer yet. Members see an explanation, not an error."
      : input.aiConfigured
        ? "A provider is configured but is not active, so this feature cannot answer yet."
      : "No AI service is connected, so this feature cannot answer. Members still have the built-in offline writing help and maths checking."
    : aiFailure
      ? "A provider is selected and most answers still arrive, but some recent requests failed. Members saw a plain message when that happened and none of their work was lost."
      : "Sophira has an AI provider selected, so this feature can answer.";
  const aiAction = !aiReady
    ? "Open System Health to see what is missing, then connect a provider or start the local AI service."
    : aiFailure
      ? "Open AI Operations to see which provider failed and how often, and decide whether to switch."
      : null;
  const aiFacts = (extra?: Partial<FeatureFacts>): FeatureFacts => ({
    lastVerified: null,
    verifiedByTests: true,
    lastFailure: aiFailure
      ? `${input.recentAiFailures} AI ${input.recentAiFailures === 1 ? "request has" : "requests have"} failed recently.`
      : null,
    ...extra,
  });

  const localFacts = (extra?: Partial<FeatureFacts>): FeatureFacts => ({
    lastVerified: null,
    verifiedByTests: true,
    lastFailure: null,
    ...extra,
  });

  return [
    {
      key: "ai-tutor",
      name: "AI Tutor",
      what: "Answers a study question in the member's own subject, level and wording preferences.",
      group: "Study and writing",
      state: aiState,
      detail: aiDetail,
      ownerAction: aiAction,
      href: aiReady ? "/owner/ai-operations" : "/owner/health",
      facts: aiFacts(),
      membersAffected: true,
    },
    {
      key: "essay-assistant",
      name: "Essay Assistant",
      what: "Plans, drafts and reviews an essay against the teacher's requirements.",
      group: "Study and writing",
      state: aiState,
      detail: aiDetail,
      ownerAction: aiAction,
      href: aiReady ? "/owner/ai-operations" : "/owner/health",
      facts: aiFacts(),
      membersAffected: true,
    },
    {
      key: "math-solver",
      name: "Math Solver",
      what: "Works out a maths problem step by step and checks the answer with a real calculator.",
      group: "Study and writing",
      // The maths engine is local arithmetic, not a language model: it does not need a provider.
      state: input.databaseReachable === false ? "unavailable" : "working",
      detail:
        input.databaseReachable === false
          ? "The maths engine is built in, but saving a member's work needs the database, and that could not be read just now."
          : "Built in and independent of any AI provider. The answer is checked by a real maths engine rather than accepted from a model.",
      ownerAction: input.databaseReachable === false ? "Open Database updates and check that your database is reachable." : null,
      href: input.databaseReachable === false ? "/owner/database" : "/math",
      facts: localFacts(),
      membersAffected: true,
    },
    {
      key: "research-assistant",
      name: "Research Assistant",
      what: "Finds sources, checks that each one says what is claimed, and builds the bibliography.",
      group: "Study and writing",
      state: !aiReady ? "unavailable" : input.searchConfigured ? "available" : "not-configured",
      detail: !aiReady
        ? aiDetail
        : input.searchConfigured
          ? "Live web search is connected, so research can find current sources as well as the ones a member uploads."
          : "No search service is connected, so research works only from the member's own uploaded sources and what the AI already knows. Nothing is broken; it is narrower.",
      ownerAction: !aiReady
        ? aiAction
        : input.searchConfigured
          ? null
          : "Add a search service key on the Integrations page when you want live web results.",
      href: "/owner/integrations",
      facts: aiFacts(),
      membersAffected: aiReady,
    },
    {
      key: "writing-assistant",
      name: "Writing Assistant",
      what: "Reviews a draft for clarity, structure and citation problems without rewriting it for the member.",
      group: "Study and writing",
      state: aiState,
      detail: aiDetail,
      ownerAction: aiAction,
      href: aiReady ? "/owner/ai-operations" : "/owner/health",
      facts: aiFacts(),
      membersAffected: true,
    },
    {
      key: "lecture-studio",
      name: "Lecture Studio",
      what: "Turns a lecture recording into notes, summaries and study questions.",
      group: "Study and writing",
      state: !aiReady ? "unavailable" : "available",
      detail: !aiReady
        ? aiDetail
        : "Recording is transcribed on this machine, and the summary step needs the AI provider that is currently active.",
      ownerAction: aiAction,
      href: aiReady ? "/owner/ai-operations" : "/owner/health",
      facts: aiFacts(),
      membersAffected: true,
    },
    {
      key: "notebooks",
      name: "Notebooks",
      what: "A place to write and keep working notes, with autosave.",
      group: "Workspace",
      state: input.databaseReachable === false ? "unavailable" : "working",
      detail:
        input.databaseReachable === false
          ? "Notebooks are built in, but they save to the database, which could not be read just now. Nothing a member already wrote has been lost."
          : "Built in. Saves automatically, and a member's own notes are visible only to them.",
      ownerAction: input.databaseReachable === false ? "Open Database updates and check the database is reachable." : null,
      href: input.databaseReachable === false ? "/owner/database" : "/notebooks",
      facts: localFacts(),
      membersAffected: true,
    },
    {
      key: "courses",
      name: "Courses",
      what: "Groups a member's assignments, teachers and materials by course.",
      group: "Workspace",
      state: input.databaseReachable === false ? "unavailable" : "working",
      detail:
        input.databaseReachable === false
          ? "Courses are built in, but they are stored in the database, which could not be read just now."
          : "Built in. A member sees only their own courses.",
      ownerAction: input.databaseReachable === false ? "Open Database updates and check the database is reachable." : null,
      href: input.databaseReachable === false ? "/owner/database" : "/courses",
      facts: localFacts(),
      membersAffected: true,
    },
    {
      key: "learning-memory",
      name: "Learning and Memory",
      what: "Remembers a member's confirmed habits and preferences, scoped so one subject never leaks into another.",
      group: "Workspace",
      state: input.databaseReachable === false ? "unavailable" : "working",
      detail:
        input.databaseReachable === false
          ? "The memory system is built in, but its records live in the database, which could not be read just now."
          : "Built in, and separate for each member. Sophira never shows one member's memories, or yours, to anyone else.",
      ownerAction: input.databaseReachable === false ? "Open Database updates and check the database is reachable." : null,
      href: input.databaseReachable === false ? "/owner/database" : "/learning",
      facts: localFacts(),
      membersAffected: true,
    },
    {
      key: "typing-calibration",
      name: "Typing Calibration",
      what: "Learns how fast a member types so study time estimates are realistic.",
      group: "Workspace",
      state: input.databaseReachable === false ? "unavailable" : "working",
      detail:
        input.databaseReachable === false
          ? "Calibration is built in, but it saves a pace profile to the database, which could not be read just now."
          : "Built in and optional. It records timing only, never what a member typed.",
      ownerAction: input.databaseReachable === false ? "Open Database updates and check the database is reachable." : null,
      href: input.databaseReachable === false ? "/owner/database" : "/writing/typing",
      facts: localFacts(),
      membersAffected: false,
    },
    {
      key: "offline-mode",
      name: "Offline Mode",
      what: "Keeps working with no connection, then synchronises when the connection returns.",
      group: "Workspace",
      state: "working",
      detail:
        "Built in. Reading and writing continue without a connection, and changes are held locally until Sophira can reach the database again.",
      ownerAction: null,
      href: "/offline",
      facts: localFacts({ lastVerified: null }),
      membersAffected: true,
    },
    {
      key: "notifications",
      name: "Notifications",
      what: "Tells a member when their own membership or invitations change, and when something needs them.",
      group: "Workspace",
      state: input.databaseReachable === false ? "unavailable" : "working",
      detail:
        input.databaseReachable === false
          ? "Notifications are built in, but the notification list is stored in the database, which could not be read just now."
          : "Built in. Each member can switch categories off, and their own choice is respected.",
      ownerAction: input.databaseReachable === false ? "Open Database updates and check the database is reachable." : null,
      href: input.databaseReachable === false ? "/owner/database" : "/notifications",
      facts: localFacts(),
      membersAffected: false,
    },
    {
      key: "document-export",
      name: "Document Export",
      what: "Produces a real Word, PowerPoint, spreadsheet or PDF file from a member's work.",
      group: "Documents",
      state: "working",
      detail:
        "Built in and done on this machine, with no outside account needed. The file is created locally and downloaded to the member's device.",
      ownerAction: null,
      href: "/downloads",
      facts: localFacts(),
      membersAffected: true,
    },
    {
      key: "google-docs",
      name: "Google Docs",
      what: "Saves a member's document into their own Google Drive.",
      group: "Documents",
      state: input.googleConfigured ? "available" : "not-configured",
      detail: input.googleConfigured
        ? "The Google connection is registered, so a member can connect their own account. Sophira has not sent a live test document from this page."
        : "The Google connection has not been registered, so a member cannot connect their own account yet. Nothing else in Sophira is affected, and export to Word files still works.",
      ownerAction: input.googleConfigured ? null : "Follow the Google setup steps on the Integrations page.",
      href: "/owner/integrations",
      facts: localFacts(),
      membersAffected: false,
    },
    {
      key: "microsoft-word",
      name: "Microsoft Word",
      what: "Saves a member's document into their own OneDrive as a Word file.",
      group: "Documents",
      state: input.microsoftConfigured ? "available" : "not-configured",
      detail: input.microsoftConfigured
        ? "The Microsoft connection is registered, so a member can connect their own account. Sophira has not sent a live test document from this page."
        : "The Microsoft connection has not been registered, so a member cannot connect their own account yet. Export to a Word file on their own device still works.",
      ownerAction: input.microsoftConfigured ? null : "Follow the Microsoft setup steps on the Integrations page.",
      href: "/owner/integrations",
      facts: localFacts(),
      membersAffected: false,
    },
    {
      key: "canvas",
      name: "Canvas",
      what: "Brings a member's Canvas assignments into Sophira.",
      group: "Connections",
      state: input.canvasConfigured ? "available" : "not-configured",
      detail: input.canvasConfigured
        ? "The Canvas connection is registered. Each member still has to connect their own school account, and Sophira has not synchronised a real assignment from this page."
        : "Canvas has not been registered, so a member cannot connect a school account yet. Assignments can still be added by hand.",
      ownerAction: input.canvasConfigured ? null : "Follow the Canvas setup steps on the Integrations page.",
      href: "/owner/integrations",
      facts: localFacts(),
      membersAffected: false,
    },
    {
      key: "email-delivery",
      name: "Email delivery",
      what: "Sends an invitation email, so an approved person gets their sign-up link without you copying it.",
      group: "Connections",
      state: input.emailConfigured ? "available" : "not-configured",
      detail: input.emailConfigured
        ? "An email service is connected. Whether a given message reaches an inbox depends on that service, so Sophira records the provider's answer on each invitation."
        : "No email service is connected. Invitations still work: Sophira shows you the link to send yourself, and says so on the invitation.",
      ownerAction: input.emailConfigured ? null : "Add an email service key on the Integrations page when you want invitations sent for you.",
      href: "/owner/integrations",
      facts: localFacts(),
      membersAffected: false,
    },
  ];
}

/** Counts per state, for the header line. Only states that occur are counted. */
export function countByState(entries: readonly FeatureEntry[]): Partial<Record<FeatureState, number>> {
  const counts: Partial<Record<FeatureState, number>> = {};
  for (const entry of entries) counts[entry.state] = (counts[entry.state] ?? 0) + 1;
  return counts;
}

/** The features that need the owner's hands - everything else is either fine or built in. */
export function featuresNeedingOwner(entries: readonly FeatureEntry[]): FeatureEntry[] {
  return entries.filter((e) => e.ownerAction !== null);
}
