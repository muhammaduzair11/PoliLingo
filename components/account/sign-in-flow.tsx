'use client';
import Link from 'next/link';
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type SubmitEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { ArrowLeft, ArrowRight, Copy, Mail } from 'lucide-react';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import {
  AGE_BAND_COOKIE,
  BIRTH_PROBLEM_MESSAGES,
  ageBandCookie,
  ageBandFor,
  birthProblem,
  readBirth,
  type AgeBand,
} from '@/lib/age-gate';
import { describeDbError } from '@/lib/db-errors';
import {
  IN_APP_NAMES,
  chromeIntentUrl,
  inAppBrowser,
  platformOf,
  suggestedBrowser,
} from '@/lib/in-app-browser';
import {
  emailLinkCookie,
  emailLinkRedirect,
  newEmailLinkNonce,
  readEmailLinkCookie,
} from '@/lib/safe-next';
import { browserSupabase } from '@/lib/supabase/browser';

type Step =
  | { kind: 'age' }
  | { kind: 'under-13' }
  | { kind: 'choose'; band: AgeBand }
  | { kind: 'code'; band: AgeBand; email: string };

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const RESEND_SECONDS = 60;

/** A sentence for a Supabase Auth refusal. Never the raw text. */
function authMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  const status = (error as { status?: unknown } | null)?.status;
  switch (code) {
    case 'otp_expired':
      return 'That code didn’t work. It may have a typo or be more than an hour old. Try again, or send a new code.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'We’ve sent a few codes already. Please wait a minute, then try again.';
    case 'email_address_invalid':
    case 'validation_failed':
      return 'That doesn’t look like an email address. Check it and try again.';
    case 'email_address_not_authorized':
      return 'We can’t send email to that address yet. Try another one.';
    case 'otp_disabled':
    case 'signup_disabled':
    case 'email_provider_disabled':
    case 'provider_disabled':
      return 'That way of signing in isn’t switched on right now. Please try the other one.';
  }
  if (status === 429)
    return 'That’s a lot of tries in a short time. Please wait a minute, then try again.';
  return describeDbError(error).message;
}

const noSubscribe = () => () => {};

/** navigator.userAgent after hydration, '' on the server. */
function useUserAgent(): string {
  return useSyncExternalStore(
    noSubscribe,
    () => navigator.userAgent,
    () => '',
  );
}

/** Moves focus to a step's heading when the step changes, for screen readers. */
function useFocusOnChange(key: string) {
  const ref = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current?.focus();
  }, [key]);
  return ref;
}

