"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Button, Card, CardContent, EmptyState, Input, Spinner } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { FileVideo, Mic, PlayCircle, Sparkles, Upload } from "lucide-react";

/**
 * Lecture studio.
 *
 * This page is the only screen that drives the media pipeline: upload,
 * transcription, study notes, questions with timestamps, and reading what was
 * on the slides. Everything it shows comes back from the server; nothing is
 * inferred or filled in. When a step has not run, the button is offered rather
 * than a placeholder result.
 *
 * Uploads never pass through the application server (a two-hour recording is
 * far larger than a serverless request may carry): the page asks for a
 * short-lived signed URL, then sends the file straight into the member's own
 * folder in the private bucket.
 */

type MediaAsset = {
  id: string;
  kind: "video" | "audio";
  original_filename: string;
  mime: string;
  byte_size: number;
  duration_sec: number | null;
  status: "uploaded" | "extracting" | "transcribing" | "ready" | "failed" | "partial";
  error_code: string | null;
  member_note: string;
  frames_sampled: number;
  created_at: string;
};

type StudyAnswer = {
  answer: string;
  notice: string;
  transcriptConfidence: string;
  coverage: number;
  removedCitations: number;
  truncated: boolean;
};

type FrameResult = { atSec: number; text: string; kind: string; note: string };

const STATUS_LABEL: Record<MediaAsset["status"], string> = {
  uploaded: "Uploaded, not transcribed yet",
  extracting: "Working on it",
  transcribing: "Transcribing",
  ready: "Transcript ready",
  partial: "Transcript ready, with gaps",
  failed: "Could not process",
};

const STATUS_TONE: Record<MediaAsset["status"], "neutral" | "success" | "warn" | "danger"> = {
  uploaded: "neutral",
  extracting: "neutral",
  transcribing: "neutral",
  ready: "success",
  partial: "warn",
  failed: "danger",
};

/**
 * Every string on this page came from somewhere outside: a transcript, a model,
 * or text recognised in a picture of a slide. None of it is markup and none of it
 * should ever become markup, so it is normalised to plain text before it reaches
 * the DOM: control characters and angle brackets are removed and length is
 * bounded. React escapes JSX text anyway; doing it here means the guarantee does
 * not rest on a renderer detail.
 */
function plainText(value: unknown, max = 400): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, max);
}

function mb(bytes: number) {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function clock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(r).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Where to take still frames from a recording. Mirrors the server's own
 * planner (start a little way in, roughly one frame per half minute, capped) so
 * the client cannot ask for more frames than the server will accept.
 */
function sampleTimes(durationSec: number): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [];
  const start = Math.min(5, durationSec * 0.05);
  const count = Math.max(1, Math.min(12, Math.floor(durationSec / 30)));
  const step = (durationSec - start) / count;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(Math.round((start + step * i) * 10) / 10);
  return out;
}

