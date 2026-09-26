// lib/console/review.ts: the review screens' pure logic. The scope rules
// here must match the database's private.review_required_scope() and
// record_review_decision() (tests/db/review.test.mjs proves that side).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ageLabel,
  agoLabel,
  approvalStance,
  arrangeQueue,
  awaitingCountersign,
  badgeFor,
  buildHistory,
  cleanScope,
  commentReplies,
  dateTimeLabel,
  diffFields,
  groupQueueItems,
  isFingerprint,
  listNames,
  missingScopes,
  orderItems,
  orderLessons,
  parseDecisionForm,
  parseSuggestionForm,
  proposedChanges,
  requiredScopes,
  revisionChanges,
  staleChanges,
  staleFromItemPage,
  storedValue,
  suggestionDiff,
} from '../lib/console/review.ts';

const NOW = '2026-09-26T12:00:00.000Z';
const hoursAgo = (h) => new Date(Date.parse(NOW) - h * 3_600_000).toISOString();

const item = (over = {}) => ({
  id: 'ps-itm-000001',
  lesson_id: 'ps-lsn-000001',
  lesson_title: 'Greetings',
  position: 1,
  native: 'سلام',
  romanisation: 'Salaam',
  meaning: 'Hello',
  variety_id: 'ps-var-yusufzai',
  in_review: true,
  submitted_at: hoursAgo(10),
  changed_at: hoursAgo(5),
  is_author: false,
  open_suggestions: 0,
  ...over,
});

const lesson = (over = {}) => ({
  id: 'ps-lsn-000001',
  title: 'Greetings',
  subtitle: '',
  variety_id: 'ps-var-yusufzai',
  submitted_at: hoursAgo(10),
  changed_at: hoursAgo(10),
  item_count: 6,
  unreviewed_items: 6,
  exercise_count: 6,
  is_author: false,
  ...over,
});

const current = {
  native: 'سلام',
  romanisation: 'Salaam',
  meaning: 'Hello',
  context: null,
  usage_note: null,
};

test('required scopes: text, romanisation and meaning; usage with a context or note', () => {
  assert.deepEqual(requiredScopes({}), ['text', 'romanisation', 'meaning']);
  assert.deepEqual(requiredScopes({ context: null, usage_note: '  ' }), [
    'text',
    'romanisation',
    'meaning',
  ]);
  assert.deepEqual(requiredScopes({ context: 'At the door.' }), [
    'text',
    'romanisation',
    'meaning',
    'usage',
  ]);
  assert.deepEqual(requiredScopes({ usage_note: 'Said to elders.' }), [
    'text',
    'romanisation',
    'meaning',
    'usage',
  ]);
});

test('missing and clean scopes keep display order and drop unknown parts', () => {
  const required = requiredScopes({ context: 'x' });
  assert.deepEqual(missingScopes(required, ['meaning']), [
    'text',
    'romanisation',
    'usage',
  ]);
  assert.deepEqual(missingScopes(required, required), []);
  assert.deepEqual(cleanScope(['usage', 'text', 'spelling', 'text', 7]), [
    'text',
    'usage',
  ]);
});

test('badges: in review only when the lesson is submitted; countersign; demo and retired win', () => {
  assert.equal(
    badgeFor({ review_status: 'unreviewed', submitted: true }),
    'in_review',
  );
  assert.equal(badgeFor({ review_status: 'unreviewed' }), 'draft');
  assert.equal(badgeFor({ review_status: 'approved' }), 'approved');
  assert.equal(
    badgeFor({ review_status: 'approved', awaiting_countersign: true }),
    'sole_reviewer',
  );
  assert.equal(
    badgeFor({ review_status: 'changes_requested' }),
    'changes_requested',
  );
  assert.equal(badgeFor({ review_status: 'rejected' }), 'rejected');
  assert.equal(badgeFor({ review_status: 'approved', is_demo: true }), 'demo');
  assert.equal(
    badgeFor({ review_status: 'approved', is_demo: true, retired: true }),
    'retired',
  );
});

