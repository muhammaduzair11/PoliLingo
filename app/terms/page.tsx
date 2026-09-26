import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/account/legal-page';

export const metadata: Metadata = {
  title: 'Terms',
  description:
    'The short terms for using PoliLingo, with or without an account.',
};

/*
 * Draft from docs/archive/policy/terms-of-service.md: short enough to read
 * in three minutes. Liability and governing law wait for counsel.
 */
export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="THE SHORT VERSION FIRST"
      title="Terms of use"
      updated="26 September 2026"
      intro={
        <ul className="legal-points">
          <li>
            PoliLingo teaches everyday phrases in short lessons. It helps you
            talk with people; it isn’t a language qualification.
          </li>
          <li>
            You can learn without an account. Accounts are for 13 and over.
          </li>
          <li>
            Be kind to the service and to other people’s accounts, and you can
            leave whenever you like.
          </li>
        </ul>
      }
    >
      <section aria-labelledby="terms-what">
        <h2 id="terms-what">What PoliLingo is</h2>
        <p>
          PoliLingo is a set of short lessons for learning to speak with people
          in their own language. The lessons teach practical phrases. They are
          not a certified course, and finishing one is not a qualification.
          Roman spellings are helpful approximations of how words sound, and
          lessons change and improve over time.
        </p>
      </section>

      <section aria-labelledby="terms-no-account">
        <h2 id="terms-no-account">Learning without an account</h2>
        <p>
          You don’t need to sign up. Your progress is kept in your browser on
          your device, so it is yours to look after: clearing your browser’s
          data removes it. You can save a copy in{' '}
          <Link href="/settings">Settings</Link>.
        </p>
      </section>

      <section aria-labelledby="terms-account">
        <h2 id="terms-account">Accounts</h2>
        <ul>
          <li>An account is optional, and for people 13 and over.</li>
          <li>
            One account is for one person. Keep access to your email or Google
            account safe, because that is how you sign in.
          </li>
          <li>
            You can download your data or delete your account at any time from
            your <Link href="/account">account page</Link>. The{' '}
            <Link href="/privacy">privacy notice</Link> says exactly what that
            removes.
          </li>
        </ul>
      </section>

      <section aria-labelledby="terms-use">
        <h2 id="terms-use">Using PoliLingo fairly</h2>
        <p>Please don’t:</p>
        <ul>
          <li>try to get into anyone else’s account or data;</li>
          <li>disrupt the service, overload it, or get around its security;</li>
          <li>
            copy the lessons in bulk to publish or sell them somewhere else.
          </li>
        </ul>
      </section>

      <section aria-labelledby="terms-team">
        <h2 id="terms-team">If you join the team</h2>
        <p>
          Reviewers, editors and admins join by invitation and must be 18 or
          over. What you write in the workspace (reviews, suggestions, comments
          and edits) becomes part of the lessons and their history, recorded
          under your contributor number, and stays there if you leave. Any
          separate agreement you made with us when you joined applies as well.
        </p>
      </section>

      <section aria-labelledby="terms-content">
        <h2 id="terms-content">The lessons</h2>
        <p>
          The app, its artwork and its lessons are made by the PoliLingo team
          and contributors, drawing on the sources credited in{' '}
          <Link href="/settings">Settings</Link>. You’re welcome to use them to
          learn, and to share links to them.
        </p>
      </section>

      <section aria-labelledby="terms-availability">
        <h2 id="terms-availability">Availability and changes</h2>
        <p>
          We work to keep PoliLingo running, but we can’t promise it will always
          be available, and features may change or pause. We may suspend an
          account that breaks these terms. When these terms change, this page
          shows the new date at the top.
        </p>
      </section>

      <section aria-labelledby="terms-legal">
        <h2 id="terms-legal">Liability and the law that applies</h2>
        <p>
          The limits of our responsibility, and which country’s law governs
          these terms, will be set out here after legal review.
        </p>
      </section>
    </LegalPage>
  );
}
