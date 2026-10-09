import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Backward-compatible redirect (2026-10-09): Learning now lives at /learning
 * — one destination for corrections, learning patterns, and memories.
 * No data, tables, or routes were deleted.
 */
export default function CorrectionsRedirectPage() {
  redirect("/learning");
}
