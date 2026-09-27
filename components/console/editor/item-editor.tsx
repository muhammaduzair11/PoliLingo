'use client';
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { EmptyState } from '@/components/console/empty-state';
import { NativePreview } from '@/components/console/native-preview';
import { Notice } from '@/components/console/notice';
import { ScriptField } from '@/components/console/script-field';
import { StatusBadge } from '@/components/console/status-badge';
import { SubmitButton } from '@/components/console/submit-button';
import { NativeText } from '@/components/native';
import {
  createItem,
  updateItem,
} from '@/app/(console)/edit/lesson/[id]/actions';
import {
  LIMITS,
  MAX_ITEMS,
  ORIGINAL_PROVENANCE,
  SOURCE_TYPES,
  SOURCE_TYPE_LABELS,
  duplicateOf,
  echo,
  exercisesUsing,
  itemStatus,
  provenanceValid,
  sourceHasDate,
  type Direction,
  type EditExercise,
  type EditItem,
  type EditorResult,
  type EditorStatus,
  type SourceType,
} from '@/lib/console/editor';
import {
  checkNative,
  checkRomanisation,
  isStorable,
  normaliseNative,
} from '@/lib/script-check';
import { ActionNotice } from './action-notice';
import {
  Disclosure,
  useEditFocus,
  useRefocus,
  useRetiredFocus,
} from './disclosure';
import { RetireBlocked, RetireButton } from './reason-dialog';
import { ReorderButtons } from './reorder-buttons';
import { UnsavedNote, useDirtyForm } from './unsaved';

export type EditorLanguage = { code: string; direction: Direction };

type Provenance = {
  source_type: SourceType;
  source_citation: string;
  source_licence: string;
};

type ItemResult = Awaited<ReturnType<typeof updateItem>>;

type Sibling = Pick<EditItem, 'id' | 'position' | 'native' | 'meaning'>;

