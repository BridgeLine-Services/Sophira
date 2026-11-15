/**
 * FILE-PROCESSING CAPABILITY STATUS (directive 2026-11-15, part 4).
 *
 * The directive asks for one vocabulary that every capability reports itself in, and
 * that Sophira never says "connected" merely because some code exists. The codebase
 * already had two honest vocabularies: the search provider (`local` / `unconfigured` /
 * `external`) and the AI provider diagnostics. What was missing was the FILE side:
 * reading a PDF, reading a scan, transcribing a recording, and the optional model pass
 * over a student's own document.
 *
 * The seven states are deliberately not interchangeable:
 *
 *   local                          runs inside Sophira, needs nothing, costs nothing
 *   available                      needs a service, and something proved it works
 *   requires_installation          the capability needs a program or service that is
 *                                  not present yet (nothing is broken; it is absent)
 *   requires_provider_configuration the service/provider exists but its address or
 *                                  mode is missing or was rejected
 *   requires_api_key               a hosted provider was chosen but the key is absent
 *   temporarily_unavailable        set up, but did not answer / timed out just now
 *   unsupported_by_hosting         this hosting cannot run it, ever, by design
 *
 * `verified` carries the part the states cannot: a configured service that nobody has
 * pinged is `available` with `verified: false`, so a green report can only come from a
 * probe that actually answered. `available` + unverified is never shown as working.
 *
 * Nothing here reads a secret value, and no URL, host or token is ever returned.
 */
import { readSelfHostedConfig } from "../media/selfhost";
import { providerDiagnostics, readAiEnv, type AiEnv } from "../ai/provider";
import type { FeatureState } from "../owner/feature-catalog";

export type CapabilityState =
  | "local"
  | "available"
  | "requires_installation"
  | "requires_provider_configuration"
  | "requires_api_key"
  | "temporarily_unavailable"
  | "unsupported_by_hosting";

export type FileCapabilityId =
  | "document_text"
  | "image_ocr"
  | "scanned_pdf_ocr"
  | "transcription"
  | "document_analysis"
  | "in_process_media_workers";

export interface FileCapability {
  id: FileCapabilityId;
  /** Short label for an owner screen. */
  label: string;
  state: CapabilityState;
  /** Stable machine code for reports; never shown to a student. */
  code: string;
  /** True only when it needs nothing, or a probe answered just now. */
  verified: boolean;
  /** What a student sees when this capability is why something cannot be done. */
  studentMessage: string;
  /** Owner-facing explanation. Never contains a URL, host, token or vendor promise. */
  ownerDetail: string;
  /** The next step, or null when there is nothing to do. */
  action: string | null;
}

export interface CapabilityProbe {
  healthy: boolean;
  /** Does the service report that it can read PDF pages? null = it did not say. */
  pdf?: boolean | null;
}

export interface CapabilityProbes {
  ocr?: CapabilityProbe;
  asr?: CapabilityProbe;
}

export const CAPABILITY_STATE_LABELS: Record<CapabilityState, string> = {
  local: "Works on this installation",
  available: "Available",
  requires_installation: "Needs setup",
  requires_provider_configuration: "Needs configuration",
  requires_api_key: "Needs a key",
  temporarily_unavailable: "Temporarily unavailable",
  unsupported_by_hosting: "Not possible on this hosting",
};

/**
 * The owner screens already have ONE readiness vocabulary (Part 13: working, available,
 * not-configured, problems, unavailable, not-implemented). Rather than teach the owner a
 * second set of words, every file capability is shown through that existing vocabulary.
 * "Needs a key" and "needs setup" are both the owner's job, so both read "not-configured";
 * a service that was configured and did not answer reads "problems"; a serverless limit reads
 * "not-implemented" because nothing the owner configures will change it.
 */
export function capabilityOwnerState(state: CapabilityState): FeatureState {
  switch (state) {
    case "local":
      return "working";
    case "available":
      return "available";
    case "requires_installation":
    case "requires_provider_configuration":
    case "requires_api_key":
      return "not-configured";
    case "temporarily_unavailable":
      return "problems";
    case "unsupported_by_hosting":
      return "not-implemented";
  }
}

export function stateLabel(state: CapabilityState): string {
  return CAPABILITY_STATE_LABELS[state];
}

/** A capability the student can rely on right now. Unverified does not count. */
export function isUsable(cap: FileCapability): boolean {
  return cap.state === "local" || (cap.state === "available" && cap.verified);
}

