'use client';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ConfirmAction } from '@/components/console/confirm-action';
import { StatusBadge } from '@/components/console/status-badge';
import { submitLesson } from '@/app/(console)/edit/lesson/[id]/actions';
import type { EditorStatus, NextStep } from '@/lib/console/editor';

type LessonStatus = {
  /** Bumped each time the lesson is sent for review from this page. */
  sent: number;
  markSent: () => void;
  clearSent: () => void;
};

const LessonStatusContext = createContext<LessonStatus | null>(null);

/**
 * What the lesson page’s status strip and its review panel share: whether
 * the lesson was just sent from here, so the panel shows the confirmation
 * (and takes focus) wherever Submit was pressed.
 */
export function LessonStatusProvider({ children }: { children: ReactNode }) {
  const [sent, setSent] = useState(0);
  const markSent = useCallback(() => setSent((n) => n + 1), []);
  const clearSent = useCallback(() => setSent(0), []);
  const value = useMemo(
    () => ({ sent, markSent, clearSent }),
    [sent, markSent, clearSent],
  );
  return <LessonStatusContext value={value}>{children}</LessonStatusContext>;
}

const standalone: LessonStatus = {
  sent: 0,
  markSent: () => {},
  clearSent: () => {},
};

export function useLessonStatus(): LessonStatus {
  return useContext(LessonStatusContext) ?? standalone;
}

/**
 * "Submit for review", after a confirm; "Send back to reviewer" for a
 * lesson a reviewer sent back. The review panel confirms it went.
 */
export function SubmitForReview({
  lessonId,
  resend,
  confirm,
}: {
  lessonId: string;
  resend: boolean;
  /** What happens next, from handoffCopy(). */
  confirm: string;
}) {
  const { markSent } = useLessonStatus();
  const label = resend ? 'Send back to reviewer' : 'Submit for review';
  return (
    <ConfirmAction
      action={submitLesson}
      triggerLabel={label}
      triggerTone="primary"
      title={
        resend
          ? 'Send it back to the reviewer?'
          : 'Send this lesson for review?'
      }
      description={confirm}
      confirmLabel={label}
      pendingLabel="Sending…"
      fields={{ lesson_id: lessonId }}
      onSuccess={markSent}
    />
  );
}

/**
 * The lesson’s status and its one next step, under the page header where
 * the review panel is not beside the content (under 1100px). On a phone it
 * stays at the bottom of the screen while there is something to do.
 */
export function LessonStatusStrip({
  lessonId,
  status,
  step,
  waiting,
  confirm,
}: {
  lessonId: string;
  status: EditorStatus;
  step: NextStep;
  /** "Waiting for a Yusufzai reviewer" */
  waiting: string;
  confirm: string;
}) {
  if (step.kind === 'locked') return null;
  const actionable = step.kind === 'todo' || step.kind === 'submit';
  const summary =
    step.kind === 'todo'
      ? 'Not ready to send yet.'
      : step.kind === 'submit'
        ? step.resend
          ? 'Changed since the review.'
          : 'Ready for review.'
        : step.kind === 'waiting'
          ? `${waiting}.`
          : 'Approved. Any change sends it back to review.';
  return (
    <section
      className={`editor-status-strip${actionable ? ' editor-status-strip-sticky' : ''}`}
      aria-label="Lesson status"
    >
      <p className="editor-status-summary">
        <span className="editor-status-pill">
          <StatusBadge status={status} />
        </span>
        <span>{summary}</span>
      </p>
      {step.kind === 'todo' ? (
        <a
          href="#submit-heading"
          className="console-button console-button-outline editor-status-action"
        >
          {step.count} {step.count === 1 ? 'check' : 'checks'} to do
        </a>
      ) : step.kind === 'submit' ? (
        <SubmitForReview
          lessonId={lessonId}
          resend={step.resend}
          confirm={confirm}
        />
      ) : (
        <a
          href="#submit-heading"
          className="console-button console-button-quiet editor-status-action"
        >
          Review details
        </a>
      )}
    </section>
  );
}