/** Reads a frame out of a local video file without uploading it again. */
async function grabFrame(file: File, atSec: number): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.preload = "auto";
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("unreadable"));
    });
    video.currentTime = Math.min(atSec, Math.max(0, (video.duration || atSec) - 0.1));
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error("unreadable"));
    });
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function LecturesPage() {
  const supabase = useMemo(() => createClient(), []);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [assets, setAssets] = useState<MediaAsset[] | null>(null);
  const [listNote, setListNote] = useState("");
  const [uploading, setUploading] = useState<{ name: string; step: string } | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [answers, setAnswers] = useState<Record<string, StudyAnswer>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [frames, setFrames] = useState<Record<string, FrameResult[]>>({});
  const [question, setQuestion] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("media_assets")
      .select("id, kind, original_filename, mime, byte_size, duration_sec, status, error_code, member_note, frames_sampled, created_at")
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) {
      setListNote("Sophira could not load your recordings just now. Reload the page in a moment.");
      setAssets([]);
      return;
    }
    setListNote("");
    setAssets((data ?? []) as MediaAsset[]);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(file: File) {
    setUploadError("");
    setUploading({ name: file.name, step: "Checking the file" });

    // Validate before sending anything: the server enforces the same rules, and
    // a failed upload should cost the member a sentence, not their bandwidth.
    const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : null;
    if (!kind) {
      setUploading(null);
      setUploadError("That file is not a video or a recording. Sophira can take MP4, WebM, MOV, MP3, M4A or WAV.");
      return;
    }

    try {
      setUploading({ name: file.name, step: "Asking for a private upload link" });
      const metaRes = await fetch("/api/media/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, mime: file.type, byteSize: file.size }),
      });
      const meta = await metaRes.json().catch(() => null);
      if (!metaRes.ok || !meta?.data?.signedUrl) {
        setUploading(null);
        setUploadError(meta?.error ?? "Sophira could not start the upload. Please try again in a moment.");
        return;
      }

      setUploading({ name: file.name, step: "Sending the recording straight to your private storage" });
      const put = await fetch(meta.data.signedUrl, {
        method: "PUT",
        headers: { "content-type": file.type, "x-upsert": "false" },
        body: file,
      });
      if (!put.ok) {
        setUploading(null);
        setUploadError("The upload stopped part way. Check your connection and try the same file again.");
        return;
      }

      setUploading({ name: file.name, step: "Finished" });
      await load();
      setUploading(null);
    } catch {
      setUploading(null);
      setUploadError("The upload stopped part way. Check your connection and try the same file again.");
    }
  }

  async function transcribe(id: string) {
    setBusyId(id);
    setNotes((n) => ({ ...n, [id]: "" }));
    try {
      const res = await fetch(`/api/media/${id}/transcribe`, { method: "POST" });
      const body = await res.json().catch(() => null);
      setNotes((n) => ({
        ...n,
        [id]:
          body?.data?.memberNote ||
          body?.error ||
          (res.ok ? "Transcription finished." : "Sophira could not transcribe this recording right now."),
      }));
      await load();
    } finally {
      setBusyId("");
    }
  }

  async function study(id: string, ask?: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/media/${id}/study`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ask ? { ask: plainText(ask, 800) } : { task: "summary" }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) {
        setAnswers((a) => ({
          ...a,
          [id]: {
            answer: plainText(body?.error ?? "Sophira could not work on this lecture right now. Please try again.", 2000),
            notice: "",
            transcriptConfidence: "",
            coverage: 0,
            removedCitations: 0,
            truncated: false,
          },
        }));
        return;
      }
      const data = body.data as StudyAnswer;
      setAnswers((a) => ({
        ...a,
        [id]: {
          ...data,
          answer: plainText(data.answer, 20000),
          notice: plainText(data.notice, 600),
          transcriptConfidence: plainText(data.transcriptConfidence, 40),
        },
      }));
    } finally {
      setBusyId("");
    }
  }

  async function readSlides(asset: MediaAsset) {
    if (!fileInput.current) return;
    setUploadError("");
    setBusyId(asset.id);
    try {
      // The member re-picks the same file; it is read locally and never
      // re-uploaded. Frames go up as small stills.
      const file = await new Promise<File | null>((resolve) => {
        const input = fileInput.current!;
        input.onchange = () => resolve(input.files?.[0] ?? null);
        input.click();
      });
      if (!file) {
        setBusyId("");
        return;
      }
      const url = URL.createObjectURL(file);
      const duration = await new Promise<number>((resolve) => {
        const v = document.createElement("video");
        v.src = url;
        v.onloadedmetadata = () => resolve(v.duration || 0);
        v.onerror = () => resolve(0);
      });
      URL.revokeObjectURL(url);

      const times = sampleTimes(duration || asset.duration_sec || 0);
      if (times.length === 0) {
        setNotes((n) => ({ ...n, [asset.id]: "Sophira could not read the length of that video, so no slides were sampled." }));
        setBusyId("");
        return;
      }

      const collected: FrameResult[] = [];
      for (const at of times) {
        const blob = await grabFrame(file, at);
        if (!blob) continue;
        const form = new FormData();
        form.set("frame", new File([blob], `frame-${Math.round(at)}.jpg`, { type: "image/jpeg" }));
        form.set("at_sec", String(at));
        const res = await fetch(`/api/media/${asset.id}/frames`, { method: "POST", body: form });
        const body = await res.json().catch(() => null);
        if (res.ok && body?.data) {
          collected.push({
            atSec: at,
            text: String(body.data.text ?? ""),
            kind: String(body.data.kind ?? ""),
            note: String(body.data.memberNote ?? ""),
          });
        }
      }
      setFrames((f) => ({
        ...f,
        [asset.id]: collected.map((c) => ({
          ...c,
          text: plainText(c.text, 300),
          note: plainText(c.note, 300),
        })),
      }));
      await load();
    } catch {
      setUploadError("Sophira could not read slides from that video. Try the file again, or upload a shorter clip.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <AppShell title="Lectures" actions={<Badge tone="neutral">Private to you</Badge>}>
      <div className="space-y-5">
        <Card>
          <CardContent className="space-y-3">
            <h2 className="text-[15px] font-semibold text-ink">Add a lecture recording</h2>
            <p className="text-sm text-muted">
              A class recording, a voice memo, or a video of the board. Sophira transcribes it on your own machine
              where it can, then writes study notes that point at the moment they came from.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => {
                  if (!fileInput.current) return;
                  fileInput.current.onchange = () => {
                    const f = fileInput.current?.files?.[0];
                    if (f) void upload(f);
                    if (fileInput.current) fileInput.current.value = "";
                  };
                  fileInput.current.click();
                }}
                disabled={!!uploading}
              >
                <Upload className="mr-2 h-4 w-4" aria-hidden />
                Choose a file
              </Button>
              <span className="text-xs text-muted">MP4, WebM, MOV, MP3, M4A or WAV. Up to 500 MB.</span>
            </div>
            <input ref={fileInput} type="file" accept="video/*,audio/*" className="hidden" aria-hidden tabIndex={-1} />
            {uploading ? (
              <p className="flex items-center gap-2 text-sm text-muted" role="status">
                <Spinner /> {uploading.name}: {uploading.step}
              </p>
            ) : null}
            {uploadError ? (
              <p role="alert" className="text-sm text-danger">
                {uploadError}
              </p>
            ) : null}
          </CardContent>
        </Card>

        {assets === null ? (
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <Spinner /> Loading your recordings
          </p>
        ) : assets.length === 0 ? (
          <EmptyState
            title="No recordings yet"
            description={
              listNote ||
              "Add one above. Nothing is shared with anyone: recordings live in your own private folder and only your account can open them."
            }
          />
        ) : (
          <div className="space-y-4">
            {assets.map((asset) => {
              const answer = answers[asset.id];
              const busy = busyId === asset.id;
              const frameSet = frames[asset.id];
              const canStudy = asset.status === "ready" || asset.status === "partial";
              return (
                <Card key={asset.id}>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {asset.kind === "video" ? (
                        <FileVideo className="h-4 w-4 text-muted" aria-hidden />
                      ) : (
                        <Mic className="h-4 w-4 text-muted" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                        {asset.original_filename || "Recording"}
                      </span>
                      <Badge tone={STATUS_TONE[asset.status]}>{STATUS_LABEL[asset.status]}</Badge>
                    </div>

                    <p className="text-xs text-muted">
                      {mb(asset.byte_size)}
                      {asset.duration_sec ? ` · ${clock(Number(asset.duration_sec))}` : ""} · added{" "}
                      {fmtDate(asset.created_at)}
                      {asset.frames_sampled > 0 ? ` · ${asset.frames_sampled} stills read` : ""}
                    </p>

                    {asset.member_note ? <p className="text-sm text-muted">{plainText(asset.member_note, 600)}</p> : null}
                    {notes[asset.id] ? <p className="text-sm text-muted">{plainText(notes[asset.id], 600)}</p> : null}

                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => void transcribe(asset.id)} disabled={busy}>
                        {busy ? <Spinner /> : <PlayCircle className="mr-2 h-4 w-4" aria-hidden />}
                        {asset.status === "ready" || asset.status === "partial" ? "Transcribe again" : "Transcribe"}
                      </Button>
                      <Button variant="secondary" onClick={() => void study(asset.id)} disabled={busy || !canStudy}>
                        <Sparkles className="mr-2 h-4 w-4" aria-hidden />
                        Study notes
                      </Button>
                      {asset.kind === "video" ? (
                        <Button variant="secondary" onClick={() => void readSlides(asset)} disabled={busy}>
                          Read the slides
                        </Button>
                      ) : null}
                    </div>

                    {!canStudy ? (
                      <p className="text-xs text-muted">Study notes need a transcript first. Transcribe this recording above.</p>
                    ) : null}

                    {answer ? (
                      <div className="space-y-2 rounded-lg border border-line bg-surface-2 p-3">
                        <p className="whitespace-pre-wrap text-sm text-ink">{plainText(answer.answer, 20000)}</p>
                        <p className="text-xs text-muted">
                          {answer.notice ? `${answer.notice} ` : ""}
                          {answer.transcriptConfidence ? `Transcript confidence: ${answer.transcriptConfidence}. ` : ""}
                          {answer.removedCitations > 0
                            ? `${answer.removedCitations} quote(s) were dropped because they did not match the transcript. `
                            : ""}
                          {answer.truncated ? "The lecture was long, so this covers the parts with a clear transcript. " : ""}
                        </p>
                      </div>
                    ) : null}

                    {canStudy ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          aria-label="Ask about this lecture"
                          placeholder="Ask about this lecture, e.g. what did she say about the midterm?"
                          value={question[asset.id] ?? ""}
                          onChange={(e) => setQuestion((q) => ({ ...q, [asset.id]: e.target.value }))}
                          className="min-w-0 flex-1"
                        />
                        <Button
                          onClick={() => void study(asset.id, (question[asset.id] ?? "").trim())}
                          disabled={busy || !(question[asset.id] ?? "").trim()}
                        >
                          Ask
                        </Button>
                      </div>
                    ) : null}

                    {frameSet && frameSet.length > 0 ? (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted">What was on screen</p>
                        {frameSet.map((f, i) => (
                          <p key={`${asset.id}-${i}`} className="text-xs text-muted">
                            <span className="font-medium text-ink">{clock(f.atSec)}</span>
                            {f.text ? `: ${plainText(f.text, 180)}` : f.note ? `: ${plainText(f.note, 180)}` : ": nothing readable"}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
