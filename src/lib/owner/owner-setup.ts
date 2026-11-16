/**
 * THINGS ONLY THE OWNER CAN DO (2026-11-15, directive Parts 3, 4 and 18).
 *
 * The Owner is not technical and should never be asked to edit code, run a command or read a log.
 * Everything below is a click path in a web page they already have an account for, written in the
 * order they will actually do it, with the exact names of the boxes to fill.
 *
 * TWO RULES THIS FILE IS BUILT ON, both pinned by tests:
 *
 *  1. It never contains a secret. No key, no password, no example that could be mistaken for one.
 *     The Owner types those straight into the dashboard that owns them; the value never travels
 *     through chat, and Sophira never displays it back.
 *  2. It never asks the Owner to do something the app cannot honour. Every step ends in something
 *     observable from outside, and the app tells them what it will check afterwards.
 */

export interface OwnerSetupStep {
  /** The directive's part number this unblocks, so the Owner can connect it to the report. */
  part: number;
  title: string;
  /** One sentence: what becomes possible that is not possible today. */
  unlocks: string;
  /** What stays true if they never do it, so nothing is silently broken. */
  ifYouSkipIt: string;
  /** Numbered, click by click, in the order they happen. */
  steps: string[];
}

export const OWNER_SETUP_STEPS: OwnerSetupStep[] = [
  {
    part: 3,
    title: "Let assignments keep working while you are away",
    unlocks:
      "A finished assignment can advance on a schedule of its own, instead of only while a Sophira page is open.",
    ifYouSkipIt:
      "Nothing breaks. Every run keeps its place and continues the next time you open Sophira, and every screen says exactly that.",
    steps: [
      "Sign in to vercel.com and open the project called Sophira.",
      "Click Settings at the top, then Environment Variables in the list on the left.",
      "Click Create New (on some accounts the button says Add New).",
      "In the box named Key, type exactly: CRON_SECRET",
      "In the box named Value, type a long phrase nobody could guess: three unrelated words and a number, at least 16 characters. Do not reuse a password you use anywhere else.",
      "Leave all three environment boxes ticked, then click Save.",
      "Open github.com/BridgeLine-Services/Sophira in a second tab. Click Settings, then Secrets and variables, then Actions, then the green New repository secret button.",
      "In the Name box type exactly: CRON_SECRET and in the Secret box paste the same phrase you just used. Click Add secret.",
      "Back in Vercel, add two more variables the same way: SOPHIRA_AUTONOMOUS_ESSAY with the value 1, and SOPHIRA_AUTONOMOUS_SCHEDULE with the value 1.",
      "In Vercel open Deployments, click the newest one, open its ... menu, click Redeploy and confirm. This is what makes the new settings take effect.",
      "Write \u201cscheduler done\u201d here. I will check from outside that it is really running, and you never need to send me the phrase.",
    ],
  },
  {
    part: 4,
    title: "Give Sophira a working AI service",
    unlocks:
      "A run can actually write the sections, not just plan them. Today every AI screen honestly says the service is not connected.",
    ifYouSkipIt:
      "Every AI feature keeps refusing with the same plain sentence instead of pretending. Planning, editing, your own writing and every other part of Sophira work without it.",
    steps: [
      "Decide which service you want to pay for. If you already pay for one, use that: Google (Gemini) or OpenAI.",
      "Sign in to that service and create an API key. Both call it the same thing in their menus.",
      "Copy the key. Keep the tab open until the next step is done.",
      "In Vercel, open the Sophira project, click Settings, then Environment Variables, then Create New.",
      "If you chose Google, the Key is GEMINI_API_KEY. If you chose OpenAI, the Key is OPENAI_API_KEY. Type it exactly, capital letters and underscores.",
      "Paste the key into the Value box, leave all three environments ticked, and click Save.",
      "Open Deployments, click the newest one, open its ... menu, click Redeploy and confirm.",
      "Write \u201ckey added\u201d here and say which service it was. I will confirm the AI switch reads on, and I will not ask you for the key.",
    ],
  },
  {
    part: 18,
    title: "Fill in the business details on the legal pages",
    unlocks:
      "The privacy policy, terms and refund pages can name a real business instead of a placeholder, which is what they need before anyone outside your network is invited.",
    ifYouSkipIt:
      "The legal pages stay marked as waiting for you, and the release check keeps refusing to call the site ready. They are not published with invented details.",
    steps: [
      "Have ready: the registered name of your business, the contact email you want published, and the postal address you are willing to publish.",
      "Also decide one thing: whether you want a phone number on those pages, and if so which one.",
      "Reply here with just those details. They are not secret: they are what the pages say out loud.",
      "I will write them into the legal pages, remove the placeholders, and re-run the release check so you can see it change from waiting to done.",
      "If any of it changes later, send me the change in one line. You will never need to edit a page yourself.",
    ],
  },
];

/** Shown above the steps. Short, and true for every one of them. */
export const OWNER_SETUP_SAFETY = [
  "Type keys and passwords straight into Vercel or GitHub. Never send them to me, in chat or email, even if I ask: I will never ask.",
  "Never send a one-time code, a card number or a bank detail. Nothing in Sophira needs them.",
  "If a key or phrase ever leaks, change it in both places and tell me only that you changed it.",
  "No step here asks you to edit code, open a terminal or read a log file. If any instruction ever does, it did not come from me.",
];

/** Parts the Owner is holding, in the order they unblock the most. */
export function ownerHeldParts(): number[] {
  return OWNER_SETUP_STEPS.map((s) => s.part);
}
