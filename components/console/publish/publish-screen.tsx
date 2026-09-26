import type { ReactNode } from 'react';
import { EmptyState } from '@/components/console/empty-state';
import { Notice } from '@/components/console/notice';
import { PageHeader } from '@/components/console/page-header';
import { Stat, StatGrid } from '@/components/console/stat';
import type { ActionResult } from '@/lib/console/action-result';
import {
  checkContentHash,
  describeLessonChange,
  diffReleases,
} from '@/lib/console/release-diff';
import { CountersignQueue, type CountersignRow } from './countersign-queue';
import { count, formatDate, formatDateTime, listJoin } from './format';
import { LessonTable } from './lesson-table';
import { PublishControl } from './publish-control';
import { ReleaseHistory, type HistoryRow } from './release-history';
import type {
  PublishOutcome,
  PublishPageData,
  PublishState,
  ReleasePreview,
} from './types';

export const PUBLISH_DESCRIPTION =
  'Send reviewed lessons to learners. Check what changes for them, then publish a new release.';

/** What learners get from the next release, in one sentence. */
function summarise(preview: ReleasePreview): string {
  const { added, changed, removed } = preview.diff;
  const parts = [
    added.length ? count(added.length, 'new lesson', 'new lessons') : '',
    changed.length
      ? count(changed.length, 'updated lesson', 'updated lessons')
      : '',
  ].filter(Boolean);
  const gets = parts.length
    ? `Learners get ${listJoin(parts)}.`
    : removed.length || preview.unchanged
      ? 'Nothing new for learners to study.'
      : 'Learners get small updates, such as a course or unit name.';
  const leaves = removed.length
    ? ` ${count(removed.length, 'lesson leaves', 'lessons leave')} the app.`
    : '';
  return gets + leaves;
}

