'use client';
import {
  useActionState,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ConfirmAction } from '@/components/console/confirm-action';
import { Notice } from '@/components/console/notice';
import { SubmitButton } from '@/components/console/submit-button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { NativeText } from '@/components/native';
import type { ActionResult } from '@/lib/console/action-result';
import type {
  ApprovalStance,
  Direction,
  ItemFields,
  ScopePart,
  StaleSnapshot,
} from '@/lib/console/review';
import { ScopeChecklist } from './scope-checklist';
import { StaleNotice, useStaleSlot } from './stale-notice';

type DecisionData = {
  decision_id: string;
  status: string;
  sole_reviewer: boolean;
  countersign_required: boolean;
};
type DecisionAction = (
  previous: ActionResult<DecisionData> | null,
  formData: FormData,
) => Promise<ActionResult<DecisionData> & { stale?: StaleSnapshot }>;

/**
 * A decision's note, kept as typed: React resets the form after its action
 * returns, so without this a refusal (the text changed meanwhile) would
 * also wipe the note.
 */
function NoteField({
  id,
  label,
  rows,
  required = false,
}: {
  id: string;
  label: ReactNode;
  rows: number;
  required?: boolean;
}) {
  const [value, setValue] = useState('');
  return (
    <div className="console-field review-dialog-field">
      <label className="console-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        name="comment"
        rows={rows}
        maxLength={2000}
        required={required}
        className="console-input"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </div>
  );
}

/** The phrase being approved, compactly, at the top of the Approve dialog. */
function ApprovingPhrase({
  seen,
  lang,
  dir,
}: {
  seen: ItemFields;
  lang: string;
  dir: Direction;
}) {
  return (
    <div className="review-approve-phrase">
      <NativeText text={seen.native} lang={lang} dir={dir} />
      <span className="review-phrase-roman" lang={`${lang}-Latn`} dir="ltr">
        {seen.romanisation}
      </span>
      <span className="review-phrase-meaning">{seen.meaning}</span>
      {seen.context && (
        <span className="review-approve-note">
          <strong>Context:</strong> {seen.context}
        </span>
      )}
      {seen.usage_note && (
        <span className="review-approve-note">
          <strong>Usage:</strong> {seen.usage_note}
        </span>
      )}
    </div>
  );
}

/**
 * Approve, after a dialog that shows what is being approved and, for a
 * phrase, asks which parts were checked. Approve stays off until every
 * part is ticked ("2 of 4 checked" says how far along), so the browser
 * never has to object. On a phone the dialog’s buttons stay in view and
 * only its middle scrolls.
 */
