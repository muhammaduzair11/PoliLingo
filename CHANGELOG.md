# Changelog

All notable changes to the PoliLingo app, in language a learner or the investor can read.
Written by hand — see `process/engineering-workflow.md` in the docs repository. The format
is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- You can now sign in to keep your progress safe, with Google or a 6-digit code sent to
  your email. It is optional: you can still learn without an account, exactly as before.
  We ask your birth year and month first; if you are under 13, you keep learning without an
  account.
- Signed in, your lessons, XP and streak save to your account as you learn and come back
  on any device you sign in on. Progress on your device is never deleted: not when you sign
  in, sign out, switch accounts or delete your account. If a device already saved to a
  different account, the app asks before adding its progress to yours.
- Your account page shows what is saved, lets you download a copy of your data, and lets
  you delete your account.
- After a lesson, if you have a streak of two days or more, the app offers to save it by
  signing in. You can dismiss it.
- New and corrected lessons now reach you without an app update. When the team publishes,
  an open app picks them up within about a minute, and never in the middle of a lesson.
- For the PoliLingo team: an invitation-only workspace. Reviewers check phrases and lessons
  for their own language and variety, approve them, ask for changes or suggest a fix.
  Editors write and arrange lessons and generate exercises. Admins invite people with a
  one-time link, see how each language is progressing, publish a new release after seeing
  exactly what will change, and can bring back an earlier release.
- Draft privacy notice and terms, at /privacy and /terms, pending legal review.

- Progress can now be exported to a file and imported back from Settings. Lessons and
  streak days from both are combined; your XP shows the higher of the two totals.

- Settings shows which content release you are using, which can be newer than the app
  itself, and credits where each language's phrases come from.

### Changed

- Lessons now come from the content repository's release rather than from code, with
  permanent ids: a lesson's address no longer changes when lessons are reordered. Existing
  progress is carried across on first load; an unfinished lesson starts again, because the
  exercises themselves changed.
- Each lesson has its own number of exercises, and the answer is no longer always in the
  same place.
- Hindko is not shown for now. Progress you already made on it is kept, and old Hindko
  links go to /learn instead of a missing page. If Hindko was your language, the app offers
  the language picker rather than a missing page or another language, and your choice is
  kept.
- With no language chosen yet, /learn shows the language picker instead of opening Pashto.
- The learning map, the language cards and onboarding count the lessons each course really
  has, so a course of one lesson or eight reads and draws correctly. The language cards stay
  the same size and are centred when there are fewer than three.
- Old lesson links, such as /lesson/pashto/greetings, still work: they go to the same lesson
  at its new address. A link to a lesson that is no longer offered opens its course's map
  instead of a missing page.
- The "try it" question on the home page comes from the lessons themselves, so it only ever
  shows a language the app offers.
- Progress is stored under a new browser key. Your old progress is kept as a backup in
  your browser before anything changes. If the browser cannot make that backup, you can
  keep learning in the tab, and nothing is saved over your old progress.
- Lessons finished in a tab still open on the previous version are brought in the next time
  the app loads.
- Changing a lesson never deletes your progress. If a lesson gains or loses exercises, or is
  retired, your XP and streak stay and your completions are kept, and a completed lesson
  that comes back shows as completed again. A course's badge and lesson count reflect the
  lessons it has now, and only a lesson you had left part-way starts again.
- Each completed lesson now remembers the content release it was first completed in, and
  exported progress files carry it.
- A progress file from an earlier version imports. One that cannot be imported now says
  why, instead of always saying it is not a progress file.
- Signed in, Reset clears your progress on this device only. Your account keeps its copy,
  and it comes back the next time your progress saves.