test('queue order: lessons longest-waiting first; phrases in review first, then oldest', () => {
  const lessons = orderLessons([
    lesson({ id: 'ps-lsn-00000b', submitted_at: hoursAgo(1) }),
    lesson({ id: 'ps-lsn-00000a', submitted_at: hoursAgo(30) }),
  ]);
  assert.deepEqual(
    lessons.map((l) => l.id),
    ['ps-lsn-00000a', 'ps-lsn-00000b'],
  );

  const items = orderItems([
    item({ id: 'ps-itm-draft1', in_review: false, changed_at: hoursAgo(100) }),
    item({ id: 'ps-itm-newer1', changed_at: hoursAgo(1) }),
    item({ id: 'ps-itm-older1', changed_at: hoursAgo(9) }),
  ]);
  assert.deepEqual(
    items.map((i) => i.id),
    ['ps-itm-older1', 'ps-itm-newer1', 'ps-itm-draft1'],
  );
});

test('queue groups: by lesson, in the order of their longest-waiting phrase, phrases by position', () => {
  const groups = groupQueueItems([
    item({ id: 'a2', lesson_id: 'L1', position: 2, changed_at: hoursAgo(2) }),
    item({
      id: 'b1',
      lesson_id: 'L2',
      lesson_title: 'Food',
      position: 1,
      changed_at: hoursAgo(8),
    }),
    item({ id: 'a1', lesson_id: 'L1', position: 1, changed_at: hoursAgo(1) }),
    item({
      id: 'c1',
      lesson_id: 'L3',
      position: 1,
      in_review: false,
      changed_at: hoursAgo(50),
    }),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.lessonId, g.items.map((i) => i.id)]),
    [
      ['L2', ['b1']],
      ['L1', ['a1', 'a2']],
      ['L3', ['c1']],
    ],
  );
  assert.equal(groups[0].lessonTitle, 'Food');
  assert.equal(groups[2].inReview, false);

  const arranged = arrangeQueue({
    generated_at: NOW,
    varieties: [],
    lessons: [lesson()],
    items: [item()],
  });
  assert.equal(arranged.total, 2);
  assert.equal(arranged.groups.length, 1);
});

test('ages and dates read naturally', () => {
  assert.equal(ageLabel(NOW, NOW), 'just now');
  assert.equal(ageLabel(hoursAgo(1 / 60), NOW), '1 minute');
  assert.equal(ageLabel(hoursAgo(0.5), NOW), '30 minutes');
  assert.equal(ageLabel(hoursAgo(1), NOW), '1 hour');
  assert.equal(ageLabel(hoursAgo(49), NOW), '2 days');
  assert.equal(ageLabel(hoursAgo(24 * 21), NOW), '3 weeks');
  assert.equal(ageLabel(hoursAgo(24 * 90), NOW), '3 months');
  assert.equal(ageLabel(null, NOW), '');
  assert.equal(ageLabel('2026-09-27T00:00:00Z', NOW), 'just now', 'clock skew');
  assert.equal(agoLabel(hoursAgo(3), NOW), '3 hours ago');
  assert.equal(agoLabel(NOW, NOW), 'just now');
  assert.match(
    dateTimeLabel('2026-09-26T14:05:00Z'),
    /^26 Sept? 2026, 14:05 UTC$/,
  );
  assert.equal(dateTimeLabel(null), '');
  assert.equal(listNames([]), '');
  assert.equal(listNames(['Northern Pashto']), 'Northern Pashto');
  assert.equal(listNames(['A', 'B', 'C']), 'A, B and C');
});

test('stored values: native normalised, others trimmed, blank is null', () => {
  assert.equal(storedValue('native', '  سلام   دوست '), 'سلام دوست');
  assert.equal(storedValue('meaning', '  Hello '), 'Hello');
  assert.equal(storedValue('context', '   '), null);
  assert.equal(storedValue('usage_note', undefined), null);
});

test('a suggestion diff lists only what it changes, in field order', () => {
  assert.deepEqual(
    suggestionDiff(current, { meaning: 'Peace be with you', native: 'سلام' }),
    [
      {
        field: 'meaning',
        label: 'Meaning',
        before: 'Hello',
        after: 'Peace be with you',
      },
    ],
  );
  assert.deepEqual(suggestionDiff(current, { context: 'At the door.' }), [
    { field: 'context', label: 'Context', before: null, after: 'At the door.' },
  ]);
  assert.deepEqual(
    diffFields({ ...current, usage_note: 'Old' }, { usage_note: null }),
    [{ field: 'usage_note', label: 'Usage note', before: 'Old', after: null }],
  );
  assert.deepEqual(suggestionDiff(current, {}), []);
});

