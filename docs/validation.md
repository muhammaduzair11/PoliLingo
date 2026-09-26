# MVP validation

Validated locally on 2026-09-09.

## Automated checks

- TypeScript no-emit check and application lint.
- Sixty-six Node tests cover the committed learner copy (its content hash recomputed as the content build computes it, byte-for-byte serialisation, only learner-copy fields, no Hindko language, id or keymap row, a file of another format refused), invariants every release must keep rather than seed counts (every course shown with lessons, permanent ids, sourced phrases, exercises using only their own lesson's phrases, every exercise accepting its answer and rejecting wrong ones, answer-slot variety, a keymap naming only what the copy holds), release names and the production build refusing a development release, the redirects (one temporary pattern for a language the copy does not hold, matched by Next.js's own matcher, and a permanent redirect per keymap row to a lesson in the release), every visible course's unlock sequence and the XP of a full clear, incorrect-answer review, answer ordering, pair matching, reward idempotency, 5-XP replays, local calendar streaks, restoring unfinished feedback, malformed storage, reset defaults, XP, streak, award ledger and completions surviving a release that changes a lesson's exercise count or retires a lesson, an unfinished run the release no longer fits being dropped while finished runs are kept, MVP keys the keymap does not map being kept as they are, an MVP key kept while a release did not map it moving to its permanent id once one does (an entry already under that id winning), an unreadable live record being kept aside under a new `invalid-` key before a fresh start (and not written over when that copy fails), old exports from v0.2 or an older release importing, the three reasons an import is refused, each completion recording the content release it was first completed in (`mvp` for v1 and v2, and for an early export's `true`) through replays, merges and export, the v1-to-v2-to-v3 migration of a blob written by the MVP's own code and its verbatim backup, merging back a second blob the MVP's own code wrote to v1 during a rollback, a lesson finished and started again elsewhere replacing the unfinished copy so it can still be finished, a v1 blob this build cannot read being left for a build that can, a reset staying reset across reloads, the v2 state written by v0.2's own code moving to its own v3 key while v2 is never written again, a rollback of one deploy finding v2 intact and what v0.2 wrote there being merged back, a reset staying reset beside the v2 key, a reset staying reset when a rollback only opens v0.2 where there was no v2 key (a blob written by v0.2's own code) while what v0.2 adds there is still merged back, unknown-version stashing with and without a v1 blob beside it, a newer blob in any key kept aside once and never over another, hydration that never writes the live key after a failed backup or stash, storage that cannot be read at all or fails part-way through reading, an ID generator that throws or has no `crypto.randomUUID`, and the export/import merge and its idempotency. `tests/screens.test.mjs` covers what the screens decide: the remembered course resolved when it is read (nothing chosen, a language the release does not hold and an unknown slug all give no course, and a stored Hindko choice stays as it is), a lesson the release no longer holds opening its course's map while an unknown course stays not found, each course's variety id and display-only label, course progress for one, three and eight lessons (a retired lesson's completion never finishes a course, a new lesson un-finishes it), the map path identical to the original drawing for three lessons and ending at the trophy, across and down, for any count, stop icons and positions, the credits line covering every phrase, the landing page's try-it question taken from a course and lesson the release holds (Urdu while it is there, otherwise another course, and no card without a question), and count wording.
- Next.js production build completes with all six route patterns.
- Lint excludes the untouched generated component catalog and its mobile helper. The two client state modules document their deliberate post-hydration effects; the application does not enable React Compiler.

## Browser walkthrough (the MVP: nine lessons of eight exercises)

- Completed all nine lessons through the real UI, with all three first-steps badges and 180 total XP.
- Deliberately answered an Urdu question incorrectly, refreshed, resumed the persisted feedback, then completed the queued review. First-try accuracy correctly reported 88%.
- Replayed Pashto greetings and received 5 XP, bringing the total to 185 rather than another 20-XP award.
- Selected a two-lesson daily goal in onboarding; it persisted in the dashboard.
- Used keyboard Enter to place and remove sentence tiles. Checked radio answers and matching pairs through their accessible controls.
- Changed game sounds, reduced motion, transliteration, and daily goal; preferences survived refresh. With transliteration disabled, the lesson had four native-script lines and zero Roman lines.
- Cancelled the reset dialog, confirmed progress remained, then reset the synthetic test progress. The app returned to one daily lesson, sounds off, transliteration on, and empty progress.
- Inspected desktop (1440px), tablet (768px), and phone (390px) layouts. Long Urdu answer text wrapped without horizontal overflow. All homepage illustrations loaded successfully.

## Returning learners, the learning map and learner-facing copy

Checked on 2026-09-25 against `next build` and `next start`, in a browser at 1440, 1280 and 390px wide:

- **A returning Hindko learner.** Starting from `/` with a v1 record holding `selected: 'hindko'`, a Hindko completion and a Pashto one: the home page showed no "Welcome back", the header button read "Let's go" and led to the language picker, and the landing page offered only Pashto and Urdu ("TWO LANGUAGES"). The v3 record kept `selected: 'hindko'` and `hindko/greetings`. `/learn` replaced itself with `/#languages` and wrote nothing; `/settings` linked back to `/`. `/learn/hindko` answered 307 to `/learn`. Opening `/learn/pashto` then made Pashto the learner's course, and the header read "Keep going".
- **The learning map.** With the committed release (three lessons a course) the map's path, its viewBox and the area's height were exactly as before. Built against a temporary release with eight Pashto lessons and one Urdu lesson (not committed): eight stops cycled through the three positions and the path ran from the first stop to the trophy; one lesson gave a short map, "One lesson. A whole new beginning.", "1 of 1 lesson completed" and the badge. At 390px there was no horizontal scroll. Review later found that for every count but three and six the path ended about a tenth of the map to the left of the trophy rather than at it; `mapPath()` now ends every path at the trophy's x, which the unit test checks. Look at a one- and an eight-lesson map again in the next release pass.
- **The language cards.** Two cards kept their three-up width and were centred; at 390px they stacked at full width.
- **The meta description** read "Learn Pashto and Urdu".
- The Browser pane used for this was hidden, and a hidden page does not run smooth scrolling, so the scroll to `#languages` was confirmed with smooth scrolling switched off. Confirm it in a visible browser in the release pass.

Before each release, repeat the returning-Hindko-learner check: in a fresh profile, set `localStorage['polilingo.progress.v1']` to a v1 record with `selected: 'hindko'` (or use the v3 key), load `/`, and check the points above, including that `/learn` lands on the language picker and that `selected` is still `hindko` afterwards.

And check the copy. Screens must never tell learners about the state of the content:

```sh
grep -rniE --include='*.ts' --include='*.tsx' "demo|sample|review|introductory|coming soon|hindko" components app lib
```

Every hit must be a comment, a class name, a variable or `lib/` code, never text a learner sees.

## Content boundary

The phrases in the committed release are demo data: the MVP's seed phrases, researched from websites and live for testing until reviewed content replaces them (`plan/stage1-plan.md` in the docs repository). "Demo" is internal and never shown in the app. Hindko is not in the release and not shown until it has been reviewed. Pronunciation audio and speech grading remain out of scope for this release.
