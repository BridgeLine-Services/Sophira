"use client";

import { Suspense, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Label, Spinner, useToast } from "@/components/ui";
import { preprocessForOcr, detectExpression, toGrayscale, type GrayImage } from "@/lib/math/image";
import { PipelineView } from "@/components/math/PipelineView";
import { TypesetMath } from "@/components/math/TypesetMath";
import { AlertTriangle, Camera, CheckCheck, ScanLine, ShieldCheck } from "lucide-react";

/**
 * Scan Problem (2026-10-06): image-to-solution pipeline.
 *  scan → capture → crop/rotate/deskew → detect → OCR → reconstruct →
 *  DISPLAY the recognized expression (never skipped) → confirm/correct →
 *  deterministic solve → AI explains → teacher method → independent
 *  verification → steps. Failures are marked NEEDS REVIEW — never hidden.
 */

interface PipelineResult {
  status: "OK" | "NEEDS CONFIRMATION" | "NEEDS REVIEW";
  recognized: { rawText: string; expression: string; expressions: string[]; confidence: number; ambiguity: string[]; ocrEngine: string };
  solution: { solved: boolean; kind: string; finalAnswer: string; steps: { text: string; expr?: string }[]; honestNote?: string };
  multipleChoice?: { inverted: boolean; established: boolean; base: string; choices: { label: string; text: string; verdict: "correct" | "incorrect" | "cannot_determine"; reason: string }[] };
  explanation: { text: string; source: string; honestNote: string };
  verification: { status: string; checks: { name: string; passed: boolean; detail: string }[]; note: string };
  teacherMethod: { applied: boolean; note: string } | null;
  preprocess: { cropped: boolean; rotationDegrees: number; deskewDegrees: number; method: string };
}

export default function MathScanPage() {
  // useSearchParams requires a Suspense boundary for prerendering.
  return (
    <Suspense fallback={null}>
      <MathScanInner />
    </Suspense>
  );
}