test('proposed changes keep only fields that differ, as they would be stored', () => {
  assert.deepEqual(
    proposedChanges(current, {
      native: ' سلام ',
      romanisation: 'Salaam',
      meaning: ' Peace ',
      context: '',
      usage_note: 'Said to elders. ',
    }),
    { meaning: 'Peace', usage_note: 'Said to elders.' },
  );
  assert.deepEqual(
    proposedChanges({ ...current, context: 'Old' }, { context: '  ' }),
    { context: null },
  );
  assert.deepEqual(proposedChanges(current, { ...current }), {});
});

test('revision changes compare each revision with the one before it', () => {
  const revisions = [
    {
      seq: 30,
      revision_no: 3,
      reason: 'suggestion',
      author_id: 'ctr-0200',
      author_name: 'A',
      suggestion_id: 's1',
      review_fingerprint: 'c',
      at: hoursAgo(1),
      fields: { ...current, meaning: 'Peace', context: 'At the door.' },
    },
    {
      seq: 10,
      revision_no: 1,
      reason: 'import',
      author_id: null,
      author_name: null,
      suggestion_id: null,
      review_fingerprint: 'a',
      at: hoursAgo(9),
      fields: current,
    },
    {
      seq: 20,
      revision_no: 2,
      reason: 'edit',
      author_id: 'ctr-0102',
      author_name: 'E',
      suggestion_id: null,
      review_fingerprint: 'b',
      at: hoursAgo(5),
      fields: { ...current, meaning: 'Hi' },
    },
  ];
  const changes = revisionChanges(revisions);
  assert.deepEqual(changes.get(10), []);
  assert.deepEqual(
    changes.get(20).map((c) => [c.field, c.before, c.after]),
    [['meaning', 'Hello', 'Hi']],
  );
  assert.deepEqual(
    changes.get(30).map((c) => [c.field, c.before, c.after]),
    [
      ['meaning', 'Hi', 'Peace'],
      ['context', null, 'At the door.'],
    ],
  );
});

test('history: one timeline, newest first, decisions before the revision they judged', () => {
  const at = hoursAgo(2);
  const history = buildHistory({
    revisions: [
      {
        seq: 1,
        revision_no: 1,
        reason: 'create',
        author_id: null,
        author_name: null,
        suggestion_id: null,
        review_fingerprint: 'a',
        at,
        fields: current,
      },
    ],
    decisions: [
      {
        id: 'd1',
        decision: 'approve',
        reviewer_id: 'ctr-0103',
        reviewer_name: 'R',
        seen_fingerprint: 'a',
        target_revision_no: 1,
        scope: ['text'],
        sole_reviewer: false,
        comment: null,
        redacted: false,
        at,
        current: true,
        countersign: null,
      },
    ],
    comments: [
      {
        id: 'c1',
        parent_id: null,
        author_id: 'x',
        author_name: 'X',
        body: 'Newest',
        redacted: false,
        at: hoursAgo(1),
      },
      {
        id: 'c2',
        parent_id: 'c1',
        author_id: 'y',
        author_name: 'Y',
        body: 'Reply',
        redacted: false,
        at: hoursAgo(0.5),
      },
    ],
  });
  assert.deepEqual(
    history.map((h) => h.key),
    ['c-c1', 'd-d1', 'r-1'],
  );
  const replies = commentReplies([
    { id: 'c3', parent_id: 'c1', at: hoursAgo(0.1) },
    { id: 'c2', parent_id: 'c1', at: hoursAgo(0.5) },
    { id: 'c1', parent_id: null, at: hoursAgo(1) },
  ]);
  assert.deepEqual(
    replies.get('c1').map((c) => c.id),
    ['c2', 'c3'],
  );
});

test('awaiting countersign: only the current, uncountersigned, sole approval', () => {
  const base = {
    id: 'd',
    decision: 'approve',
    sole_reviewer: true,
    current: true,
    countersign: null,
  };
  assert.equal(awaitingCountersign([base])?.id, 'd');
  assert.equal(awaitingCountersign([{ ...base, current: false }]), null);
  assert.equal(
    awaitingCountersign([{ ...base, countersign: { admin_id: 'a' } }]),
    null,
  );
  assert.equal(awaitingCountersign([{ ...base, sole_reviewer: false }]), null);
});

test('approval stance explains the author and sole-reviewer rules up front', () => {
  const viewer = {
    contributor_id: 'ctr-0200',
    can_review: true,
    is_author: false,
    sole_reviewer: false,
    reviewer_count: 2,
    can_approve: true,
    is_admin: false,
  };
  const stance = (v, extra = {}) =>
    approvalStance({
      viewer: { ...viewer, ...v },
      is_demo: false,
      retired: false,
      ...extra,
    }).kind;
  assert.equal(stance({}), 'can-approve');
  assert.equal(stance({ is_author: true }), 'own-text');
  assert.equal(stance({ is_author: true, sole_reviewer: true }), 'sole-author');
  assert.equal(stance({ can_review: false }), 'outside');
  assert.equal(stance({}, { is_demo: true }), 'demo');
  assert.equal(stance({}, { retired: true }), 'retired');
});

