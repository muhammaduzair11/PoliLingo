import Link from 'next/link';
import { NativeText } from '@/components/native';
import { adminPeoplePath, adminPublishPath } from '@/lib/console/paths';
import {
  formatCount,
  type AccountsView,
  type LanguageCard,
  type OverviewView as View,
  type VarietyRow,
} from '@/lib/console/overview';
import { DataTable } from '../data-table';
import { EmptyState } from '../empty-state';
import { Stat, StatGrid } from '../stat';
import { StatusBadge } from '../status-badge';

/** The admin overview, from lib/console/overview.ts's view model. */
export function OverviewView({ view }: { view: View }) {
  return (
    <div className="overview">
      <ReleaseStrip release={view.release} />

      <section aria-labelledby="overview-totals" className="overview-section">
        <h2 id="overview-totals" className="admin-visually-hidden">
          Across every language
        </h2>
        <StatGrid>
          <Stat
            label="Reviewed items"
            value={formatCount(view.totals.reviewed)}
            hint={`Target ${formatCount(view.target.min)}–${formatCount(view.target.max)} per language`}
          />
          <Stat label="In review" value={formatCount(view.totals.inReview)} />
          <Stat
            label="Waiting to publish"
            value={formatCount(view.totals.waiting)}
          />
          <Stat
            label="Live for learners"
            value={formatCount(view.totals.live)}
            hint="Phrases in the latest release"
          />
        </StatGrid>
      </section>

      <section
        aria-labelledby="overview-languages"
        className="overview-section"
      >
        <h2 id="overview-languages" className="overview-heading">
          Languages
        </h2>
        {view.languages.length === 0 ? (
          <EmptyState title="No languages yet">
            <p>Languages appear here once the curriculum is loaded.</p>
          </EmptyState>
        ) : (
          <div className="overview-languages">
            {view.languages.map((language) => (
              <LanguagePanel key={language.code} language={language} />
            ))}
          </div>
        )}
      </section>

      <section
        aria-labelledby="overview-reviewers"
        className="overview-section"
      >
        <h2 id="overview-reviewers" className="overview-heading">
          Reviewers by variety
        </h2>
        <DataTable
          rows={view.varieties}
          rowKey={(v) => v.id}
          empty={
            <EmptyState
              title="No varieties yet"
              action={
                <Link
                  className="console-button console-button-outline"
                  href={adminPeoplePath()}
                >
                  Go to People
                </Link>
              }
            />
          }
          columns={[
            {
              key: 'variety',
              header: 'Variety',
              cell: (v) => (
                <span className="people-person">
                  <span className="people-name">{v.name}</span>
                  <span className="people-email">{v.languageName}</span>
                </span>
              ),
            },
            {
              key: 'count',
              header: 'Reviewers',
              align: 'end',
              cell: (v) => (
                <span className={`coverage coverage-${v.coverage}`}>
                  {v.reviewers}
                </span>
              ),
            },
            {
              key: 'who',
              header: 'Who',
              hideOnMobile: true,
              cell: (v) =>
                v.names.length ? (
                  v.names.join(', ')
                ) : (
                  <span className="people-muted">No one yet</span>
                ),
            },
            {
              key: 'note',
              header: 'Note',
              cell: (v) => <CoverageNote variety={v} />,
            },
          ]}
        />
      </section>

      {view.accounts && <AccountsSection accounts={view.accounts} />}
    </div>
  );
}

function ReleaseStrip({ release }: { release: View['release'] }) {
  if (!release)
    return (
      <EmptyState
        title="Nothing published yet"
        action={
          <Link
            className="console-button console-button-primary"
            href={adminPublishPath()}
          >
            Go to Publish
          </Link>
        }
      >
        <p>
          Learners see the lessons built into the app until the first release.
        </p>
      </EmptyState>
    );
  return (
    <section className="overview-release" aria-label="Latest release">
      <div className="overview-release-text">
        <p className="console-eyebrow">Learners are on</p>
        <p className="overview-release-name">
          <code>{release.name}</code>
        </p>
        <p className="console-hint">
          {release.kindLabel} {release.publishedLabel} ·{' '}
          {formatCount(release.lessons)}{' '}
          {release.lessons === 1 ? 'lesson' : 'lessons'} ·{' '}
          {formatCount(release.items)}{' '}
          {release.items === 1 ? 'phrase' : 'phrases'}
        </p>
      </div>
      <Link
        className="console-button console-button-outline"
        href={adminPublishPath()}
      >
        Publish
      </Link>
    </section>
  );
}

