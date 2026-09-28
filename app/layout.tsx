import type { Metadata } from 'next';
/* oxlint-disable next/no-page-custom-font -- These fonts load globally in the App Router root layout, not an individual Pages Router page. */
import { AccountBoot } from '@/components/account-boot';
import { LearningProvider } from '@/components/learning-provider';
import { courses } from '@/lib/content';
import { SITE_URL } from '@/lib/site';
import { listJoin } from '@/lib/words';
import './globals.css';
// Names only the languages the content release holds.
const description = `Find your words. Find your people. Learn ${listJoin(courses.map((c) => c.name))} in small, playful lessons with Poli, your little adventure buddy.`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'PoliLingo — A little daily. A lot more connection.',
    template: '%s · PoliLingo',
  },
  description,
  applicationName: 'PoliLingo',
  // The preview a shared link shows (app/opengraph-image.png, app/twitter-image.png).
  openGraph: {
    type: 'website',
    siteName: 'PoliLingo',
    title: 'PoliLingo — A little daily. A lot more connection.',
    description,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PoliLingo — A little daily. A lot more connection.',
    description,
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;600;700&family=Outfit:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <LearningProvider>
          {children}
          <AccountBoot />
        </LearningProvider>
      </body>
    </html>
  );
}