test('fingerprints are 16 lower-case hex digits', () => {
  assert.equal(isFingerprint('0123456789abcdef'), true);
  assert.equal(isFingerprint('0123456789ABCDEF'), false);
  assert.equal(isFingerprint('0123'), false);
  assert.equal(isFingerprint(null), false);
});

const form = (entries) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};
const BASE = [
  ['target_type', 'item'],
  ['target_id', 'ps-itm-000001'],
  ['seen_fingerprint', '0123456789abcdef'],
];

test('the decision form: scope for approvals, a note for everything else', () => {
  const approve = parseDecisionForm(
    form([
      ...BASE,
      ['decision', 'approve'],
      ['scope', 'meaning'],
      ['scope', 'text'],
      ['scope', 'x'],
    ]),
  );
  assert.equal(approve.ok, true);
  assert.deepEqual(approve.value.scope, ['text', 'meaning']);
  assert.equal(approve.value.comment, null);
  assert.deepEqual(
    parseDecisionForm(form([...BASE, ['decision', 'approve']])).value.scope,
    [],
    'an approval always sends a scope',
  );

  const ask = parseDecisionForm(
    form([...BASE, ['decision', 'request_changes'], ['comment', '  ']]),
  );
  assert.equal(ask.ok, false);
  assert.equal(ask.code, 'PL422_COMMENT_REQUIRED');
  const reject = parseDecisionForm(
    form([...BASE, ['decision', 'reject'], ['comment', ' Not used here. ']]),
  );
  assert.equal(reject.value.comment, 'Not used here.');
  assert.equal(reject.value.scope, null);
});

test('the decision form refuses what the database would refuse', () => {
  assert.equal(
    parseDecisionForm(form([...BASE, ['decision', 'ship-it']])).code,
    'PL422_BAD_INPUT',
  );
  assert.equal(
    parseDecisionForm(
      form([
        ['target_type', 'item'],
        ['target_id', 'x'],
        ['seen_fingerprint', 'stale'],
        ['decision', 'approve'],
      ]),
    ).code,
    'PL422_BAD_INPUT',
  );
  assert.equal(
    parseDecisionForm(
      form([...BASE, ['decision', 'reject'], ['comment', 'x'.repeat(2001)]]),
    ).code,
    'PL422_LENGTH',
  );
});

test('the suggestion form keeps every field as typed', () => {
  const suggestion = parseSuggestionForm(
    form([
      ['item_id', 'ps-itm-000001'],
      ['seen_fingerprint', '0123456789abcdef'],
      ['native', ' سلام '],
      ['meaning', 'Peace'],
      ['context', ''],
      ['note', ' More natural. '],
    ]),
  );
  assert.deepEqual(suggestion.value.proposed, {
    native: ' سلام ',
    meaning: 'Peace',
    context: '',
  });
  assert.equal(suggestion.value.note, 'More natural.');
  assert.equal(
    parseSuggestionForm(
      form([
        ['item_id', 'x'],
        ['seen_fingerprint', '0123456789abcdef'],
      ]),
    ).code,
    'PL422_BAD_INPUT',
  );
});

test('a stale reload says which fields changed', () => {
  const stale = staleFromItemPage({
    item: {
      ...current,
      meaning: 'Hello, friend',
      review_fingerprint: 'fedcba9876543210',
      revision_no: 3,
    },
  });
  assert.equal(stale.revision_no, 3);
  assert.deepEqual(
    staleChanges(current, stale).map((c) => [c.field, c.before, c.after]),
    [['meaning', 'Hello', 'Hello, friend']],
  );
  assert.deepEqual(
    staleChanges(current, {
      review_fingerprint: 'fedcba9876543210',
      revision_no: 1,
    }),
    [],
  );
});

test('waiting labels', async () => {
  const { waitingLabel } = await import('../lib/console/review.ts');
  assert.equal(waitingLabel(NOW, NOW), 'Just arrived');
  assert.equal(waitingLabel(hoursAgo(26), NOW), 'Waiting 1 day');
  assert.equal(waitingLabel(null, NOW), '');
});