function stateOf(
  preview: ReleasePreview,
  previewHashOk: boolean,
): PublishState {
  if (!previewHashOk) return 'check_failed';
  if (!preview.clock_ok) return 'clock';
  if (preview.unchanged) return 'unchanged';
  if (preview.empty) return 'empty';
  return 'ready';
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="publish-section" aria-labelledby={id}>
      <div className="publish-section-heading">
        <h2 id={id}>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * /admin/publish from page_admin_publish(): where learners are, what the
 * next release changes for them, what is held back and why, the countersign
 * queue, the Publish button and the release history. Every figure comes from
 * the database; the page only recomputes contentHashes to check them.
 */
export function PublishScreen({
  data,
  publishAction,
  countersignAction,
  rollbackAction,
}: {
  data: PublishPageData;
  publishAction: (
    previous: ActionResult<PublishOutcome> | null,
    formData: FormData,
  ) => Promise<ActionResult<PublishOutcome>>;
  countersignAction: (
    previous: ActionResult<{ decision_id: string }> | null,
    formData: FormData,
  ) => Promise<ActionResult<{ decision_id: string }>>;
  rollbackAction: (
    previous: ActionResult<PublishOutcome> | null,
    formData: FormData,
  ) => Promise<ActionResult<PublishOutcome>>;
}) {
  const { preview, latest, releases, countersign_available } = data;
  const previewCheck = checkContentHash(preview.payload, preview.contentHash);
  const liveCheck = latest
    ? checkContentHash(latest.payload, latest.contentHash)
    : null;
  const state = stateOf(preview, previewCheck.ok);

  // Field-level detail for the lessons the database lists as changed.
  const detail = diffReleases(latest?.payload ?? null, preview.payload);
  const changes = new Map(
    detail.changed.map((change) => [change.id, describeLessonChange(change)]),
  );

  const { added, changed, carried, removed } = preview.diff;
  const heldBack = preview.excluded;
  const anyChange = added.length + changed.length + removed.length > 0;
  const countersignRows: CountersignRow[] = preview.awaiting_countersign.map(
    (row) => ({ ...row, approvedOn: formatDate(row.at) }),
  );
  const historyRows: HistoryRow[] = releases.map((row) => ({
    ...row,
    publishedLabel: formatDateTime(row.published_at),
  }));

  return (
    <div className="publish-page">
      <PageHeader
        eyebrow="Admin"
        title="Publish"
        description={PUBLISH_DESCRIPTION}
      />

      {liveCheck && !liveCheck.ok && (
        <Notice
          tone="warning"
          title="The live release didn't pass its content check"
          code="PL422_HASH_MISMATCH"
        >
          Learners&apos; apps refuse a copy that fails this check and keep the
          lessons they already have. Please tell the team.
        </Notice>
      )}

      <section className="publish-status" aria-label="Release status">
        <div className="publish-status-card">
          <p className="publish-status-label">Live for learners</p>
          {latest ? (
            <>
              <p className="publish-status-name">{latest.name}</p>
              <p className="publish-status-meta">
                Published{' '}
                <time dateTime={latest.published_at}>
                  {formatDateTime(latest.published_at)}
                </time>
                {releases[0] && (
                  <>
                    {' · '}
                    {count(releases[0].lessons, 'lesson', 'lessons')}
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="publish-status-name">Nothing yet</p>
          )}
        </div>
        <span className="publish-status-arrow" aria-hidden="true" />
        <div className="publish-status-card publish-status-next">
          <p className="publish-status-label">Next release</p>
          <p className="publish-status-name">
            {state === 'unchanged' ? 'Up to date' : preview.release}
          </p>
          <p className="publish-status-meta">
            {state === 'unchanged'
              ? `Everything ready is already in ${preview.base?.name ?? 'the live release'}.`
              : `${count(preview.stats.lessons, 'lesson', 'lessons')} · ${count(preview.stats.items, 'phrase', 'phrases')}. ${summarise(preview)}`}
          </p>
          <PublishControl
            state={state}
            release={preview.release}
            contentHash={preview.contentHash}
            summary={summarise(preview)}
            action={publishAction}
          />
        </div>
      </section>

      <StatGrid>
        <Stat label="New lessons" value={added.length} hint="Not live yet" />
        <Stat
          label="Updated lessons"
          value={changed.length}
          hint="Live, with changes"
        />
        <Stat
          label="Leaving"
          value={removed.length}
          hint="Live now, not in the next release"
        />
        <Stat
          label="Held back"
          value={heldBack.length}
          hint="Not ready to publish"
        />
      </StatGrid>

      <Section
        id="publish-changes"
        title="What changes for learners"
        description={
          anyChange
            ? `Compared with ${preview.base?.name ?? 'nothing published yet'}.`
            : undefined
        }
      >
        {!anyChange && !preview.unchanged && !preview.empty ? (
          <EmptyState title="No lessons change">
            <p>
              Every lesson stays as it is. Other details changed, such as a
              course or unit name, and publishing sends those to learners.
            </p>
          </EmptyState>
        ) : !anyChange ? (
          <EmptyState title="Learners are up to date">
            <p>
              {preview.base
                ? `Everything that's ready is already live in ${preview.base.name}. Lessons appear here once they're approved.`
                : "Lessons appear here once they're approved."}
            </p>
          </EmptyState>
        ) : (
          <div className="publish-groups">
            {added.length > 0 && (
              <LessonTable
                caption={`New (${added.length})`}
                rows={added}
                detail="size"
              />
            )}
            {changed.length > 0 && (
              <LessonTable
                caption={`Updated (${changed.length})`}
                rows={changed}
                detail="changes"
                changes={changes}
              />
            )}
            {removed.length > 0 && (
              <LessonTable
                caption={`Leaving the app (${removed.length})`}
                rows={removed}
                detail="reasons"
              />
            )}
          </div>
        )}
        {carried.length > 0 && (
          <div className="publish-carried">
            <p className="publish-carried-intro">
              <strong>
                {count(carried.length, 'lesson is', 'lessons are')} being
                edited.
              </strong>{' '}
              Learners keep the version they already have until the changes are
              approved.
            </p>
            <LessonTable rows={carried} detail="size" />
          </div>
        )}
      </Section>

      <Section
        id="publish-held"
        title="Held back"
        description="Lessons that aren't in the next release yet, and what they need."
      >
        {heldBack.length === 0 ? (
          <EmptyState title="Nothing is held back">
            <p>Every lesson in the workspace is live or in the next release.</p>
          </EmptyState>
        ) : (
          <LessonTable rows={heldBack} detail="reasons" />
        )}
      </Section>

      <Section
        id="publish-countersign"
        title="Waiting for a countersign"
        description="Approvals from a variety's only reviewer go live once an admin confirms them."
      >
        <CountersignQueue
          rows={countersignRows}
          available={countersign_available}
          action={countersignAction}
        />
      </Section>

      <Section
        id="publish-history"
        title="Release history"
        description="Every release learners have had, newest first. Going back to an earlier one publishes its lessons again as a new release."
      >
        <ReleaseHistory
          releases={historyRows}
          nextName={preview.release}
          action={rollbackAction}
        />
      </Section>
    </div>
  );
}