function LanguagePanel({ language: l }: { language: LanguageCard }) {
  const percent = Math.round(l.progress * 100);
  const headingId = `overview-lang-${l.code}`;
  return (
    <article className="overview-language" aria-labelledby={headingId}>
      <header className="overview-language-head">
        <h3 id={headingId}>{l.name}</h3>
        <NativeText text={l.nativeName} lang={l.code} dir={l.dir} />
        {l.hidden && (
          <StatusBadge status="gated" label="Hidden from learners" />
        )}
      </header>

      <p className="overview-honest">{l.reviewedLine}</p>
      <progress
        className="overview-progress"
        max={100}
        value={percent}
        aria-label={`${l.name}: reviewed items towards the target`}
        aria-valuetext={l.progressLabel}
      >
        {percent}%
      </progress>
      <p className="console-hint">{l.progressLabel}</p>

      <ol className="overview-pipeline" aria-label={`${l.name} pipeline`}>
        {l.steps.map((step) => (
          <li
            key={step.key}
            className={`overview-step overview-step-${step.key}${step.value === 0 ? ' overview-step-empty' : ''}`}
          >
            <span className="overview-step-value">
              {formatCount(step.value)}
            </span>
            <span className="overview-step-label">{step.label}</span>
            <span className="overview-step-hint">{step.hint}</span>
          </li>
        ))}
      </ol>

      <dl className="overview-facts">
        <div>
          <dt>Live now</dt>
          <dd>
            {formatCount(l.live.total)}{' '}
            {l.live.total === 1 ? 'phrase' : 'phrases'}
            {l.live.total > 0 &&
              ` (${formatCount(l.live.reviewed)} reviewed, ${formatCount(l.live.demo)} starter)`}
          </dd>
        </div>
        <div>
          <dt>In the workspace</dt>
          <dd>
            {formatCount(l.items)} {l.items === 1 ? 'phrase' : 'phrases'} in{' '}
            {formatCount(l.lessons)} {l.lessons === 1 ? 'lesson' : 'lessons'}
          </dd>
        </div>
        {l.gated > 0 && (
          <div>
            <dt>Held back</dt>
            <dd>
              {formatCount(l.gated)} {l.gated === 1 ? 'phrase' : 'phrases'}{' '}
              behind a closed publish gate
            </dd>
          </div>
        )}
      </dl>
      {l.demoNote && <p className="overview-note">{l.demoNote}</p>}
    </article>
  );
}

function CoverageNote({ variety }: { variety: VarietyRow }) {
  return (
    <span className="overview-coverage-note">
      {variety.note}
      {variety.coverage === 'none' && (
        <>
          {' '}
          <Link href={adminPeoplePath()}>Invite a reviewer</Link>
        </>
      )}
    </span>
  );
}

function AccountsSection({ accounts: a }: { accounts: AccountsView }) {
  const total7d = a.activity.reduce((n, d) => n + d.accounts, 0);
  return (
    <section aria-labelledby="overview-accounts" className="overview-section">
      <h2 id="overview-accounts" className="overview-heading">
        Accounts and activity
      </h2>
      <StatGrid>
        <Stat
          label="Accounts"
          value={formatCount(a.total)}
          hint={`${formatCount(a.adults)} adults`}
        />
        <Stat
          label="Saved progress this week"
          value={formatCount(a.active7d)}
          hint="Signed-in learners, last 7 days"
        />
        <Stat
          label="Finished a lesson"
          value={formatCount(a.learnersWithCompletion)}
          hint={`${formatCount(a.completions)} lessons finished in all`}
        />
        <Stat label="Team members" value={formatCount(a.team)} />
      </StatGrid>
      {a.activity.length > 0 && (
        <figure className="overview-activity">
          <figcaption>
            Accounts saving progress, day by day (UTC)
            {total7d === 0 && (
              <span className="people-muted"> · quiet so far this week</span>
            )}
          </figcaption>
          <ol className="overview-bars">
            {a.activity.map((d) => (
              <li key={d.date}>
                <span className="admin-visually-hidden">
                  {`${d.label}: ${d.accounts} ${d.accounts === 1 ? 'account' : 'accounts'}`}
                </span>
                <span className="overview-bar-value" aria-hidden="true">
                  {d.accounts}
                </span>
                <span className="overview-bar-track" aria-hidden="true">
                  <span
                    className="overview-bar"
                    style={{
                      height: `${Math.max(d.height, d.accounts > 0 ? 6 : 0)}%`,
                    }}
                  />
                </span>
                <span className="overview-bar-day" aria-hidden="true">
                  {d.day}
                </span>
              </li>
            ))}
          </ol>
        </figure>
      )}
    </section>
  );
}