const STUDENT_SCAN_OFF =
  "Sophira can read typed text in files, but it has not been set up to read scanned pages or pictures on this installation. Nothing was guessed. Ask the owner to finish setting that up, or paste the text you need.";
const STUDENT_SCAN_UNVERIFIED =
  "Sophira is set up to read scanned pages, but it has not confirmed the reader is running just now. If a scan comes back unread, try again later or paste the text.";
const STUDENT_SCAN_DOWN =
  "Sophira's page reader is not answering right now, so scans cannot be read at the moment. Your file is safe. Try again in a few minutes or paste the text you need.";
const STUDENT_TRANSCRIBE_OFF =
  "Sophira can store a recording, but it has not been set up to turn speech into text on this installation. Your recording is kept, and Sophira will not invent a transcript.";
const STUDENT_TRANSCRIBE_UNVERIFIED =
  "Sophira is set up to transcribe recordings, but it has not confirmed the transcriber is running just now. If it does not start, try again later.";
const STUDENT_TRANSCRIBE_DOWN =
  "Sophira's transcriber is not answering right now. Your recording is kept unchanged. Try again in a few minutes.";
const STUDENT_ANALYSIS_OFF =
  "Looking closely at a file needs Sophira's AI service, which is not set up yet. The words Sophira could read from your file are still here and nothing was lost.";
const STUDENT_ANALYSIS_KEY =
  "Looking closely at a file needs Sophira's AI service, which needs a key the owner has not added yet. Your file's words are still here and nothing was lost.";

function ocrCapability(
  id: "image_ocr" | "scanned_pdf_ocr",
  label: string,
  env: Record<string, string | undefined>,
  probe: CapabilityProbe | undefined
): FileCapability {
  const cfg = readSelfHostedConfig("ocr", env);
  const base = { id, label } as const;

  if (!cfg.configured) {
    if (cfg.problem === "not configured") {
      return {
        ...base,
        state: "requires_installation",
        code: "ocr_not_installed",
        verified: false,
        studentMessage: STUDENT_SCAN_OFF,
        ownerDetail:
          "No page-reading service is set up. Sophira reports a scan as unreadable instead of guessing at it. Reading scans needs Tesseract running on a machine you control, reached over HTTPS.",
        action: "Set up the local page reader, then tell Sophira its address.",
      };
    }
    return {
      ...base,
      state: "requires_provider_configuration",
      code: "ocr_address_rejected",
      verified: false,
      studentMessage: STUDENT_SCAN_OFF,
      ownerDetail: `The page reader's address was rejected by Sophira's own safety rule (${cfg.problem}). Nothing is sent to it until that is corrected.`,
      action: "Correct the page reader address (HTTPS for a public host).",
    };
  }

  if (!probe) {
    return {
      ...base,
      state: "available",
      code: "ocr_configured_unverified",
      verified: false,
      studentMessage: STUDENT_SCAN_UNVERIFIED,
      ownerDetail:
        "A page reader is configured, but it has not been checked in this report. Sophira will only call it working after its health check answers.",
      action: "Run the connection check to confirm the reader is answering.",
    };
  }

  if (!probe.healthy) {
    return {
      ...base,
      state: "temporarily_unavailable",
      code: "ocr_not_answering",
      verified: false,
      studentMessage: STUDENT_SCAN_DOWN,
      ownerDetail:
        "The page reader is configured but did not answer its health check, so Sophira refuses to claim scans can be read. Nothing was sent to it.",
      action: "Start the machine that runs the page reader, then check again.",
    };
  }

  if (id === "scanned_pdf_ocr" && probe.pdf === false) {
    return {
      ...base,
      state: "requires_installation",
      code: "ocr_pdf_step_missing",
      verified: false,
      studentMessage:
        "Sophira can read pictures of text, but its page reader cannot read PDF pages yet. This scan was left unread and nothing was guessed.",
      ownerDetail:
        "The page reader answered, but it reports no PDF support, so multi-page scans stay unread. The PDF step (poppler alongside Tesseract) needs adding on that machine.",
      action: "Add the PDF step to the page reader, then check again.",
    };
  }

  if (id === "scanned_pdf_ocr" && probe.pdf === null) {
    return {
      ...base,
      state: "available",
      code: "ocr_pdf_unconfirmed",
      verified: true,
      studentMessage: STUDENT_SCAN_UNVERIFIED,
      ownerDetail:
        "The page reader answered its health check but did not say whether it can read PDF pages. Sophira will try, and will report plainly if the reader refuses the file.",
      action: null,
    };
  }

  return {
    ...base,
    state: "available",
    code: "ocr_available",
    verified: true,
    studentMessage: "",
    ownerDetail: "The page reader answered its health check, so scans and images can be read.",
    action: null,
  };
}

