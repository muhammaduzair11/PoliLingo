import type { ReactNode } from 'react';
import { FileText } from 'lucide-react';
import { Footer, Header } from '../site-chrome';

/**
 * The frame for /privacy and /terms: the site header and footer, a draft
 * banner that stays until counsel has reviewed the text, and a readable
 * column. Static: no account code, nothing from Supabase.
 */
export function LegalPage({
  eyebrow,
  title,
  updated,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  /** e.g. "26 September 2026" */
  updated: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <Header />
      <main id="main-content" className="legal-page section-wrap">
        <p className="legal-banner" role="note">
          <FileText size={18} aria-hidden="true" />
          <span>
            <strong>Draft — pending legal review.</strong> It describes what
            PoliLingo does today. A lawyer will review it before it becomes
            final.
          </span>
        </p>
        <p className="eyebrow purple">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="legal-updated">Last updated {updated}</p>
        <div className="legal-intro">{intro}</div>
        <div className="legal-body">{children}</div>
      </main>
      <Footer />
    </>
  );
}
