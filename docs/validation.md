# MVP validation

Validated locally on 2026-09-09.

## Automated checks

- TypeScript no-emit check and application lint.
- Twenty-five Node tests cover all 72 exercises, all three course unlock sequences, incorrect-answer review, answer ordering, pair matching, reward idempotency, 5-XP replays, local calendar streaks, restoring unfinished feedback, malformed storage, reset defaults, the v1-to-v2 migration of a blob written by the MVP's own code and its verbatim backup, merging back a second blob the MVP's own code wrote to v1 during a rollback, a lesson finished and started again elsewhere replacing the unfinished copy so it can still be finished, a v1 blob this build cannot read being left for a build that can, a reset staying reset across reloads, unknown-version stashing with and without a v1 blob beside it, hydration that never writes the live key after a failed backup or stash, storage that cannot be read at all or fails part-way through reading, an ID generator that throws or has no `crypto.randomUUID`, and the export/import merge and its idempotency.
- Next.js production build completes with all six route patterns.
- Lint excludes the untouched generated component catalog and its mobile helper. The two client state modules document their deliberate post-hydration effects; the application does not enable React Compiler.

## Browser walkthrough

- Completed all nine lessons through the real UI, with all three first-steps badges and 180 total XP.
- Deliberately answered an Urdu question incorrectly, refreshed, resumed the persisted feedback, then completed the queued review. First-try accuracy correctly reported 88%.
- Replayed Pashto greetings and received 5 XP, bringing the total to 185 rather than another 20-XP award.
- Selected a two-lesson daily goal in onboarding; it persisted in the dashboard.
- Used keyboard Enter to place and remove sentence tiles. Checked radio answers and matching pairs through their accessible controls.
- Changed game sounds, reduced motion, transliteration, and daily goal; preferences survived refresh. With transliteration disabled, the lesson had four native-script lines and zero Roman lines.
- Cancelled the reset dialog, confirmed progress remained, then reset the synthetic test progress. The app returned to one daily lesson, sounds off, transliteration on, and empty progress.
- Inspected desktop (1440px), tablet (768px), and phone (390px) layouts. Long Urdu answer text wrapped without horizontal overflow. All homepage illustrations loaded successfully.

## Content boundary

The curriculum is a sourced introductory sample, not a native-teacher-validated course. In particular, Hazara/Abbottabad Hindko requires local speaker review. Pronunciation audio and speech grading remain out of scope for this release.