/** One labelled plain field (input or textarea) with an optional hint. */
function Field({
  name,
  label,
  hint,
  defaultValue,
  value,
  onChange,
  required = false,
  multiline = false,
  maxLength,
  invalid,
  type = 'text',
  max,
}: {
  name: string;
  label: string;
  hint?: ReactNode;
  defaultValue?: string;
  /** Controlled, with onChange; otherwise defaultValue. */
  value?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  multiline?: boolean;
  maxLength?: number;
  invalid?: boolean;
  type?: 'text' | 'date';
  max?: string;
}) {
  const id = useId();
  const props = {
    id,
    name,
    ...(value !== undefined
      ? {
          value,
          onChange: (
            event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
          ) => onChange?.(event.target.value),
        }
      : { defaultValue }),
    required,
    maxLength,
    className: 'console-input',
    'aria-describedby': hint ? `${id}-hint` : undefined,
    'aria-invalid': invalid || undefined,
  };
  return (
    <div className="console-field">
      <label htmlFor={id} className="console-label">
        {label}
        {!required && <span className="editor-optional"> (optional)</span>}
      </label>
      {multiline ? (
        <textarea rows={2} {...props} />
      ) : (
        <input type={type} max={max} {...props} />
      )}
      {hint && (
        <p id={`${id}-hint`} className="console-hint">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * The phrase form, for a new phrase and for editing one: native text and
 * romanisation checked live as they are typed (ScriptField, the same rules
 * the database applies), the meaning, and a learner preview. The rest waits
 * behind one line each: context and usage note ("Add context or a usage
 * note", open when they hold something), and where the phrase comes from (a
 * summary with "Change", open when it needs attention). A phrase with the
 * same text or meaning as another in the lesson is pointed out, not
 * blocked. The database’s own refusals show after a save.
 */
function ItemForm({
  lessonId,
  item,
  provenance,
  siblings,
  language,
  today,
  action,
  result,
  submitLabel,
  pendingLabel,
  onCancel,
}: {
  lessonId: string;
  item: EditItem | null;
  provenance: Provenance;
  /** The lesson’s live phrases, for the duplicate warning. */
  siblings: readonly Sibling[];
  language: EditorLanguage;
  today: string;
  action: (formData: FormData) => void;
  result: EditorResult<unknown> | null;
  submitLabel: string;
  pendingLabel: string;
  onCancel: () => void;
}) {
  const values = result && !result.ok ? result.values : undefined;
  const field = result && !result.ok ? result.field : undefined;
  const { ref, dirty, onChange } = useDirtyForm();
  const [native, setNative] = useState(echo(values, 'native', item?.native));
  const [romanisation, setRomanisation] = useState(
    echo(values, 'romanisation', item?.romanisation),
  );
  const [meaning, setMeaning] = useState(
    echo(values, 'meaning', item?.meaning),
  );
  const [sourceType, setSourceType] = useState<string>(
    echo(values, 'source_type', item?.source_type ?? provenance.source_type),
  );
  const [citation, setCitation] = useState(
    echo(
      values,
      'source_citation',
      item?.source_citation ?? provenance.source_citation,
    ),
  );
  const [licence, setLicence] = useState(
    echo(
      values,
      'source_licence',
      item?.source_licence ?? provenance.source_licence,
    ),
  );
  const initialContext = echo(values, 'context', item?.context);
  const initialUsage = echo(values, 'usage_note', item?.usage_note);
  const [notesOpen, setNotesOpen] = useState(
    initialContext !== '' ||
      initialUsage !== '' ||
      field === 'context' ||
      field === 'usage_note',
  );
  const [sourceOpen, setSourceOpen] = useState(
    Boolean(field?.startsWith('source_')),
  );
  const meaningId = useId();
  const sourceId = useId();
  const sourcePanelId = useId();
  const blockedId = useId();
  const notesPanel = useRef<HTMLDivElement>(null);
  const openedNotes = useRef(false);
  useEffect(() => {
    if (notesOpen && openedNotes.current)
      notesPanel.current?.querySelector<HTMLElement>('textarea')?.focus();
  }, [notesOpen]);

  const issues = [
    ...(native.trim()
      ? checkNative(language.code, normaliseNative(native))
      : []),
    ...(romanisation.trim() ? checkRomanisation(romanisation) : []),
  ];
  const storable = isStorable(issues);
  const duplicate = duplicateOf(siblings, { native, meaning }, item?.id);
  // Hidden fields must already be valid, or the browser could not say why
  // the form will not send: an incomplete source keeps its fields open.
  const showSource = sourceOpen || !provenanceValid(citation, licence);
  const dated = sourceHasDate(sourceType);

  return (
    <form
      ref={ref}
      action={action}
      onChange={onChange}
      className="console-form editor-item-form"
    >
      <input type="hidden" name="lesson_id" value={lessonId} />
      {item && (
        <>
          <input type="hidden" name="item_id" value={item.id} />
          <input type="hidden" name="revision_no" value={item.revision_no} />
        </>
      )}
      <div className="editor-item-form-grid">
        <div className="editor-item-form-fields">
          <ScriptField
            name="native"
            label="Phrase"
            language={language.code}
            dir={language.direction}
            kind="native"
            defaultValue={native}
            required
            maxLength={LIMITS.native.max}
            hint="Exactly as learners will read it. Checked as you type."
            onValueChange={(value) => setNative(value)}
          />
          <ScriptField
            name="romanisation"
            label="Romanisation"
            language={language.code}
            kind="romanisation"
            defaultValue={romanisation}
            required
            maxLength={LIMITS.romanisation.max}
            hint="How it sounds, in Latin letters, like “Salaam”."
            onValueChange={(value) => setRomanisation(value)}
          />
          <div className="console-field">
            <label htmlFor={meaningId} className="console-label">
              Meaning
            </label>
            <input
              id={meaningId}
              name="meaning"
              className="console-input"
              required
              maxLength={LIMITS.meaning.max}
              value={meaning}
              onChange={(event) => setMeaning(event.target.value)}
              aria-invalid={field === 'meaning' || undefined}
              aria-describedby={duplicate ? `${meaningId}-same` : undefined}
            />
          </div>
          <p
            id={`${meaningId}-same`}
            className="editor-duplicate"
            aria-live="polite"
          >
            {duplicate &&
              `Same as phrase ${duplicate.position}, “${duplicate.meaning}”. You can still save it, but learners would see it twice.`}
          </p>
          {notesOpen ? (
            <div ref={notesPanel} className="editor-item-notes">
              <Field
                name="context"
                label="Context"
                hint="When you’d say it, in a sentence. Learners see it under the phrase."
                defaultValue={initialContext}
                maxLength={LIMITS.context.max}
                multiline
                invalid={field === 'context'}
              />
              <Field
                name="usage_note"
                label="Usage note"
                hint="Anything that helps it land: politeness, who says it, what to watch for."
                defaultValue={initialUsage}
                maxLength={LIMITS.usageNote.max}
                multiline
                invalid={field === 'usage_note'}
              />
            </div>
          ) : (
            <button
              type="button"
              className="editor-link-button editor-more-fields"
              aria-expanded={false}
              onClick={() => {
                openedNotes.current = true;
                setNotesOpen(true);
              }}
            >
              Add context or a usage note
            </button>
          )}
        </div>
        <div className="editor-item-form-preview" aria-hidden="true">
          <p className="editor-preview-label">How learners see it</p>
          {native.trim() ? (
            <NativePreview
              native={normaliseNative(native)}
              romanisation={romanisation.trim() || null}
              meaning={meaning.trim() || null}
              lang={language.code}
              dir={language.direction}
              large={false}
            />
          ) : (
            <p className="editor-preview-empty">
              Type the phrase to see it here.
            </p>
          )}
        </div>
      </div>

      <div className="editor-source-box">
        <div className="editor-source-summary">
          <p>
            <span className="editor-source-summary-label">
              Where it comes from:
            </span>{' '}
            {SOURCE_TYPE_LABELS[sourceType as SourceType] ?? sourceType}
            {citation.trim() && ` · ${citation.trim()}`}
          </p>
          {!showSource && (
            <button
              type="button"
              className="editor-link-button"
              aria-expanded={false}
              aria-controls={sourcePanelId}
              onClick={() => setSourceOpen(true)}
            >
              Change<span className="editor-visually-hidden"> the source</span>
            </button>
          )}
        </div>
        {/* Collapsed, the fields stay in the form (hidden), so they save. */}
        <fieldset
          id={sourcePanelId}
          className="editor-fieldset"
          hidden={!showSource}
        >
          <legend className="editor-visually-hidden">
            Where it comes from
          </legend>
          <div className="editor-field-row">
            <div className="console-field">
              <label htmlFor={sourceId} className="console-label">
                Source
              </label>
              <select
                id={sourceId}
                name="source_type"
                className="console-input"
                value={sourceType}
                onChange={(event) => {
                  const next = event.target.value;
                  setSourceType(next);
                  const wasDefault =
                    citation === ORIGINAL_PROVENANCE.source_citation &&
                    licence === ORIGINAL_PROVENANCE.source_licence;
                  if (
                    next === 'original' &&
                    !citation.trim() &&
                    !licence.trim()
                  ) {
                    setCitation(ORIGINAL_PROVENANCE.source_citation);
                    setLicence(ORIGINAL_PROVENANCE.source_licence);
                  } else if (next !== 'original' && wasDefault) {
                    // The team’s credit doesn’t fit someone else’s words.
                    setCitation('');
                    setLicence('');
                  }
                }}
                aria-invalid={field === 'source_type' || undefined}
              >
                {SOURCE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {SOURCE_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
            <div hidden={!dated}>
              <Field
                name="source_retrieved"
                label="Retrieved on"
                type="date"
                max={dated ? today : undefined}
                defaultValue={echo(
                  values,
                  'source_retrieved',
                  item?.source_retrieved,
                )}
                invalid={field === 'source_retrieved'}
              />
            </div>
          </div>
          <Field
            name="source_citation"
            label="Citation"
            hint="Who or what it comes from. Learners see this line."
            value={citation}
            onChange={setCitation}
            maxLength={LIMITS.citation.max}
            required
            invalid={field === 'source_citation'}
          />
          <Field
            name="source_licence"
            label="Licence"
            hint="What lets us use it, like “Written for PoliLingo” or “CC BY 4.0”."
            value={licence}
            onChange={setLicence}
            maxLength={LIMITS.licence.max}
            required
            invalid={field === 'source_licence'}
          />
          <Field
            name="source_caveat"
            label="Caveat"
            defaultValue={echo(values, 'source_caveat', item?.source_caveat)}
            maxLength={LIMITS.caveat.max}
            invalid={field === 'source_caveat'}
          />
        </fieldset>
      </div>

      {item && item.review_status !== 'unreviewed' && (
        <Notice tone="info">
          Changing the phrase, romanisation, meaning, context, usage note or
          citation sends it back to review.
        </Notice>
      )}
      <ActionNotice result={result} />
      {!storable && (
        <p id={blockedId} className="editor-blocked-hint">
          Fix the text problems above to save.
        </p>
      )}
      <div className="console-actions">
        <SubmitButton
          pendingLabel={pendingLabel}
          disabled={!storable}
          aria-describedby={!storable ? blockedId : undefined}
        >
          {submitLabel}
        </SubmitButton>
        <button
          type="button"
          className="console-button console-button-quiet"
          onClick={onCancel}
        >
          Cancel
        </button>
        <UnsavedNote dirty={dirty} />
      </div>
    </form>
  );
}

/** One phrase: how it reads, its status and source, and its tools. */
function ItemCard({
  item,
  ids,
  siblings,
  exercises,
  lessonId,
  language,
  submitted,
  lessonStatus,
  locked,
  today,
  lessonVariety,
  varietyNames,
  onRetired,
}: {
  item: EditItem;
  ids: string[];
  siblings: readonly Sibling[];
  exercises: readonly EditExercise[];
  lessonId: string;
  language: EditorLanguage;
  submitted: boolean;
  lessonStatus: EditorStatus;
  locked: boolean;
  today: string;
  lessonVariety: string;
  varietyNames: Readonly<Record<string, string>>;
  onRetired: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const { containerRef, triggerRef } = useEditFocus(editing);
  const [saved, setSaved] = useState(false);
  const [result, formAction] = useActionState(
    async (previous: ItemResult | null, formData: FormData) => {
      const next = await updateItem(previous, formData);
      if (next.ok) {
        setEditing(false);
        setSaved(true);
      }
      return next;
    },
    null,
  );
  const label = `phrase “${item.meaning}”`;
  const decision = item.last_decision;
  const status = itemStatus(item, submitted);
  const { using, answerIn } = exercisesUsing(item.id, exercises);
  return (
    <li ref={containerRef} id={`item-${item.id}`} className="editor-card">
      <div className="editor-card-head">
        <span className="editor-card-number" aria-hidden="true">
          {item.position}
        </span>
        {/* The lesson’s own status is in the header: only a phrase that
            differs from it (approved, sent back) says so. */}
        {status !== lessonStatus && <StatusBadge status={status} />}
        {answerIn > 0 && (
          <span className="editor-muted">
            Answer in {answerIn} {answerIn === 1 ? 'exercise' : 'exercises'}
          </span>
        )}
        {!locked && !editing && (
          <div className="editor-card-tools">
            <button
              ref={triggerRef}
              type="button"
              data-card-edit
              className="console-button console-button-outline editor-small-button"
              onClick={() => {
                setSaved(false);
                setEditing(true);
              }}
              aria-label={`Edit ${label}`}
            >
              Edit
            </button>
            <ReorderButtons
              parentType="lesson"
              parentId={lessonId}
              ids={ids}
              id={item.id}
              label={label}
            />
            {using.length > 0 ? (
              <RetireBlocked
                what={`phrase ${item.position}`}
                exercises={using}
                itemId={item.id}
              />
            ) : (
              <RetireButton
                type="item"
                id={item.id}
                lessonId={lessonId}
                what={`phrase ${item.position}`}
                onRetired={onRetired}
              />
            )}
          </div>
        )}
      </div>

      {editing ? (
        <ItemForm
          lessonId={lessonId}
          item={item}
          provenance={item}
          siblings={siblings}
          language={language}
          today={today}
          action={formAction}
          result={result}
          submitLabel="Save phrase"
          pendingLabel="Saving…"
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="editor-phrase">
            <NativeText
              text={item.native}
              lang={language.code}
              dir={language.direction}
              large
            />
            <p className="editor-phrase-roman" dir="ltr">
              {item.romanisation}
            </p>
            <p className="editor-phrase-meaning">{item.meaning}</p>
          </div>
          {(item.context || item.usage_note) && (
            <dl className="editor-notes">
              {item.context && (
                <>
                  <dt>Context</dt>
                  <dd>{item.context}</dd>
                </>
              )}
              {item.usage_note && (
                <>
                  <dt>Usage</dt>
                  <dd>{item.usage_note}</dd>
                </>
              )}
            </dl>
          )}
          <p className="editor-source">
            {SOURCE_TYPE_LABELS[item.source_type]} · {item.source_citation}
            {item.source_retrieved && ` · ${item.source_retrieved}`}
          </p>
          {item.variety_id !== lessonVariety && (
            <p className="editor-source">
              Variety: {varietyNames[item.variety_id] ?? item.variety_id}, not
              the lesson’s {varietyNames[lessonVariety] ?? lessonVariety}. Its
              reviewers are that variety’s.
            </p>
          )}
          {decision && decision.current && decision.comment && (
            <Notice
              tone={decision.decision === 'approve' ? 'info' : 'warning'}
              title={
                decision.decision === 'approve'
                  ? 'Reviewer’s note'
                  : 'The reviewer asked for changes'
              }
            >
              <p>{decision.comment}</p>
            </Notice>
          )}
        </>
      )}
      <div className="editor-result" aria-live="polite">
        {saved && !editing && <p className="editor-saved">Saved.</p>}
      </div>
    </li>
  );
}

const onHashChange = (change: () => void) => {
  window.addEventListener('hashchange', change);
  return () => window.removeEventListener('hashchange', change);
};
const readHash = () => window.location.hash;
const noHash = () => '';

/**
 * The lesson’s phrases, in order, each with Edit, Move up / Move down and
 * Retire, and "Add a phrase" at the foot (a lesson holds up to 12).
 */
export function ItemList({
  lessonId,
  items,
  exercises,
  language,
  submitted,
  lessonStatus,
  locked,
  provenance,
  today,
  lessonVariety,
  varietyNames,
}: {
  lessonId: string;
  items: EditItem[];
  exercises: EditExercise[];
  language: EditorLanguage;
  submitted: boolean;
  /** The lesson’s badge: a phrase shows its own only when it differs. */
  lessonStatus: EditorStatus;
  locked: boolean;
  provenance: Provenance;
  today: string;
  /** The lesson’s variety; a phrase in another one says so. */
  lessonVariety: string;
  varietyNames: Readonly<Record<string, string>>;
}) {
  const ids = items.map((i) => i.id);
  // "Create and open" lands on #items-heading: a new lesson opens straight
  // into its first phrase, until the editor opens or closes the form.
  const hash = useSyncExternalStore(onHashChange, readHash, noHash);
  const [choice, setAdding] = useState<boolean | null>(null);
  const full = items.length >= MAX_ITEMS;
  const adding = choice ?? (!locked && !full && hash === '#items-heading');
  const [formKey, setFormKey] = useState(0);
  const newFormRef = useRefocus(formKey);
  const [added, setAdded] = useState<string | null>(null);
  const { listRef, announcement, markRetired, clear } = useRetiredFocus(items);
  const [result, formAction] = useActionState(
    async (previous: ItemResult | null, formData: FormData) => {
      const next = await createItem(previous, formData);
      if (next.ok) {
        const meaning = formData.get('meaning');
        setAdded(typeof meaning === 'string' ? meaning.trim() : '');
        setFormKey((k) => k + 1);
      }
      return next;
    },
    null,
  );

  return (
    <div ref={listRef} className="editor-items">
      {items.length === 0 ? (
        !locked && (
          <EmptyState title="No phrases yet">
            <p>
              Add the first phrase. A lesson holds up to {MAX_ITEMS}; with 3 or
              more, “Generate exercises” can write the exercises for you.
            </p>
          </EmptyState>
        )
      ) : (
        <ol className="editor-cards">
          {items.map((item, index) => (
            <ItemCard
              key={item.id}
              item={item}
              ids={ids}
              siblings={items}
              exercises={exercises}
              lessonId={lessonId}
              language={language}
              submitted={submitted}
              lessonStatus={lessonStatus}
              locked={locked}
              today={today}
              lessonVariety={lessonVariety}
              varietyNames={varietyNames}
              onRetired={() => {
                setAdded(null);
                markRetired(item.id, index, `Phrase ${item.position} retired.`);
              }}
            />
          ))}
        </ol>
      )}

      <div className="editor-result" aria-live="polite">
        {announcement && <Notice tone="success">{announcement}</Notice>}
      </div>

      {!locked &&
        (full ? (
          <p className="editor-muted">
            This lesson has {MAX_ITEMS} phrases, the most a lesson holds. Start
            a new lesson in the same unit for more.
          </p>
        ) : (
          <>
            <div className="editor-result" aria-live="polite">
              {added !== null && (
                <p className="editor-saved">
                  Added{added ? ` “${added}”` : ''}. Add another, or close the
                  form.
                </p>
              )}
            </div>
            <Disclosure
              label="Add a phrase"
              tone={items.length === 0 ? 'primary' : 'outline'}
              open={adding}
              onOpenChange={(open) => {
                setAdding(open);
                setAdded(null);
                clear();
              }}
            >
              <div ref={newFormRef} className="editor-card editor-card-new">
                <p className="editor-form-title">
                  New phrase {items.length + 1} of up to {MAX_ITEMS}
                </p>
                <ItemForm
                  key={formKey}
                  lessonId={lessonId}
                  item={null}
                  provenance={provenance}
                  siblings={items}
                  language={language}
                  today={today}
                  action={formAction}
                  result={result?.ok ? null : result}
                  submitLabel="Add phrase"
                  pendingLabel="Adding…"
                  onCancel={() => setAdding(false)}
                />
              </div>
            </Disclosure>
          </>
        ))}
    </div>
  );
}
