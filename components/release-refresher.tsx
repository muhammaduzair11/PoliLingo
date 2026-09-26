'use client';
/**
 * STUB (foundation). Track G replaces this with the release refresher
 * (docs/platform.md 4.7): mounted once by LearningProvider, it asks
 * /api/release for a newer verified learner copy after the app is ready, on
 * visibilitychange to visible, on online and every 60 s while visible,
 * stores it, and calls the provider's refreshContent(name) (waiting while a
 * lesson is open). Until then the baseline release is all there is.
 */
export function ReleaseRefresher() {
  return null;
}