/** A text field's value, or '' (never a File). */
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function clearBandCookie() {
  document.cookie = `${AGE_BAND_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * emailRedirectTo for an email code: ties the email's button to this
 * browser (lib/safe-next.ts EMAIL_LINK_COOKIE). A resend keeps the same
 * value, so the newest email's button works here too.
 */
function emailRedirect(next: string): string {
  const nonce = readEmailLinkCookie(document.cookie) ?? newEmailLinkNonce();
  document.cookie = emailLinkCookie(
    nonce,
    window.location.protocol === 'https:',
  );
  return emailLinkRedirect(window.location.origin, next, nonce);
}

/**
 * The sign-in page's steps (docs/platform.md 4.8): the age question first,
 * always; under 13 ends there with nothing saved; otherwise Google or a
 * 6-digit email code. After the code, the profile gets the declared band
 * and the page does a full navigation to `next`, so the app boots again
 * with the session.
 */
export function SignInFlow({
  next,
  back,
  configured,
  notice,
}: {
  /** Where to go after signing in: already checked by safeNext(). */
  next: string;
  /** "Keep learning" goes here. */
  back: string;
  configured: boolean;
  /** A sentence from the callback, e.g. an expired link. */
  notice?: string | null;
}) {
  const [step, setStep] = useState<Step>({ kind: 'age' });
  const heading = useFocusOnChange(step.kind);

  if (!configured)
    return (
      <Card>
        <p className="eyebrow purple">SAVE YOUR PROGRESS</p>
        <h1 className="signin-title">Accounts aren’t switched on here</h1>
        <p className="signin-lead">
          This copy of PoliLingo can’t sign anyone in yet. Everything else
          works, and your progress stays on this device.
        </p>
        <Link className="button button-purple full-width" href={back}>
          Keep learning <ArrowRight size={19} />
        </Link>
      </Card>
    );

  if (step.kind === 'under-13')
    return (
      <Card>
        <h1 className="signin-title" tabIndex={-1} ref={heading}>
          You can keep learning without an account
        </h1>
        <Link className="button button-purple full-width" href={back}>
          Back to learning <ArrowRight size={19} />
        </Link>
      </Card>
    );

  if (step.kind === 'age')
    return (
      <AgeStep
        notice={notice}
        back={back}
        headingRef={heading}
        onDone={(band) => {
          if (band === 'under-13') {
            // Nothing is kept: not even a band from an earlier try.
            clearBandCookie();
            setStep({ kind: 'under-13' });
            return;
          }
          document.cookie = ageBandCookie(
            band,
            window.location.protocol === 'https:',
          );
          setStep({ kind: 'choose', band });
        }}
      />
    );

  if (step.kind === 'choose')
    return (
      <ChooseStep
        next={next}
        headingRef={heading}
        onCodeSent={(email) =>
          setStep({ kind: 'code', band: step.band, email })
        }
      />
    );

  return (
    <CodeStep
      email={step.email}
      band={step.band}
      next={next}
      onChangeEmail={() => setStep({ kind: 'choose', band: step.band })}
    />
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <section className="signin-card">{children}</section>;
}

// ---------------------------------------------------------------------------
// Step 1: the age question
// ---------------------------------------------------------------------------

/**
 * The birth month and year form. Also used by /account for someone signed
 * in without a profile, with its own eyebrow and without the way out.
 */
export function AgeStep({
  notice,
  back,
  headingRef,
  onDone,
  eyebrow = 'SAVE YOUR PROGRESS · 1 OF 2',
  busy = false,
}: {
  notice?: string | null;
  /** "Keep learning without one" goes here; none when null. */
  back: string | null;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  onDone: (band: AgeBand | 'under-13') => void;
  eyebrow?: string;
  busy?: boolean;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { month, year } = readBirth(
      field(form, 'month'),
      field(form, 'year'),
    );
    const today = new Date();
    const problem = birthProblem(year, month, today);
    if (problem) {
      setError(BIRTH_PROBLEM_MESSAGES[problem]);
      return;
    }
    setError(null);
    onDone(ageBandFor(year, month, today));
  }
  return (
    <Card>
      <p className="eyebrow purple">{eyebrow}</p>
      <h1 className="signin-title" tabIndex={-1} ref={headingRef}>
        First, when were you born?
      </h1>
      <p className="signin-lead">
        Accounts are for people 13 and over. We keep your age band, never your
        birthday.
      </p>
      {notice && <output className="signin-notice">{notice}</output>}
      <form className="signin-form" onSubmit={submit} noValidate>
        <fieldset className="signin-birth">
          <legend className="signin-label">Your birth month and year</legend>
          <div className="signin-birth-fields">
            <label className="signin-field">
              <span>Month</span>
              <select
                name="month"
                className="signin-input"
                autoComplete="bday-month"
                defaultValue=""
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
              >
                <option value="" disabled>
                  Choose…
                </option>
                {MONTHS.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="signin-field">
              <span>Year</span>
              <input
                name="year"
                className="signin-input"
                inputMode="numeric"
                autoComplete="bday-year"
                placeholder="e.g. 2001"
                maxLength={4}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
              />
            </label>
          </div>
        </fieldset>
        <p id={`${id}-error`} className="signin-error" role="alert">
          {error}
        </p>
        <button
          type="submit"
          className="button button-purple full-width"
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? 'Saving…' : 'Continue'} <ArrowRight size={19} />
        </button>
      </form>
      {back && (
        <p className="signin-foot">
          You never need an account to learn.{' '}
          <Link href={back}>Keep learning without one</Link>
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Google, or an email code
// ---------------------------------------------------------------------------

function ChooseStep({
  next,
  headingRef,
  onCodeSent,
}: {
  next: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onCodeSent: (email: string) => void;
}) {
  const id = useId();
  const userAgent = useUserAgent();
  const inApp = inAppBrowser(userAgent);
  const [busy, setBusy] = useState<'google' | 'email' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function google() {
    const supabase = browserSupabase();
    if (!supabase) return;
    setBusy('google');
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      // On success the browser is already leaving for Google.
      if (error) {
        setError(authMessage(error));
        setBusy(null);
      }
    } catch (error) {
      setError(authMessage(error));
      setBusy(null);
    }
  }

  async function email(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = browserSupabase();
    if (!supabase) return;
    const address = field(new FormData(event.currentTarget), 'email')
      .trim()
      .toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      setError('Type your email address, like name@example.com.');
      return;
    }
    setBusy('email');
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: address,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: emailRedirect(next),
        },
      });
      if (error) setError(authMessage(error));
      else onCodeSent(address);
    } catch (error) {
      setError(authMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <p className="eyebrow purple">SAVE YOUR PROGRESS · 2 OF 2</p>
      <h1 className="signin-title" tabIndex={-1} ref={headingRef}>
        Keep your progress on every device
      </h1>
      <p className="signin-lead">
        No password to remember. Your progress on this device stays here either
        way.
      </p>
      {inApp ? (
        <InAppHelp app={IN_APP_NAMES[inApp]} userAgent={userAgent} />
      ) : (
        <>
          <button
            type="button"
            className="button signin-google full-width"
            onClick={google}
            disabled={busy !== null}
            aria-busy={busy === 'google' || undefined}
          >
            <GoogleMark />
            {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
          </button>
          <p className="signin-or" aria-hidden="true">
            <span>or</span>
          </p>
        </>
      )}
      <form className="signin-form" onSubmit={email} noValidate>
        <label className="signin-field" htmlFor={`${id}-email`}>
          <span className="signin-label">Your email</span>
        </label>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          className="signin-input"
          autoComplete="email"
          inputMode="email"
          spellCheck={false}
          placeholder="name@example.com"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-email-hint${error ? ` ${id}-error` : ''}`}
        />
        <p id={`${id}-email-hint`} className="signin-hint">
          We’ll email you a 6-digit code to type in here.
        </p>
        <p id={`${id}-error`} className="signin-error" role="alert">
          {error}
        </p>
        <button
          type="submit"
          className={`button full-width ${inApp ? 'button-purple' : 'button-outline'}`}
          disabled={busy !== null}
          aria-busy={busy === 'email' || undefined}
        >
          <Mail size={18} />
          {busy === 'email' ? 'Sending your code…' : 'Email me a code'}
        </button>
      </form>
      <p className="signin-small">
        By signing in you agree to the <Link href="/terms">terms</Link>. Read
        what we keep in the <Link href="/privacy">privacy notice</Link>.
      </p>
    </Card>
  );
}

