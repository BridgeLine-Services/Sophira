"use client";

import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Button, Spinner, useToast } from "@/components/ui";
import { Upload, FileText, AlertCircle } from "lucide-react";

/**
 * ADD A DOCUMENT (directive 2026-11-15, Part 9).
 *
 * The endpoint was built and tested before this control existed, which meant a student had no
 * way to use it. This is that way in: choose a file, it is read on the server, and the answer
 * says plainly what happened.
 *
 * Two rules the screen keeps:
 *  - It never says a file was read when it was not. A scan, a recording or a damaged file gets
 *    the sentence that fits, not a green tick.
 *  - It never shows the file's whole contents. A short preview proves the words were read.
 */

interface ExtractionResult {
  kind: string;
  status: string;
  message: string;
  filename: string;
  char_count: number;
  page_count: number | null;
  quotable: boolean;
  title: string | null;
  author: string | null;
  notes: string[];
  preview: string;
  source_id: string | null;
}

const MAX_BYTES = 12 * 1024 * 1024;

export function DocumentUpload({ projectId, onAdded }: { projectId: string | null; onAdded?: () => void }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExtractionResult | null>(null);

  async function addFile(file: File) {
    if (file.size > MAX_BYTES) {
      toast("error", "That file is larger than 12 MB. Add a smaller copy or split it up.");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const buffer = await file.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buffer);
      const chunk = 8192;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const encoded = btoa(binary);

      const res = await fetch("/api/research/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, content_base64: encoded, project_id: projectId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast("error", json.error || "That file could not be added. Try again.");
        return;
      }
      setResult(json.data as ExtractionResult);
      if (json.data?.source_id) onAdded?.();
    } catch {
      toast("error", "That file could not be read. Try adding it again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2">
            <FileText className="h-4 w-4" /> Add a document you already have
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-ink-soft">
          A handout, your own draft, a saved page or your notes. Word documents and PDFs are read
          here on the server; nothing is sent to another service.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            id="research-document"
            type="file"
            className="sr-only"
            accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm,.rtf,.csv,.tex"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void addFile(file);
            }}
          />
          <Button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? <Spinner /> : <Upload className="h-4 w-4" />} {busy ? "Reading your file…" : "Choose a file"}
          </Button>
          <span className="text-xs text-ink-soft">PDF, Word (.docx), text, Markdown, HTML or RTF · up to 12 MB</span>
        </div>

        {result && (
          <div className="panel-flat space-y-1 p-3 text-sm">
            <p className="font-medium">
              {result.quotable ? `${result.filename} — ${result.char_count.toLocaleString()} characters read` : result.filename}
            </p>
            <p className="text-ink-soft">{result.message}</p>
            {result.page_count !== null && <p className="text-xs text-ink-soft">{result.page_count} page(s).</p>}
            {(result.author || result.title) && (
              <p className="text-xs text-ink-soft">
                {result.title ? `“${result.title}”` : ""}
                {result.author ? ` by ${result.author}` : ""}
              </p>
            )}
            {result.notes.map((note) => (
              <p key={note} className="flex items-start gap-1 text-xs text-ink-soft">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> {note}
              </p>
            ))}
            {result.preview && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs font-medium">Show the first words that were read</summary>
                <p className="mt-1 whitespace-pre-wrap text-xs text-ink-soft">{result.preview}</p>
              </details>
            )}
            {!result.quotable && (
              <p className="text-xs text-ink-soft">
                Nothing from this file was added as a source, because there are no words in it to quote.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
