# MVP validation

Validated locally on 2026-09-09.

## Automated checks

- TypeScript no-emit check and application lint.
- Ten Node tests cover all 48 exercises, both course unlock sequences, incorrect-answer review, answer ordering, pair matching, reward idempotency, 5-XP replays, local calendar streaks, restoring unfinished feedback, malformed storage, retired-course pruning, and reset defaults.
- Next.js production build completes with all six route patterns.
- Lint excludes the untouched generated component catalog and its mobile helper. The two client state modules document their deliberate post-hydration effects; the application does not enable React Compiler.

## Browser walkthrough

- Completed all six lessons through the real UI, with both first-steps badges and 120 total XP.
- Deliberately answered a Hindko question incorrectly, refreshed, resumed the persisted feedback, then completed the queued review. First-try accuracy correctly reported 88%.
- Replayed Pashto greetings and received 5 XP, bringing the total to 185 rather than another 20-XP award.
- Selected a two-lesson daily goal in onboarding; it persisted in the dashboard.
- Used keyboard Enter to place and remove sentence tiles. Checked radio answers and matching pairs through their accessible controls.
- Changed game sounds, reduced motion, transliteration, and daily goal; preferences survived refresh. With transliteration disabled, the lesson had four native-script lines and zero Roman lines.
- Cancelled the reset dialog, confirmed progress remained, then reset the synthetic test progress. The app returned to one daily lesson, sounds off, transliteration on, and empty progress.
- Inspected desktop (1440px), tablet (768px), and phone (390px) layouts. Long answer text wrapped without horizontal overflow. All homepage illustrations loaded successfully.

## Content boundary

The curriculum is a sourced introductory sample, not a native-teacher-validated course. In particular, Hazara/Abbottabad Hindko requires local speaker review. Pronunciation audio and speech grading remain out of scope for this release.
