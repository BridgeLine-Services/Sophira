"use client";

import { useEffect, useState } from "react";

/**
 * Shows an absolute timestamp in the STUDENT'S timezone.
 *
 * The server renders UTC on Vercel, so formatting there would tell a student in another
 * timezone the wrong due time. The first paint is deliberately vague ("an upcoming date")
 * rather than wrong, then it corrects itself once the browser knows the local zone.
 */
export default function LocalDateTime({ iso, mode = "datetime" }: { iso: string; mode?: "date" | "datetime" }) {
  const [label, setLabel] = useState<string>("");

  useEffect(() => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return;
    const options: Intl.DateTimeFormatOptions =
      mode === "date"
        ? { weekday: "short", month: "short", day: "numeric", year: "numeric" }
        : { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" };
    setLabel(new Intl.DateTimeFormat(undefined, options).format(date));
  }, [iso, mode]);

  return <time dateTime={iso}>{label || (mode === "date" ? "the date shown in Canvas" : "the time shown in Canvas")}</time>;
}
