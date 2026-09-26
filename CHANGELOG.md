# Changelog

All notable changes to the PoliLingo app, in language a learner or the investor can read.
Written by hand — see `process/engineering-workflow.md` in the docs repository. The format
is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Progress can now be exported to a file and imported back from Settings. Lessons and
  streak days from both are combined; your XP shows the higher of the two totals.

- Settings shows which content release the app was built from, and credits where each
  language's phrases come from.

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
