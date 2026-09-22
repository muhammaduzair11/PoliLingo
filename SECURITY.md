# Security policy

## Supported versions

PoliLingo is a continuously deployed web application. Only the version currently live at
<https://poli-lingo.vercel.app> is supported. Tagged releases are historical records, not
maintained branches.

## Reporting a vulnerability

**Please do not open a public issue.**

Use GitHub's private vulnerability reporting:
<https://github.com/muhammaduzair11/PoliLingo/security/advisories/new>

Tell us:

- what you found, and where — a URL, an endpoint, or a file
- how to reproduce it
- what someone could actually do with it

We will acknowledge within **3 working days** and give you an assessment within **10
working days**. We are a two-person team; please be patient, and please do not disclose
publicly until we have shipped a fix or 90 days have passed.

## Reporting a privacy or consent concern

This project records people's voices and publishes their language. That creates a category
of concern that is not a software vulnerability, and it is taken just as seriously.

If a recording of your voice, your name, or other personal information appears in PoliLingo
and you did not agree to it, or you agreed and have changed your mind, contact us and we
will remove it from the live application within **5 working days** and confirm in writing.

Voice contributors may withdraw consent at any time. See `CONSENT-POLICY.md` in the
`content` repository for what withdrawal means in practice, including deletion of the
original master recordings.

## Scope

**In scope:** the PoliLingo web application, its Supabase backend, and its media delivery.

**Out of scope:** denial-of-service testing, social engineering of our contributors or
voice talent, physical attacks, and automated scanner output with no demonstrated impact.

## Things that look like vulnerabilities and are not

- **The Supabase anonymous key is in the JavaScript bundle.** It is designed to be public.
  It identifies the project and authorises nothing on its own; access is controlled by Row
  Level Security policies. If you can use it to read or write data you should not be able
  to, _that_ is a real finding and we would very much like to hear about it.
- **The repository is public and has no licence.** Deliberate. Public is not open source —
  no licence means all rights reserved.
- **Learner progress is in `localStorage` and readable by the user.** By design. It is
  their own progress, on their own device.

## Safe harbour

We will not pursue action against researchers who act in good faith, stay within scope,
avoid privacy violations and service degradation, and give us reasonable time to fix
issues before disclosure.
