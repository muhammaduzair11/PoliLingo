'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

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
  const navRef = useRef<HTMLElement>(null);
  // Under 800px the nav is a strip that scrolls sideways, and the current
  // tab (People, Publish) can start off-screen. Bring it into view without
  // animation, and only when the strip overflows: the desktop side nav is
  // left alone.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || nav.scrollWidth <= nav.clientWidth) return;
    nav.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({
      inline: 'nearest',
      block: 'nearest',
      behavior: 'auto',
    });
  }, [current]);
  if (groups.length === 0) return null;
  return (
    <nav ref={navRef} className="console-nav" aria-label="Workspace">
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