function MathScanInner() {
  const { toast } = useToast();
  const urlMode = useSearchParams().get("mode");
  const subjectSlug = useSearchParams().get("subject");
  const [teachMode, setTeachMode] = useState(urlMode === "teach");
  const [typeOpen, setTypeOpen] = useState(urlMode === "type");
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const [preprocessInfo, setPreprocessInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [confirmedExpr, setConfirmedExpr] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [detect, setDetect] = useState<string | null>(null);

  const capture = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setImageDataUrl(reader.result as string);
      setResult(null);
      setConfirmedExpr("");
      setDetect(null);
      setPreprocessInfo(null);
    };
    reader.readAsDataURL(file);
  };

  /** Step 3: crop/rotate/deskew on canvas + step 4 detect (both deterministic). */
  const preprocess = () => {
    if (!imageDataUrl) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const maxSide = 1400;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const gray = toGrayscale(canvas.width, canvas.height, rgba);
      const detection = detectExpression(gray);
      setDetect(detection.detected ? `Expression detected — ${detection.reason}` : `Detection: ${detection.reason}`);
      const pre = preprocessForOcr(gray, rotation);
      setPreprocessInfo(`cropped to ink, rotated ${rotation}°, deskewed ${pre.deskewDegrees}° (deterministic)`);
      // render the preprocessed image back for the user to see
      const out = document.createElement("canvas");
      out.width = pre.image.width;
      out.height = pre.image.height;
      const octx = out.getContext("2d")!;
      const outData = octx.createImageData(pre.image.width, pre.image.height);
      for (let i = 0; i < pre.image.grayscale.length; i++) {
        const v = pre.image.grayscale[i];
        outData.data[i * 4] = v; outData.data[i * 4 + 1] = v; outData.data[i * 4 + 2] = v; outData.data[i * 4 + 3] = 255;
      }
      octx.putImageData(outData, 0, 0);
      setImageDataUrl(out.toDataURL("image/jpeg", 0.85));
      setRotation(0);
    };
    img.src = imageDataUrl;
  };

  const solveImage = async (confirmedExpression?: string) => {
    if (!imageDataUrl) { toast("error", "Scan or capture a problem first."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/math/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_data_url: imageDataUrl, rotation, confirmed_expression: confirmedExpression ?? null, mode: teachMode ? "teach" : "solve", ...(subjectSlug ? { subject: subjectSlug } : {}) }),
      });
      const json = await res.json();
      if (!res.ok || !json.result) {
        toast("error", json.error ?? "The pipeline failed. Nothing was guessed.");
        return;
      }
      setResult(json.result as PipelineResult);
      if (json.result.status === "NEEDS CONFIRMATION") setConfirming(true);
      if (json.result.status === "OK") toast("success", "Solved and independently verified.");
      if (json.result.status === "NEEDS REVIEW") toast("error", "Verification flagged this result — it is marked NEEDS REVIEW, not hidden.");
    } finally {
      setBusy(false);
    }
  };

  const confirmAndSolve = async () => {
    await solveImage(confirmedExpr || result?.recognized.expression);
  };

  const solveTyped = async () => {
    if (!confirmedExpr.trim()) { toast("error", "Type the problem first."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/math/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expression: confirmedExpr, mode: teachMode ? "teach" : "solve", ...(subjectSlug ? { subject: subjectSlug } : {}) }),
      });
      const json = await res.json();
      if (!res.ok || !json.result) { toast("error", json.error ?? "Failed."); return; }
      setResult(json.result as PipelineResult);
      if (json.result.status === "NEEDS REVIEW") toast("error", "Marked NEEDS REVIEW — see the verification section.");
      else toast("success", "Solved and independently verified.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="Math • Scan to Solve">
      {/* three-step workflow indicator (approved scan concept) */}
      <div className="flex items-center gap-2 text-xs">
        {["Upload", "Review transcription", "Solve & verify"].map((lbl, i) => (
          <span key={lbl} className="flex items-center gap-2">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full ${i === 0 ? "bg-accent text-white" : "bg-accent-soft text-accent"}`}>{i + 1}</span>
            <span className={i === 0 ? "font-semibold text-ink" : "text-ink/50"}>{lbl}</span>
            {i < 2 && <span aria-hidden>→</span>}
          </span>
        ))}
      </div>
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ScanLine className="h-4 w-4" /> Scan a math problem</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-ink/60">
              Photograph an equation. Sophira preprocesses the image (crop, rotate, deskew — deterministic), reads it with OCR,
              shows you EXACTLY what it thinks the expression says, and asks you to confirm. Only then does it solve —
              deterministically (mathjs), never by guessing — and verifies the result independently. If verification fails
              the answer is marked <span className="font-semibold">NEEDS REVIEW</span>, never hidden.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) capture(f); e.currentTarget.value = ""; }} />
              <Button onClick={() => fileRef.current?.click()}><Camera className="mr-1 h-4 w-4" /> Scan Problem</Button>
              {imageDataUrl && (
                <>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">rotate °</Label>
                    <input type="range" min={0} max={359} value={rotation} onChange={(e) => setRotation(Number(e.target.value))} className="w-32" />
                    <span className="text-xs text-ink/50">{rotation}°</span>
                  </div>
                  <Button variant="secondary" onClick={preprocess}>Crop / rotate / deskew</Button>
                  <Button onClick={() => solveImage()} disabled={busy}>{busy ? <Spinner /> : "Recognize"}</Button>
                </>
              )}
            </div>
            {preprocessInfo && <p className="text-xs text-ink/50">{preprocessInfo}</p>}
            {detect && <p className={`text-xs ${detect.startsWith("Expression detected") ? "text-success" : "text-warn"}`}>{detect}</p>}
            {imageDataUrl && <img src={imageDataUrl} alt="scanned problem" className="max-h-64 rounded border border-ink/10" />}

            <div className="rounded-lg border border-ink/10 bg-ink/[0.02] p-4">
              <p className="text-sm font-medium">Prefer to type?</p>
              <p className="text-xs text-ink/60">Enter a problem in the dedicated Type to Solve workspace.</p>
              <a href="/math" className="mt-2 inline-block rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">Open Type to Solve</a>
            </div>
          </CardContent>
        </Card>

        {result && <PipelineView result={result} confirming={confirming} onConfirmChange={setConfirmedExpr} onConfirm={confirmAndSolve} />}
        {!result && !imageDataUrl && <EmptyState title="Nothing scanned yet" description="Drop a photo here or choose an image. You will confirm the recognized expression before Sophira solves it." />}
      </div>
    </AppShell>
  );
}
