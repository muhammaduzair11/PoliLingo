# Changelog

All notable changes to the PoliLingo app, in language a learner or the investor can read.
Written by hand — see `process/engineering-workflow.md` in the docs repository. The format
is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Progress can now be exported to a file and imported back from Settings. Lessons and
  streak days from both are combined; your XP shows the higher of the two totals.

### Changed

- Progress is stored under a new browser key. Your old progress is kept as a backup in
  your browser before anything changes. If the browser cannot make that backup, you can
  keep learning in the tab, and nothing is saved over your old progress.
- Lessons finished in a tab still open on the previous version are brought in the next time
  the app loads.
