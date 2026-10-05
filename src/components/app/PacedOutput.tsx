"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Button, Spinner } from "@/components/ui";
import { ResultBody } from "@/components/app/ResultBody";
import { PacingController } from "@/lib/pacing-controller";
import { Gauge, Pause, Play, Zap } from "lucide-react";

const TICK_MS = 200;

/**
 * Paced output (spec §4): the response is generated and verified FIRST
 * (normal solve flow, persisted server-side as before); this component
 * then progressively reveals the finished text at the user's calibrated
 * typing pace, using the existing pacing engine (never a second timer).
 *
 * Honesty rules:
 *  - No calibration → no invented speed: the user is told and linked to
 *    the calibration test, and the text shows in instant mode only.
 *  - The label says "Writing at your calibrated pace" — an interface
 *    affordance, never a claim that a human is typing.
 *  - Nothing is written to the database while revealing; the final
 *    response was persisted exactly once, as always.
 */
export function PacedOutput({ text, responseId }: { text: string; responseId: string }) {
  const [baselineWpm, setBaselineWpm] = useState<number | null>(null);
  const [calibLoading, setCalibLoading] = useState(true);
  const [mode, setMode] = useState<"paced" | "instant">("instant");
  const [visible, setVisible] = useState("");
  const [running, setRunning] = useState(false);
  const [complete, setComplete] = useState(false);
  const controllerRef = useRef<PacingController | null>(null);

  // Fetch the user's selected baseline once per response.
  useEffect(() => {
    let cancelled = false;
    setCalibLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/typing", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (res.ok) {
          const baseline = json.data.baseline;
          const profile = json.data.profile;
          // The effective pace honors the user's adaptive profile ONLY when
          // they enabled it (or picked a preferred pace); otherwise this is
          // exactly the previous baseline-only behavior.
          let wpm = baseline ? Number(baseline.wpm) : null;
          if (baseline && profile) {
            const auto = profile.auto_adjust_enabled === true;
            const manual = profile.manual_wpm === null || profile.manual_wpm === undefined ? null : Number(profile.manual_wpm);
            wpm = manual ?? (auto ? Number(profile.recommended_wpm) : Number(baseline.wpm));
          }
          setBaselineWpm(wpm && wpm > 0 ? wpm : null);
          if (wpm && wpm > 0) {
            // Calibrated: default to a paced reveal of the finished text.
            setMode("paced");
          }
        } else {
          setBaselineWpm(null); // unknown calibration → honest instant mode
        }
      } catch {
        if (!cancelled) setBaselineWpm(null);
      } finally {
        if (!cancelled) setCalibLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [responseId]);

  // Build/reset the controller for this response and mode.
  useEffect(() => {
    if (calibLoading) return;
    if (mode === "paced" && PacingController.requiresCalibration(baselineWpm)) {
      setMode("instant"); // defensive: never pace without a real baseline
      return;
    }
    const controller =
      mode === "paced" && baselineWpm
        ? new PacingController(text, { wpm: baselineWpm }, "paced")
        : new PacingController(text, { wpm: baselineWpm ?? 1 }, "instant");
    controllerRef.current = controller;
    setVisible(controller.visible());
    setComplete(controller.isComplete());
    if (mode === "paced") {
      controller.start();
      setRunning(true);
    } else {
      setRunning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responseId, mode, calibLoading]);

  // Clock: only advances while running; paused time never counts.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const c = controllerRef.current;
      if (!c) return;
      c.tick(Date.now());
      setVisible(c.visible());
      if (c.isComplete()) {
        setRunning(false);
        setComplete(true);
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [running]);

  const progress = text.length ? visible.length / text.length : 1;

  function togglePause() {
    const c = controllerRef.current;
    if (!c || c.isComplete()) return;
    if (running) {
      c.pause();
      setRunning(false);
    } else {
      c.resume();
      setRunning(true);
    }
  }

  function switchMode(next: "paced" | "instant") {
    if (next === "paced" && PacingController.requiresCalibration(baselineWpm)) return;
    if (next === mode) return;
    if (running) { controllerRef.current?.pause(); setRunning(false); }
    setMode(next);
  }

  if (calibLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <Spinner className="h-4 w-4" /> Preparing your response…
      </div>
    );
  }

  const hasBaseline = !PacingController.requiresCalibration(baselineWpm);

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {mode === "paced" && !complete && (
          <Badge tone="accent"><Gauge className="mr-1 h-3 w-3" /> Writing at your calibrated pace</Badge>
        )}
        {mode === "paced" && complete && <Badge tone="success">Complete</Badge>}
        {mode === "instant" && <Badge tone="neutral"><Zap className="mr-1 h-3 w-3" /> Instant mode</Badge>}

        {hasBaseline && mode === "paced" && !complete && (
          <Button size="sm" variant="secondary" onClick={togglePause}>
            {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {running ? "Pause" : "Resume"}
          </Button>
        )}
        {hasBaseline && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => switchMode(mode === "paced" ? "instant" : "paced")}
            disabled={mode === "instant" && complete && false}
          >
            {mode === "paced" ? "Show all instantly" : "Reveal at my pace"}
          </Button>
        )}
        {mode === "paced" && !complete && (
          <span className="text-xs text-ink-soft">{Math.round(progress * 100)}%</span>
        )}
      </div>

      {mode === "paced" && !complete && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${progress * 100}%` }} />
        </div>
      )}

      {/* The revealed (or full) text */}
      <ResultBody content={visible} />

      {!hasBaseline && (
        <p className="rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm text-ink-soft">
          Paced reveal needs your typing calibration first — Sophira never invents a speed.{" "}
          <Link href="/settings" className="text-accent hover:underline">Take the one-minute typing test</Link>{" "}
          and your baseline will be used here automatically.
        </p>
      )}
    </div>
  );
}