function transcriptionCapability(
  env: Record<string, string | undefined>,
  probe: CapabilityProbe | undefined
): FileCapability {
  const cfg = readSelfHostedConfig("asr", env);
  const label = "Recording transcription";

  if (!cfg.configured) {
    if (cfg.problem === "not configured") {
      return {
        id: "transcription",
        label,
        state: "requires_installation",
        code: "asr_not_installed",
        verified: false,
        studentMessage: STUDENT_TRANSCRIBE_OFF,
        ownerDetail:
          "No transcription service is set up. Recordings are stored untouched and no transcript is invented. Transcription needs Whisper running on a machine you control.",
        action: "Set up the local transcription service, then tell Sophira its address.",
      };
    }
    return {
      id: "transcription",
      label,
      state: "requires_provider_configuration",
      code: "asr_address_rejected",
      verified: false,
      studentMessage: STUDENT_TRANSCRIBE_OFF,
      ownerDetail: `The transcription service's address was rejected (${cfg.problem}). Nothing is sent to it until that is corrected.`,
      action: "Correct the transcription service address (HTTPS for a public host).",
    };
  }

  if (!probe) {
    return {
      id: "transcription",
      label,
      state: "available",
      code: "asr_configured_unverified",
      verified: false,
      studentMessage: STUDENT_TRANSCRIBE_UNVERIFIED,
      ownerDetail:
        "A transcription service is configured but has not been checked in this report. Sophira will only call it working after its health check answers.",
      action: "Run the connection check to confirm the transcriber is answering.",
    };
  }

  if (!probe.healthy) {
    return {
      id: "transcription",
      label,
      state: "temporarily_unavailable",
      code: "asr_not_answering",
      verified: false,
      studentMessage: STUDENT_TRANSCRIBE_DOWN,
      ownerDetail:
        "The transcription service is configured but did not answer its health check, so Sophira does not claim audio can be transcribed.",
      action: "Start the machine that runs the transcriber, then check again.",
    };
  }

  return {
    id: "transcription",
    label,
    state: "available",
    code: "asr_available",
    verified: true,
    studentMessage: "",
    ownerDetail: "The transcription service answered its health check, so recordings can be transcribed.",
    action: null,
  };
}

/**
 * The model pass over a student's own file. It reuses the SAME provider plan every other
 * AI feature uses: no second configuration, no key of its own, and no keyless fake.
 */
export function documentAnalysisCapability(env: Record<string, string | undefined> = process.env): FileCapability {
  const aiEnv: AiEnv = readAiEnv({
    AI_PROVIDER: env.AI_PROVIDER,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    LOCAL_LLM_BASE_URL: env.LOCAL_LLM_BASE_URL,
    LOCAL_LLM_ALLOW_PRIVATE: env.LOCAL_LLM_ALLOW_PRIVATE,
    ALLOW_PAID_AI: env.ALLOW_PAID_AI,
    MONTHLY_AI_BUDGET_USD: env.MONTHLY_AI_BUDGET_USD,
  });
  const diag = providerDiagnostics(aiEnv);
  const active = diag.candidates[0] ?? null;

  if (active) {
    const local = active === "local" || active === "selfhost";
    return {
      id: "document_analysis",
      label: "Looking closely at a student's file",
      state: local ? "local" : "available",
      code: local ? "analysis_local_model" : "analysis_provider_configured",
      // A configured provider is not proof it answers; the call itself is the proof.
      verified: false,
      studentMessage: "",
      ownerDetail: local
        ? "The file is read by the AI model running on your own hardware. Text does not leave your machines."
        : "The file is read by the configured AI service. Only the text Sophira extracted is sent, never the original file, and only when the student asks for the analysis.",
      action: null,
    };
  }

  const chosen = (env.AI_PROVIDER || "auto").toLowerCase();
  const wantsHostedKey = chosen === "gemini" || chosen === "openai" || chosen === "auto";
  const keyMissing = (chosen === "gemini" && !env.GEMINI_API_KEY) || (chosen === "openai" && !env.OPENAI_API_KEY);

  if (keyMissing) {
    return {
      id: "document_analysis",
      label: "Looking closely at a student's file",
      state: "requires_api_key",
      code: "analysis_key_missing",
      verified: false,
      studentMessage: STUDENT_ANALYSIS_KEY,
      ownerDetail:
        "An AI provider is selected but its key is not set, so no model can answer. Extraction still works and the text is kept; only the analysis step is unavailable.",
      action: "Add the AI provider key, or point Sophira at your own model server.",
    };
  }

  return {
    id: "document_analysis",
    label: "Looking closely at a student's file",
    state: "requires_provider_configuration",
    code: wantsHostedKey ? "analysis_not_configured" : "analysis_server_missing",
    verified: false,
    studentMessage: STUDENT_ANALYSIS_OFF,
    ownerDetail:
      "No AI provider can currently answer: either no key is present, or the self-hosted model address is not set. Extraction still works and nothing is faked in its place.",
    action: "Finish AI setup, or point Sophira at your own model server.",
  };
}