function ApproveDialog({
  what,
  targetType,
  targetId,
  fields,
  run,
  stance,
  varietyName,
  requiredScope,
  seen,
  lang,
  dir,
  staleNotice,
  onApproved,
}: {
  what: string;
  targetType: 'item' | 'lesson';
  targetId: string;
  fields: Record<string, string>;
  run: DecisionAction;
  stance: ApprovalStance;
  varietyName: string;
  requiredScope?: ScopePart[];
  seen?: ItemFields;
  lang: string;
  dir: Direction;
  staleNotice: ReactNode;
  onApproved: (data: DecisionData) => void;
}) {
  const [open, setOpen] = useState(false);
  const scoped = Boolean(requiredScope && requiredScope.length > 0);
  const [complete, setComplete] = useState(!scoped);
  const onProgress = useCallback((done: boolean) => setComplete(done), []);
  const noteId = useId();
  const offId = useId();
  const [result, formAction] = useActionState(
    async (previous: ActionResult<DecisionData> | null, formData: FormData) => {
      const next = await run(previous, formData);
      if (next.ok) {
        setOpen(false);
        onApproved(next.data);
      }
      return next;
    },
    null,
  );
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger className="console-button console-button-primary">
        Approve {what}
      </AlertDialogTrigger>
      <AlertDialogContent className="console-dialog review-approve-dialog">
        <form
          action={formAction}
          className="console-dialog-form review-approve-form"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Approve this {what}?</AlertDialogTitle>
            <AlertDialogDescription>
              {targetType === 'item'
                ? 'Your approval covers exactly this text.'
                : 'Your approval covers the lesson as it stands: its title, its phrases in order and its exercises.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <div className="review-approve-body">
            {seen && <ApprovingPhrase seen={seen} lang={lang} dir={dir} />}
            {stance.kind === 'sole-author' && (
              <Notice tone="info" title="You wrote part of this">
                You’re the only {varietyName} reviewer, so you can approve it.
                An admin will countersign before learners see it.
              </Notice>
            )}
            {scoped && requiredScope ? (
              <ScopeChecklist
                required={requiredScope}
                onProgress={onProgress}
              />
            ) : (
              <p className="console-hint">
                Approve the lesson once its phrases read well together and every
                exercise has one clear right answer.
              </p>
            )}
            <NoteField
              id={`${targetId}-${noteId}`}
              label="Note (optional)"
              rows={2}
            />
            {staleNotice}
            {result && !result.ok && result.code !== 'PL409_STALE' && (
              <Notice tone="error" code={result.code}>
                {result.message}
              </Notice>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <SubmitButton
              pendingLabel="Approving…"
              disabled={!complete}
              aria-describedby={!complete ? offId : undefined}
            >
              Approve
            </SubmitButton>
          </AlertDialogFooter>
          {!complete && (
            <p id={offId} className="review-visually-hidden">
              Tick every part you checked to approve.
            </p>
          )}
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Approve, Request changes and Reject for one phrase or lesson. Every form
 * sends the fingerprint of the version on screen, so a decision can only
 * land on the text the reviewer actually read; if it changed meanwhile the
 * page says what changed (full width, above the columns) and offers the
 * latest version.
 *
 * Under 740px the side column is below the phrase, so Approve and Request
 * changes also sit in a bar along the bottom of the screen, with "More"
 * jumping to the rest.
 *
 * Remount it (key it by the fingerprint) when a new version loads.
 */
export function DecisionPanel({
  targetType,
  targetId,
  fingerprint,
  stance,
  requiredScope,
  approveBlocked,
  approveBlockedTitle = 'Not ready to approve yet',
  approvedRevision = null,
  varietyName,
  seen,
  lang,
  dir,
  action,
  moreHref = '#review-actions-title',
}: {
  targetType: 'item' | 'lesson';
  targetId: string;
  fingerprint: string;
  stance: ApprovalStance;
  /** Items: the parts to tick. Lessons: none. */
  requiredScope?: ScopePart[];
  /** Why it cannot be approved now (not submitted, too few exercises, already approved). */
  approveBlocked?: ReactNode;
  approveBlockedTitle?: string;
  /**
   * The revision the viewer already approved, when that approval is the
   * current decision on the version on screen: Approve is hidden, since a
   * second click would only record the same decision again.
   */
  approvedRevision?: number | null;
  varietyName: string;
  seen?: ItemFields;
  lang: string;
  dir: Direction;
  action: DecisionAction;
  /** Where the phone bar’s "More" goes: the review card’s heading. */
  moreHref?: string;
}) {
  const [stale, setStale] = useState<StaleSnapshot | null>(null);
  const [done, setDone] = useState<ReactNode>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  // Set the moment an approval lands, before the page’s fresh data arrives.
  const [approvedHere, setApprovedHere] = useState(false);
  const what = targetType === 'item' ? 'phrase' : 'lesson';

  const run: DecisionAction = async (previous, formData) => {
    const result = await action(previous, formData);
    if (!result.ok && result.code === 'PL409_STALE')
      setStale(
        result.stale ?? { review_fingerprint: fingerprint, revision_no: 0 },
      );
    return result;
  };

  const fields = (decision: string) => ({
    target_type: targetType,
    target_id: targetId,
    seen_fingerprint: fingerprint,
    decision,
  });

  const staleNotice = useMemo(
    () =>
      stale && (
        <StaleNotice
          what={what}
          seen={seen}
          stale={stale}
          lang={lang}
          dir={dir}
        />
      ),
    [stale, what, seen, lang, dir],
  );
  // The page-level copy goes above both columns when the page has a slot.
  const inSlot = useStaleSlot(staleNotice);

  // The button pressed may be gone (Approve, once approved): focus the
  // confirmation instead, after the dialog has handed focus back.
  const finish = (message: ReactNode) => {
    setDone(message);
    window.setTimeout(() => doneRef.current?.focus(), 150);
  };

  if (
    stance.kind === 'demo' ||
    stance.kind === 'retired' ||
    stance.kind === 'outside'
  )
    return null;

  const canApprove =
    stance.kind === 'can-approve' || stance.kind === 'sole-author';
  const alreadyApproved = approvedHere || approvedRevision !== null;
  const showApprove = canApprove && !approveBlocked && !alreadyApproved;

  const approve = (
    <ApproveDialog
      what={what}
      targetType={targetType}
      targetId={targetId}
      fields={fields('approve')}
      run={run}
      stance={stance}
      varietyName={varietyName}
      requiredScope={requiredScope}
      seen={seen}
      lang={lang}
      dir={dir}
      staleNotice={staleNotice}
      onApproved={(data) => {
        setApprovedHere(true);
        finish(
          data.countersign_required
            ? 'Approved. Because you wrote part of it, an admin will countersign before learners see it.'
            : `Approved. Thank you for checking this ${what}.`,
        );
      }}
    />
  );
  const requestChanges = (
    <ConfirmAction<DecisionData>
      action={run}
      triggerTone="outline"
      triggerLabel="Request changes"
      title="What needs to change?"
      description={`The editor sees your note next to the ${what}. Be specific: which word, and what it should be.`}
      confirmLabel="Send request"
      pendingLabel="Sending…"
      fields={fields('request_changes')}
      onSuccess={() => {
        setApprovedHere(false);
        finish(`Sent. The editor will see your note on this ${what}.`);
      }}
    >
      <NoteField
        id={`${targetId}-changes-note`}
        label="Your note"
        rows={4}
        required
      />
      {staleNotice}
    </ConfirmAction>
  );

  return (
    <div className="review-decisions">
      {!inSlot && staleNotice}
      <div ref={doneRef} tabIndex={-1} className="review-outcome">
        {done && <Notice tone="success">{done}</Notice>}
      </div>
      {canApprove && approveBlocked && (
        <Notice tone="info" title={approveBlockedTitle}>
          {approveBlocked}
        </Notice>
      )}
      {canApprove && !approveBlocked && !done && approvedRevision !== null && (
        <Notice tone="info" title={`You approved revision ${approvedRevision}`}>
          There is nothing more to approve on this version. If you spot a
          problem, you can still request changes or reject it.
        </Notice>
      )}
      <div className="review-decision-buttons">
        {showApprove && approve}
        {requestChanges}
        <ConfirmAction<DecisionData>
          action={run}
          tone="danger"
          triggerTone="quiet"
          triggerLabel={`Reject ${what}`}
          title={`Reject this ${what}?`}
          description={`Reject it when it shouldn’t be taught at all. To fix a word, request changes or suggest a fix instead.`}
          confirmLabel="Reject"
          pendingLabel="Rejecting…"
          fields={fields('reject')}
          onSuccess={() => {
            setApprovedHere(false);
            finish(`Rejected. The editor will see why.`);
          }}
        >
          <NoteField
            id={`${targetId}-reject-note`}
            label="Why shouldn’t learners see this?"
            rows={4}
            required
          />
          {staleNotice}
        </ConfirmAction>
      </div>
      <section className="review-action-bar" aria-label="Review actions">
        {showApprove && approve}
        {requestChanges}
        <a
          href={moreHref}
          className="console-button console-button-quiet review-action-more"
        >
          <span aria-hidden="true">⋯</span>
          <span className="review-visually-hidden">
            More: reject{targetType === 'item' ? ' or suggest a fix' : ''}
          </span>
        </a>
      </section>
    </div>
  );
}
