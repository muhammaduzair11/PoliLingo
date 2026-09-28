'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export type NavItem = { href: string; label: string };
export type NavGroup = { label: string; items: NavItem[] };

/**
 * The console's sections: a side nav on desktop, a scrolling tab strip under
 * 800px (console.css). The current page is the item whose href is the
 * longest prefix of the path, so /admin/people marks People, not Overview.
 *
 * On the strip, a thin rule separates the groups (their headings are
 * hidden there), and an edge fades while there are more tabs to scroll to,
 * so a tab cut off at the edge reads as "more this way", not as missing.
 */
export function ConsoleNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname() ?? '';
  const current = currentHref(
    pathname,
    groups.flatMap((g) => g.items.map((i) => i.href)),
  );
  // The track scrolls sideways under 800px; the nav around it keeps the
  // background and the rule, so the fade only touches the tabs.
  const navRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState<{ start: boolean; end: boolean }>({
    start: false,
    end: false,
  });

  // Under 800px the current tab (People, Publish) can start off-screen.
  // Bring it into view without animation, and only when the strip
  // overflows: the desktop side nav is left alone.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || nav.scrollWidth <= nav.clientWidth + 1) return;
    const tab = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (!tab) return;
    const box = nav.getBoundingClientRect();
    const rect = tab.getBoundingClientRect();
    const left = rect.left - box.left + nav.scrollLeft;
    const right = left + rect.width;
    // Scroll the strip only (scrollIntoView could scroll the page too).
    if (left < nav.scrollLeft + 16) nav.scrollLeft = left - 16;
    else if (right > nav.scrollLeft + nav.clientWidth - 56)
      nav.scrollLeft = right - nav.clientWidth + 56;
  }, [current]);

  // Which edges have more tabs beyond them, for the fade.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const overflow = nav.scrollWidth > nav.clientWidth + 1;
      const start = overflow && nav.scrollLeft > 2;
      const end =
        overflow && nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2;
      setMore((m) => (m.start === start && m.end === end ? m : { start, end }));
    };
    measure();
    nav.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => {
      nav.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, []);

  if (groups.length === 0) return null;
  return (
    <nav className="console-nav" aria-label="Workspace">
      <div
        ref={navRef}
        className="console-nav-track"
        data-more-start={more.start || undefined}
        data-more-end={more.end || undefined}
      >
        {groups.map((group) => (
          <div key={group.label} className="console-nav-group">
            <p className="console-nav-heading">{group.label}</p>
            <ul aria-label={group.label}>
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
      </div>
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
