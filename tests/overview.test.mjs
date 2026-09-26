// lib/console/overview.ts: page_admin_overview() as the cards and rows the
// admin overview shows, with the reviewed count never padded.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activityBars,
  buildOverview,
  formatCount,
  languageCard,
  pipelineSteps,
  reviewedLine,
  targetProgress,
  varietyRow,
} from '../lib/console/overview.ts';

const TARGET = { min: 250, max: 400 };

const PASHTO = {
  code: 'ps',
  name: 'Pashto',
  native_name: 'پښتو',
  direction: 'rtl',
  publish_gate: 'open',
  demo_period: { sunset: '2026-12-11', live: true },
  lessons: 3,
  items: 10,
  demo: 4,
  draft: 1,
  in_review: 2,
  changes_requested: 1,
  reviewed: 2,
  approved_waiting: 2,
  live: 4,
  reviewed_live: 0,
  demo_live: 4,
  gated: 0,
};

const HINDKO = {
  ...PASHTO,
  code: 'hno',
  name: 'Hindko',
  native_name: 'ہندکو',
  publish_gate: 'blocked',
  demo_period: { sunset: '2026-12-11', live: false },
  lessons: 0,
  items: 0,
  demo: 0,
  draft: 0,
  in_review: 0,
  changes_requested: 0,
  reviewed: 0,
  approved_waiting: 0,
  live: 0,
  reviewed_live: 0,
  demo_live: 0,
  gated: 0,
};

/** page_admin_overview() on the seeded fixture (tests/db/people.test.mjs). */
const FIXTURE = {
  generated_at: '2026-09-28T09:00:00Z',
  target: { reviewed_target_min: 250, reviewed_target_max: 400 },
  latest_release: {
    name: 'content@2026.09.1',
    kind: 'seed',
    published_at: '2026-09-27T10:00:00Z',
    lessons: 2,
    items: 4,
  },
  languages: [
    HINDKO,
    {
      ...PASHTO,
      lessons: 2,
      items: 4,
      draft: 0,
      in_review: 0,
      changes_requested: 0,
      reviewed: 0,
      approved_waiting: 0,
    },
  ],
  varieties: [
    {
      id: 'hno-var-hazara',
      language: 'hno',
      language_name: 'Hindko',
      name: 'Hazara Hindko',
      publish_gate: 'blocked',
      reviewers: 1,
      reviewer_names: ['Local Hindko Reviewer'],
    },
    {
      id: 'ps-var-fixture',
      language: 'ps',
      language_name: 'Pashto',
      name: 'Fixture variety',
      publish_gate: 'open',
      reviewers: 0,
      reviewer_names: [],
    },
    {
      id: 'ps-var-yusufzai',
      language: 'ps',
      language_name: 'Pashto',
      name: 'Northern Pashto (Peshawar / Yusufzai)',
      publish_gate: 'open',
      reviewers: 2,
      reviewer_names: ['Local Pashto Reviewer 2', 'Local Pashto Reviewer'],
    },
  ],
  accounts: {
    total: 8,
    adults: 7,
    active_7d: 0,
    learners_with_completion: 0,
    completions: 0,
    team: 5,
    activity_7d: [
      { date: '2026-09-22', accounts: 0 },
      { date: '2026-09-23', accounts: 0 },
      { date: '2026-09-24', accounts: 0 },
      { date: '2026-09-25', accounts: 0 },
      { date: '2026-09-26', accounts: 0 },
      { date: '2026-09-27', accounts: 0 },
      { date: '2026-09-28', accounts: 0 },
    ],
  },
};

test('the honest line shows the reviewed count next to the target', () => {
  assert.equal(
    reviewedLine(0, 250, 400),
    'Reviewed items: 0 — target 250–400 per language',
  );
  assert.equal(
    reviewedLine(1234, 250, 400),
    'Reviewed items: 1,234 — target 250–400 per language',
  );
  assert.equal(formatCount(Number.NaN), '0');
});

test('starter phrases never count as reviewed', () => {
  const card = languageCard(PASHTO, TARGET);
  assert.equal(card.reviewed, 2);
  assert.equal(
    card.reviewedLine,
    'Reviewed items: 2 — target 250–400 per language',
  );
  assert.deepEqual(card.live, { total: 4, reviewed: 0, demo: 4 });
  assert.equal(
    card.demoNote,
    '4 starter phrases fill in until reviewed lessons replace them (by 11 Dec 2026 at the latest).',
  );
});

test('progress runs against the lower target and stops at full', () => {
  assert.equal(targetProgress(0, 250), 0);
  assert.equal(targetProgress(125, 250), 0.5);
  assert.equal(targetProgress(900, 250), 1);
  assert.equal(targetProgress(10, 0), 0);
  assert.equal(targetProgress(-3, 250), 0);
  assert.equal(
    languageCard({ ...PASHTO, reviewed: 0 }, TARGET).progressLabel,
    '250 more to reach 250',
  );
  assert.equal(
    languageCard({ ...PASHTO, reviewed: 240 }, TARGET).progressLabel,
    '10 more to reach 250',
  );
  assert.equal(
    languageCard({ ...PASHTO, reviewed: 300 }, TARGET).progressLabel,
    'Past 250: on the way to 400',
  );
  assert.equal(
    languageCard({ ...PASHTO, reviewed: 400 }, TARGET).progressLabel,
    'Target reached',
  );
});

