import Link from "next/link";
import { OWNER_NAV_GROUPS } from "@/components/app/AppShell";
import { roleRank } from "@/lib/roles";
import type { Role } from "@/lib/roles";

/**
 * OWNER COMMAND CENTER (2026-11-12): the fourteen administrative areas,
 * grouped, with a live link each. Rendered from the SAME registry the
 * sidebar uses, so a Co-Owner never sees an area their page would refuse,
 * and adding an area never means editing a second hardcoded list.
 */
export function OwnerAreaGrid({ role }: { role: Role }) {
  const visible = OWNER_NAV_GROUPS.map((g) => ({
    heading: g.heading,
    items: g.items.filter((i) => roleRank(role) >= roleRank(i.minimum ?? "owner")),
  })).filter((g) => g.items.length > 0);

  return (
    <section aria-labelledby="owner-areas-h" className="mt-8">
      <h2 id="owner-areas-h" className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-soft">
        Administrative areas
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {visible.map((group) => (
          <div key={group.heading} className="rounded-card border border-line bg-card p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">{group.heading}</p>
            <ul className="space-y-1.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="flex items-center gap-1.5 rounded text-sm text-ink hover:text-accent focus-visible:underline">
                    <item.icon className="h-3.5 w-3.5 shrink-0 text-ink-soft" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
