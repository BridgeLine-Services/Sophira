"use client";

import { useEffect, useState } from "react";
import { subjectBySlug } from "@/lib/courses/engines";

/**
 * SCOPE CHIP (course-aware engines round 2026-10-11): engines opened from a
 * SUBJECT workspace (?subject=) or a COURSE workspace (?course_id=) show the
 * active scope next to the title, so the student can see that subject memory
 * and course rules apply to THIS tool. Opened bare, the tool stays generic
 * and the chip stays hidden — an unscoped tool never pretends to be scoped.
 *
 * Identity is the subject slug / course id (never display names); the course
 * name comes from the real record via /api/courses (RLS: own rows only).
 */
export function ScopeChip() {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(window.location.search);
    } catch {
      return; // unreachable: not scoped
    }
    const courseId = params.get("course_id");
    const subjectSlug = params.get("subject");

    if (courseId) {
      // Resolve the REAL course record; fall back to an honest generic label
      // rather than an invented name.
      fetch(`/api/courses?id=${encodeURIComponent(courseId)}`, { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) return;
          const json = await res.json();
          const name = json?.data?.name ? String(json.data.name) : null;
          const subject = json?.data?.subject ? String(json.data.subject) : null;
          if (!cancelled) setLabel(name ? `Course: ${name}${subject ? ` (${subject})` : ""}` : "Course work");
        })
        .catch(() => { if (!cancelled) setLabel("Course work"); });
      return () => { cancelled = true; };
    }

    if (subjectSlug) {
      const node = subjectBySlug(subjectSlug);
      if (node) setLabel(`Subject: ${node.label}`);
      return;
    }
    return () => { cancelled = true; };
  }, []);

  if (!label) return null;
  return (
    <span
      className="hidden shrink-0 items-center rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent sm:inline-flex"
      aria-label={`Active scope: ${label}`}
      data-testid="scope-chip"
    >
      {label}
    </span>
  );
}