/**
 * The structural limit, stated as a capability instead of a footnote. A serverless
 * function cannot run Tesseract or Whisper, so a "local OCR" switch inside the web
 * deployment would be a promise that fails in production.
 */
export function inProcessMediaCapability(): FileCapability {
  return {
    id: "in_process_media_workers",
    label: "Reading scans inside the web app itself",
    state: "unsupported_by_hosting",
    code: "serverless_cannot_run_native_binary",
    verified: true,
    studentMessage: "",
    ownerDetail:
      "This is a permanent limit, not a missing setting: the web app runs in short-lived serverless functions that cannot host native programs like Tesseract or Whisper. Reading and transcription therefore run on your own machine and are reached over HTTPS.",
    action: null,
  };
}

/** Everything the file pipeline can do, in one honest list. */
export function fileCapabilities(
  env: Record<string, string | undefined> = process.env,
  probes: CapabilityProbes = {}
): FileCapability[] {
  return [
    {
      id: "document_text",
      label: "Reading typed text in files",
      state: "local",
      code: "text_extraction_local",
      verified: true,
      studentMessage: "",
      ownerDetail:
        "PDF, Word, PowerPoint, Excel, CSV, plain text, Markdown, HTML and RTF are read inside Sophira. No key, no service, no per-file fee.",
      action: null,
    },
    ocrCapability("image_ocr", "Reading pictures and photos of text", env, probes.ocr),
    ocrCapability("scanned_pdf_ocr", "Reading scanned PDF pages", env, probes.ocr),
    transcriptionCapability(env, probes.asr),
    documentAnalysisCapability(env),
    inProcessMediaCapability(),
  ];
}

export interface CapabilitySummary {
  capabilities: FileCapability[];
  /** Ids a student can rely on right now. */
  usable: FileCapabilityId[];
  /** Ids that need the owner to act. */
  blocked: FileCapabilityId[];
  /** Ids that are set up but unverified in this report. */
  unverified: FileCapabilityId[];
}

export function summarizeCapabilities(list: FileCapability[]): CapabilitySummary {
  return {
    capabilities: list,
    usable: list.filter((c) => isUsable(c) || c.state === "local").map((c) => c.id),
    blocked: list
      .filter((c) => c.state === "requires_installation" || c.state === "requires_provider_configuration" || c.state === "requires_api_key")
      .map((c) => c.id),
    unverified: list.filter((c) => c.state === "available" && !c.verified).map((c) => c.id),
  };
}

/** Compact, secret-free projection for a public readiness payload. */
export function capabilityStates(
  list: FileCapability[]
): Record<FileCapabilityId, { state: CapabilityState; code: string; verified: boolean }> {
  const out = {} as Record<FileCapabilityId, { state: CapabilityState; code: string; verified: boolean }>;
  for (const c of list) out[c.id] = { state: c.state, code: c.code, verified: c.verified };
  return out;
}

/** The student-facing reason a specific capability is unavailable, or null when it is fine. */
export function studentReason(list: FileCapability[], id: FileCapabilityId): string | null {
  const cap = list.find((c) => c.id === id);
  if (!cap) return null;
  if (cap.state === "local" || cap.state === "available") return cap.studentMessage || null;
  return cap.studentMessage || null;
}
