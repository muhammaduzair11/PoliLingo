# Contributing to PoliLingo

## You are probably in the wrong repository

This repository is the **application code**. Most contributions are not code.

| You want to                                      | Go to                                                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Correct a phrase, translation or transliteration | [muhammaduzair11/polilingo-content](https://github.com/muhammaduzair11/polilingo-content/issues/new/choose) |
| Offer to record your voice                       | [muhammaduzair11/polilingo-content](https://github.com/muhammaduzair11/polilingo-content/issues/new/choose) |
| Suggest a story, proverb or cultural note        | [muhammaduzair11/polilingo-content](https://github.com/muhammaduzair11/polilingo-content/issues/new/choose) |
| Review a language as a native speaker            | `content/docs/reviewer-checklist.md`                                                                        |
| Report a bug in the app                          | [an issue here](https://github.com/muhammaduzair11/PoliLingo/issues/new/choose)                             |
| Report a security or privacy concern             | [privately](https://github.com/muhammaduzair11/PoliLingo/security/advisories/new)                           |

**You do not need to know how to use git or GitHub to improve the language content.** The
content repository has web forms for every kind of contribution. See
`content/CONTRIBUTING.md`.

---

## If you are working on the code

Full process: `process/how-we-work.md` in the [docs
repository](https://github.com/muhammaduzair11/polilingo-docs). The short version:

1. **Set up your machine** — [`docs/local-setup-windows.md`](docs/local-setup-windows.md)
2. **Branch from `main`** — `feat/`, `fix/`, `chore/`, `docs/` or `spike/` then a short
   description: `feat/speaking-recorder`
3. **Keep it small.** Under about 400 changed lines. A large pull request gets a worse
   review, not a more thorough one.
4. **Run the four gates before pushing:**
   ```powershell
   npm run typecheck ; npm run lint ; npm test ; npm run build
   ```
5. **Title the pull request as a Conventional Commit.** It becomes the commit message on
   `main`, because the repository squash-merges. CI rejects titles that do not match.
   ```
   feat(lesson): add listen-and-repeat recorder to the study card
   fix(progress): stop awarding replay XP twice after a refresh
   ```
6. **Name the deliverable** in the pull request body (`Deliverable: D6`). This is how the
   week-12 evidence pack assembles itself. See `plan/stage1-plan.md` in the docs repository.
7. **One approval, then squash-merge.** Never push to `main`.

---

## Things about this codebase that will surprise you

- **No ESLint, no Prettier, no Jest.** It uses `oxlint`, `oxfmt` and `node --test`. Do not
  add the usual ones — ADR-0011 and ADR-0012 in the docs repository explain why, and name when to reconsider.
- **No environment variables, no database, no server functions** — today. The app is
  static content plus `localStorage`. This changes during Stage 1; see
  [`docs/configuration.md`](docs/configuration.md).
- **Images are pre-baked, not optimised at runtime.** Lossless masters live in
  `assets-src/`, `npm run optimize-assets` generates the AVIF/WebP width ladder into
  `public/assets/`, and that is what ships. Do not add `next/image` runtime optimisation on
  top — it double-compresses.
- **`lib/progress.ts` is pure on purpose.** All learning state logic lives there, with no
  React and no browser APIs, so it can be tested directly. Keep it that way.
- **Native-script text needs `lang` and `dir`.** The `Native` component handles this.
  Rendering Pashto, Hindko or Urdu without it produces subtly wrong text, which for this
  audience is not a cosmetic issue.

---

## Licence and contribution terms

This repository is public but **not open source**. It carries no licence, which means all
rights are reserved: you may read it, but you may not copy, modify or redistribute it.

By submitting a contribution, you agree that your contribution may be used, modified,
published and sublicensed by PoliLingo without restriction or compensation, and you confirm
that you have the right to grant that.

**Content contributions have their own, more explicit terms**, because they involve
language, voice recordings and cultural material belonging to real communities. Those are
set out in `content/CONTRIBUTING.md` and `content/CONSENT-POLICY.md`. Please read them
before contributing anything you did not write yourself.

---

## Code of conduct

Be decent. This project is about people's languages and their communities, and a lot of
contributors will be sharing something personal — how their grandmother says a word,
whether a phrase is really Hindko or actually Punjabi.

Disagreement about language is expected and useful. Dismissiveness about someone's variety
is not. When two native speakers disagree, the answer is usually "both are attested, label
them" rather than "one of you is wrong" — see `content-ops/dialect-policy.md` in the docs repository.
