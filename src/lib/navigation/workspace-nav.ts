/**
 * THE ACADEMIC WORKSPACE NAVIGATION (single source of truth, 2026-11-12).
 *
 * The workspace sections used to be a `const NAV` inside src/components/app/AppShell.tsx.
 * Keeping them there meant the ORDER could not be asserted without reading source text,
 * and the rank-specific dashboard entry was hand-written four separate times (desktop
 * rail, tablet row, phone drawer, phone bottom bar) in three slightly different ways -
 * which is how the tablet row ended up ignoring the role filter entirely.
 *
 * This module holds the list once. It is PURE (icons are plain Lucide components, no
 * "use client", no hooks, no browser globals) so a Server Component, the client shell and
 * the test runner can all read the same value.
 *
 * ORDER MATTERS: Home is first, as the owner asked. The sections that follow it are the
 * existing academic destinations, unchanged in wording and destination.
 */
import {
  Bell,
  BookOpen,
  Brain,
  CloudOff,
  Gauge,
  Home,
  Keyboard,
  Mic,
  Layers,
  NotebookPen,
  Settings,
} from "lucide-react";
import type { Role } from "../roles";
import { dashboardForRole } from "./role-home";

export interface WorkspaceNavItem {
  href: string;
  label: string;
  icon: typeof Home;
  /** "dashboard" is the one rank-specific entry; "home" is Home; "section" is everything else. */
  kind: "dashboard" | "home" | "section";
}

/**
 * The academic sections, in the order they are shown. Home is first (owner's instruction,
 * 2026-11-12); the rest are the destinations Sophira already shipped.
 */
export const WORKSPACE_SECTIONS: WorkspaceNavItem[] = [
  { href: "/dashboard", label: "Home", icon: Home, kind: "home" },
  { href: "/writing/typing", label: "Typing Calibration", icon: Keyboard, kind: "section" },
  { href: "/courses", label: "Courses", icon: BookOpen, kind: "section" },
  { href: "/notebooks", label: "Notebooks", icon: NotebookPen, kind: "section" },
  // Flashcards (2026-11-13, Part 6): the decks a student actually studies.
  { href: "/flashcards", label: "Flashcards", icon: Layers, kind: "section" },
  // Lecture studio: the only screen that drives the media pipeline
  // (upload -> transcribe -> study notes -> slides).
  { href: "/lectures", label: "Lectures", icon: Mic, kind: "section" },
  { href: "/learning", label: "Learning / Memory", icon: Brain, kind: "section" },
  { href: "/notifications", label: "Notifications", icon: Bell, kind: "section" },
  { href: "/offline", label: "Offline", icon: CloudOff, kind: "section" },
  { href: "/settings", label: "Settings", icon: Settings, kind: "section" },
];

/**
 * The workspace navigation for one rank: the rank's dashboard entry (if it has one) FIRST,
 * then Home and the academic sections.
 *
 * An ordinary member gets no dashboard entry at all - `dashboardForRole("user")` is null -
 * so their menu begins with Home, exactly as the owner asked. An Owner, Co-Owner or Tester
 * gets one entry for their OWN dashboard and never another rank's.
 *
 * An unknown or not-yet-known role (`null`, "", "nonsense") also gets no entry: the menu
 * fails closed rather than guessing.
 */
export function workspaceNavFor(role: Role | string | null | undefined): WorkspaceNavItem[] {
  const dashboard = dashboardForRole(role);
  if (!dashboard) return [...WORKSPACE_SECTIONS];
  return [
    { href: dashboard.href, label: dashboard.label, icon: Gauge, kind: "dashboard" },
    ...WORKSPACE_SECTIONS,
  ];
}