test('the pipeline runs from writing to live, in order', () => {
  const steps = pipelineSteps(PASHTO);
  assert.deepEqual(
    steps.map((s) => [s.key, s.value]),
    [
      ['draft', 1],
      ['in_review', 2],
      ['changes_requested', 1],
      ['waiting', 2],
      ['live', 0],
    ],
  );
  assert.equal(steps[3].label, 'Approved, waiting to publish');
  assert.ok(steps.every((s) => s.label && s.hint));
});

test('a language behind a closed gate is marked hidden, with no demo note when it has none', () => {
  const card = languageCard(HINDKO, TARGET);
  assert.equal(card.hidden, true);
  assert.equal(card.demoNote, null);
  assert.equal(card.dir, 'rtl');
  assert.equal(card.nativeName, 'ہندکو');
  assert.equal(
    languageCard({ ...PASHTO, demo_live: 0, demo: 3 }, TARGET).demoNote,
    '3 starter phrases are kept but no longer shown.',
  );
  assert.equal(
    languageCard(
      { ...PASHTO, demo_live: 1, demo: 1, demo_period: null },
      TARGET,
    ).demoNote,
    '1 starter phrase fills in until reviewed lessons replace it.',
  );
});

test('starter phrases that were never shown are not described as no longer shown', () => {
  // Hindko's starter period never goes live.
  assert.equal(
    languageCard({ ...HINDKO, demo: 5 }, TARGET).demoNote,
    '5 starter phrases are never shown to learners; only reviewed phrases go live.',
  );
  // Before the first release, nothing has been shown yet.
  assert.equal(
    languageCard({ ...PASHTO, demo_live: 0, demo: 1 }, TARGET, false).demoNote,
    '1 starter phrase waits for the first release.',
  );
  const unreleased = buildOverview({
    ...FIXTURE,
    latest_release: null,
    languages: [{ ...PASHTO, live: 0, demo_live: 0, demo: 3 }],
  });
  assert.equal(
    unreleased.languages[0].demoNote,
    '3 starter phrases wait for the first release.',
  );
});

test('reviewer coverage per variety: none, one, or enough to check each other', () => {
  const [hno, fixture, ps] = FIXTURE.varieties.map(varietyRow);
  assert.equal(fixture.coverage, 'none');
  assert.match(fixture.note, /Invite one/);
  assert.equal(hno.coverage, 'sole');
  assert.match(hno.note, /countersign/);
  assert.equal(ps.coverage, 'ok');
  assert.deepEqual(ps.names, [
    'Local Pashto Reviewer',
    'Local Pashto Reviewer 2',
  ]);
  assert.equal(ps.languageName, 'Pashto');
});

test('activity bars scale to the busiest day and read as days', () => {
  const bars = activityBars([
    { date: '2026-09-27', accounts: 2 },
    { date: '2026-09-28', accounts: 4 },
    { date: 'bad', accounts: 0 },
  ]);
  assert.deepEqual(
    bars.map((b) => [b.day, b.height]),
    [
      ['Sun', 50],
      ['Mon', 100],
      ['bad', 0],
    ],
  );
  assert.equal(bars[1].label, 'Mon 28 Sep');
  assert.deepEqual(
    activityBars([{ date: '2026-09-28', accounts: 0 }]).map((b) => b.height),
    [0],
  );
  assert.deepEqual(activityBars(null), []);
});

test('the whole overview on the seeded fixture', () => {
  const view = buildOverview(FIXTURE);
  assert.deepEqual(view.release, {
    name: 'content@2026.09.1',
    publishedLabel: '27 Sep 2026',
    lessons: 2,
    items: 4,
    kindLabel: 'First release',
  });
  assert.deepEqual(view.target, TARGET);
  assert.deepEqual(
    view.languages.map((l) => [l.code, l.reviewed, l.live.total, l.hidden]),
    [
      ['hno', 0, 0, true],
      ['ps', 0, 4, false],
    ],
  );
  assert.deepEqual(view.totals, {
    reviewed: 0,
    inReview: 0,
    waiting: 0,
    live: 4,
  });
  assert.equal(view.varieties.length, 3);
  assert.equal(view.accounts.total, 8);
  assert.equal(view.accounts.team, 5);
  assert.equal(view.accounts.activity.length, 7);
});

test('staff who are not admins get no accounts section, and no release is fine', () => {
  const view = buildOverview({
    ...FIXTURE,
    accounts: null,
    latest_release: null,
  });
  assert.equal(view.accounts, null);
  assert.equal(view.release, null);
});
