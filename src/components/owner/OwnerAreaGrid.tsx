import Link from "next/link";
import { ownerNavGroupsFor } from "@/lib/navigation/owner-nav";
import type { Role } from "@/lib/roles";

/**
 * OWNER COMMAND CENTER (2026-11-12): the fourteen administrative areas,
 * grouped, with a live link each. Rendered from the SAME registry the
 * sidebar uses, so a Co-Owner never sees an area their page would refuse,
 * and adding an area never means editing a second hardcoded list.
 */
export function OwnerAreaGrid({ role }: { role: Role }) {
  // Same registry, same rule as the sidebar, imported from a module that carries no
  // "use client" directive: a Server Component cannot read data out of a Client
  // Component (that import produced the 2026-11-12 TypeError on /owner).
  const visible = ownerNavGroupsFor(role);

  return (
    <section aria-labelledby="owner-areas-h" className="mt-8">
      <h2 id="owner-areas-h" className="mb-3 meta-strong">
        Administrative areas
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {visible.map((group) => (
          <div key={group.heading} className="rounded-card border border-line bg-card p-4">
            <p className="mb-2 meta-strong">{group.heading}</p>
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
