import type { Metadata } from 'next';
/* oxlint-disable next/no-page-custom-font -- These fonts load globally in the App Router root layout, not an individual Pages Router page. */
import { LearningProvider } from '@/components/learning-provider';
import './globals.css';
export const metadata: Metadata = {
  title: {
    default: 'PoliLingo — A little daily. A lot more connection.',
    template: '%s · PoliLingo',
  },
  description:
    'Find your words. Find your people. Learn Pashto and Hindko in small, playful lessons with Poli, your little adventure buddy.',
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
        <LearningProvider>{children}</LearningProvider>
      </body>
    </html>
  );
}