/** Inside WhatsApp, Instagram or Facebook: how to reach a real browser. */
function InAppHelp({ app, userAgent }: { app: string; userAgent: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const browser = suggestedBrowser(userAgent);
  const android = platformOf(userAgent) === 'android';
  const href = typeof window === 'undefined' ? '' : window.location.href;
  const intent = android ? chromeIntentUrl(href) : null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(`Link copied. Paste it into ${browser}.`);
    } catch {
      setCopied(
        `Copy this page’s address from the menu, then open it in ${browser}.`,
      );
    }
  }
  return (
    <div className="signin-inapp" role="note">
      <p className="signin-inapp-title">
        Google sign-in doesn’t work inside {app}
      </p>
      <p>
        Open this page in {browser}: use the menu (⋮ or ⋯) and choose “Open in
        browser”. Or use your email below. It works right here.
      </p>
      <div className="signin-inapp-actions">
        {intent && (
          <a className="button button-small button-purple" href={intent}>
            Open in Chrome
          </a>
        )}
        <button
          type="button"
          className="button button-small button-outline"
          onClick={copy}
        >
          <Copy size={16} /> Copy link
        </button>
      </div>
      <output className="signin-hint">{copied}</output>
    </div>
  );
}

/** Google's "G", as its sign-in button guidelines ask. */
function GoogleMark() {
  return (
    <svg
      className="signin-google-mark"
      viewBox="0 0 48 48"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Step 3: the 6-digit code
// ---------------------------------------------------------------------------

function CodeStep({
  email,
  band,
  next,
  onChangeEmail,
}: {
  email: string;
  band: AgeBand;
  next: string;
  onChangeEmail: () => void;
}) {
  const id = useId();
  const [code, setCode] = useState('');
  const otp = useRef<HTMLInputElement>(null);
  // Straight to the code field: its label and the line above it are read out.
  useEffect(() => {
    otp.current?.focus();
  }, []);
  const [busy, setBusy] = useState<'verify' | 'resend' | 'finish' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [sentAt, setSentAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const wait = Math.max(0, RESEND_SECONDS - Math.floor((now - sentAt) / 1000));

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [wait]);

  /** Saves the declared band, then leaves for `next` with a full navigation. */
  async function finish() {
    const supabase = browserSupabase();
    if (!supabase) return;
    setBusy('finish');
    setError(null);
    try {
      const { error } = await supabase.rpc('ensure_profile', {
        p_age_band: band,
      });
      if (error) throw error;
    } catch (error) {
      // Signed in, but the band is not saved: "Try again" repeats this step.
      setError(describeDbError(error).message);
      setBusy(null);
      return;
    }
    clearBandCookie();
    setStatus('You’re signed in. Taking you back…');
    window.location.assign(next);
  }

  async function verify(value = code) {
    const supabase = browserSupabase();
    if (!supabase || busy || value.length !== 6) return;
    setBusy('verify');
    setError(null);
    setStatus(null);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: value,
        type: 'email',
      });
      if (error) {
        setError(authMessage(error));
        setCode('');
        setBusy(null);
        return;
      }
    } catch (error) {
      setError(authMessage(error));
      setBusy(null);
      return;
    }
    setSignedIn(true);
    await finish();
  }

  async function resend() {
    const supabase = browserSupabase();
    if (!supabase || busy || wait > 0) return;
    setBusy('resend');
    setError(null);
    setStatus(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: emailRedirect(next),
        },
      });
      if (error) setError(authMessage(error));
      else {
        setSentAt(Date.now());
        setNow(Date.now());
        setCode('');
        setStatus('A new code is on its way. Use the newest one.');
      }
    } catch (error) {
      setError(authMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <p className="eyebrow purple">CHECK YOUR EMAIL</p>
      <h1 className="signin-title">Type the code we sent you</h1>
      <p className="signin-lead" id={`${id}-sent`}>
        We emailed a 6-digit code to{' '}
        <strong className="signin-email">{email}</strong>. It can take a minute
        to arrive, so check your spam folder too.
      </p>
      <form
        className="signin-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (signedIn) void finish();
          else void verify();
        }}
      >
        <p id={`${id}-label`} className="signin-label">
          Your 6-digit code
        </p>
        <InputOTP
          maxLength={6}
          value={code}
          onChange={(value) => {
            setCode(value);
            if (error) setError(null);
          }}
          onComplete={(value: string) => void verify(value)}
          pattern={REGEXP_ONLY_DIGITS}
          inputMode="numeric"
          autoComplete="one-time-code"
          ref={otp}
          disabled={busy === 'verify' || busy === 'finish' || signedIn}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-sent${error ? ` ${id}-error` : ''}`}
          containerClassName="signin-otp"
        >
          <InputOTPGroup className="signin-otp-group">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <InputOTPSlot
                key={index}
                index={index}
                className="signin-otp-slot"
                aria-invalid={error ? true : undefined}
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
        <p id={`${id}-error`} className="signin-error" role="alert">
          {error}
        </p>
        <output className="signin-hint">{status}</output>
        <button
          type="submit"
          className="button button-purple full-width"
          disabled={busy !== null || (!signedIn && code.length !== 6)}
          aria-busy={busy === 'verify' || busy === 'finish' || undefined}
        >
          {busy === 'verify'
            ? 'Checking…'
            : busy === 'finish'
              ? 'Signing you in…'
              : signedIn
                ? 'Try again'
                : 'Sign in'}
        </button>
      </form>
      <div className="signin-code-help">
        <button
          type="button"
          className="signin-text-button"
          onClick={resend}
          disabled={busy !== null || wait > 0 || signedIn}
        >
          {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
        </button>
        <button
          type="button"
          className="signin-text-button"
          onClick={onChangeEmail}
          disabled={busy !== null || signedIn}
        >
          <ArrowLeft size={15} /> Use a different email
        </button>
      </div>
    </Card>
  );
}
