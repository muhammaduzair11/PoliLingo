'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type NavItem = { href: string; label: string };
export type NavGroup = { label: string; items: NavItem[] };

/**
 * The console's sections: a side nav on desktop, a scrolling tab strip under
 * 800px (console.css). The current page is the item whose href is the
 * longest prefix of the path, so /admin/people marks People, not Overview.
 */
export function ConsoleNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname() ?? '';
  const current = currentHref(
    pathname,
    groups.flatMap((g) => g.items.map((i) => i.href)),
  );
  if (groups.length === 0) return null;
  return (
    <nav className="console-nav" aria-label="Workspace">
      {groups.map((group) => (
        <div key={group.label} className="console-nav-group">
          <p className="console-nav-heading">{group.label}</p>
          <ul>
            {group.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="console-nav-link"
                  aria-current={item.href === current ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function currentHref(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs)
    if (
      (pathname === href || pathname.startsWith(`${href}/`)) &&
      href.length > (best?.length ?? -1)
    )
      best = href;
  return best;
}
