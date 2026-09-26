import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/account/legal-page';

export const metadata: Metadata = {
  title: 'Privacy notice',
  description:
    'What PoliLingo keeps about you, and what it doesn’t. You don’t need an account to learn.',
};

/*
 * Draft from docs/archive/policy/privacy-policy.md. It must describe only
 * what the system does (supabase/migrations, lib/progress.ts,
 * components/account/*). Change it whenever they change.
 */
export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="YOUR DATA, PLAINLY"
      title="Privacy notice"
      updated="26 September 2026"
      intro={
        <ul className="legal-points">
          <li>
            <strong>You don’t need an account to learn.</strong> Without one,
            your progress stays in your browser and we receive nothing about
            you.
          </li>
          <li>
            <strong>Signing in is optional.</strong> It saves your progress to
            an account so you can carry on from any device.
          </li>
          <li>
            <strong>No advertising and no third-party tracking.</strong> There
            are no analytics tools or ad pixels in PoliLingo.
          </li>
          <li>
            <strong>Your account is yours.</strong> Download everything it
            holds, or delete it, from your{' '}
            <Link href="/account">account page</Link> at any time.
          </li>
        </ul>
      }
    >
      <section aria-labelledby="privacy-anonymous">
        <h2 id="privacy-anonymous">Learning without an account</h2>
        <p>
          Your lessons, streak days, XP, daily goal and settings are kept in
          this browser’s storage on your device. They are not sent to us. You
          can save a copy as a file, or bring one back, in{' '}
          <Link href="/settings">Settings</Link>. Clearing your browser’s data
          removes them.
        </p>
        <p>
          To show you the newest lessons, the app asks our server whether a new
          version of the lessons is out. That request says which version you
          have, and nothing about you or your progress.
        </p>
      </section>

      <section aria-labelledby="privacy-sign-in">
        <h2 id="privacy-sign-in">If you sign in</h2>
        <p>
          <strong>First, your age.</strong> Before any sign-in button, we ask
          for the month and year you were born. We work out your age band (13 to
          17, or 18 and over) and keep only that, never your birthday. If you’re
          under 13, no account is made and nothing is kept. While you sign in,
          the band waits in a cookie on your device for up to 30 minutes; once
          you’re signed in it is saved to your account and the cookie is
          cleared.
        </p>
        <p>
          <strong>Then, one of two ways.</strong> There are no passwords.
        </p>
        <ul>
          <li>
            <strong>Continue with Google.</strong> Google tells us your email
            address, and shares the name and picture on your Google account; our
            sign-in service stores them with your sign-in, and PoliLingo doesn’t
            show or use the name or picture. Google learns that you used your
            Google account to sign in to PoliLingo.
          </li>
          <li>
            <strong>Email me a code.</strong> We email you a 6-digit code to
            type in. Your email address is used to sign you in, and for nothing
            else: no newsletters, no marketing.
          </li>
        </ul>
        <p>
          <strong>What your account holds:</strong>
        </p>
        <ul>
          <li>your email address and your age band;</li>
          <li>
            your saved progress: the lessons you’ve completed (and which version
            of the lessons you first completed them in), how many lessons you
            did on each day by your device’s date, your XP, your daily goal and
            the course you chose;
          </li>
          <li>
            a random ID for each browser you use it on, with the XP that browser
            reported, and a record of each time progress was saved;
          </li>
          <li>
            records of your sign-ins (when, your IP address and your browser)
            that our sign-in service keeps to protect your account;
          </li>
          <li>any team role you have (see below).</li>
        </ul>
        <p>
          <strong>Cookies.</strong> Signing in sets the cookies that keep you
          signed in, and the age-band cookie above. There are no other cookies,
          and no cookie banner, because there is nothing else to agree to.
        </p>
      </section>

      <section aria-labelledby="privacy-team">
        <h2 id="privacy-team">Team members</h2>
        <p>
          Reviewers, editors and admins join by invitation and must be 18 or
          over. For them we also keep a contributor number, a display name,
          their role and its language or variety, and when it starts and ends.
          Admins can record private details (legal name, contact email, phone,
          WhatsApp, region, an agreement reference, a note on how age was
          checked, and notes); only admins and the person themselves can see
          them.
        </p>
        <p>
          Reviews, suggestions, comments and edits are part of each lesson’s
          history, recorded under the contributor number. They stay after a team
          member leaves or deletes their account, so every lesson can show how
          it was checked. Deleting the account removes the private details and
          the link to the email address.
        </p>
      </section>

      <section aria-labelledby="privacy-who">
        <h2 id="privacy-who">Who can see it</h2>
        <p>
          You can see everything your account holds. In the app, admins see team
          members’ details and only totals about learners, such as how many
          accounts there are. The people who run PoliLingo can reach the
          database to keep it working and to fix problems.
        </p>
        <p>We use a few services to run PoliLingo:</p>
        <ul>
          <li>
            <strong>Supabase</strong> stores the database and runs sign-in, in
            its Singapore region.
          </li>
          <li>
            <strong>Vercel</strong> hosts the app. Like any web host, it handles
            your requests, which carry your IP address and browser type.
          </li>
          <li>
            <strong>Google Fonts</strong> serves the app’s typefaces, so Google
            sees your IP address when a page loads them.
          </li>
          <li>
            <strong>Google</strong>, only if you choose to sign in with it.
          </li>
        </ul>
      </section>

      <section aria-labelledby="privacy-keep">
        <h2 id="privacy-keep">How long we keep it, and deleting it</h2>
        <ul>
          <li>
            Your account and what it holds are kept until you delete the
            account.
          </li>
          <li>
            A sign-in that never finished (no age band saved) is deleted after
            24 hours.
          </li>
          <li>
            <strong>Download my data</strong> on your account page gives you
            everything your account holds as a file.
          </li>
          <li>
            <strong>Delete my account</strong> on your account page deletes your
            sign-in, email address, age band and saved progress straight away.
            For team members, it ends their roles and removes their private
            details; their review history stays as described above.
          </li>
        </ul>
      </section>

      <section aria-labelledby="privacy-shared">
        <h2 id="privacy-shared">On a shared device</h2>
        <p>
          Progress on a device belongs to that browser, not to an account.
          Signing out, or deleting your account, never clears it, so the next
          person to use this browser can see it and carry on from it. When you
          finish on a shared device, sign out, and if you want the progress gone
          from it too, use <strong>Reset progress</strong> in{' '}
          <Link href="/settings">Settings</Link> (it clears everything saved in
          this browser).
        </p>
      </section>

      <section aria-labelledby="privacy-children">
        <h2 id="privacy-children">Children</h2>
        <p>
          Anyone can learn without an account. Accounts are for people 13 and
          over; team roles are for adults. If you think a child under 13 has an
          account, tell us and we’ll delete it.
        </p>
      </section>

      <section aria-labelledby="privacy-changes">
        <h2 id="privacy-changes">Changes and contact</h2>
        <p>
          When what PoliLingo does with data changes, this page changes too,
          with a new date at the top. The address for privacy questions and
          requests will be added here before this notice is final.
        </p>
      </section>
    </LegalPage>
  );
}
