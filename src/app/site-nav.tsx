"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The top navigation bar on every page (#182; Jessie picked a top bar and one planner page). The roster, build editor
// and best teams all live on the planner page, which links to its sections itself.
const PAGES = [
  { href: "/", label: "Planner" },
  { href: "/tags", label: "Tags" },
  { href: "/effects", label: "Effects" },
];

export default function SiteNav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <nav aria-label="Pages" className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 sm:px-6">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          Genshin Team Optimizer
        </Link>
        <ul className="flex gap-4 text-sm">
          {PAGES.map((p) => {
            const current = p.href === "/" ? pathname === "/" : pathname.startsWith(p.href);
            return (
              <li key={p.href}>
                <Link
                  href={p.href}
                  aria-current={current ? "page" : undefined}
                  className={
                    current
                      ? "font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
                      : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  }
                >
                  {p.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
