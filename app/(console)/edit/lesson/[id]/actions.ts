'use server';
/**
 * The lesson editor's writes (docs/platform.md 3.9 E, 4.10): the lesson's
 * details, its phrases and exercises, "Generate exercises", and handing the
 * lesson to review. Each calls database functions as the signed-in person;
 * the database decides (role, language, demo freeze, text rules, option
 * rules, stale edits) and a refusal comes back in plain English.
 *
 * Reordering and retiring are shared with the tree: ../../actions.ts.
 */
import { revalidatePath } from 'next/cache';
import {
  EXERCISE_FIELDS,
  ITEM_FIELDS,
  LESSON_FIELDS,
  clean,
  formValues,
  parseExerciseForm,
  parseItemForm,
  parseLessonForm,
  parseRevision,
  utcToday,
  type EditLessonPage,
  type EditorResult,
} from '@/lib/console/editor';
import { generateExercises as planExercises } from '@/lib/console/exercise-generator';
import { editLessonPath, editTreePath } from '@/lib/console/paths';
import { callRpc } from '@/lib/rpc';
import { serverSupabase } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

const LESSON_ID = /^[a-z]{2,3}-lsn-[0-9a-f]{6}$/;

function refresh(lessonId: string) {
  revalidatePath(editTreePath());
  if (LESSON_ID.test(lessonId)) revalidatePath(editLessonPath(lessonId));
}

function refused<T>(
  result: { code: string; message: string; field?: string; detail?: unknown },
  values?: Record<string, string>,
): EditorResult<T> {
  return {
    ok: false,
    code: result.code,
    message: result.message,
    field: result.field,
    detail: result.detail,
    values,
  };
}

async function run<T>(
  supabase: SupabaseClient | null,
  fn: string,
  args: Record<string, unknown>,
): Promise<EditorResult<T>> {
  const result = await callRpc<T>(supabase, fn, args);
  return result.ok ? result : refused(result.error);
}

const STALE_FORM = {
  code: 'PL422_BAD_INPUT',
  message:
    "We couldn't tell which version you edited. Reload the page and try again.",
};

type Saved = { id: string; revision_no: number };

/** The lesson's title, subtitle, objective, variety and length. */
export async function updateLesson(
  _previous: EditorResult<Saved> | null,
  formData: FormData,
): Promise<EditorResult<Saved>> {
  const values = formValues(formData, LESSON_FIELDS);
  const lessonId = clean(formData.get('lesson_id'));
  const revision = parseRevision(formData.get('revision_no'));
  if (revision === null) return refused(STALE_FORM, values);
  const parsed = parseLessonForm(formData);
  if (!parsed.ok) return refused(parsed, values);
  const { title, subtitle, objective, variety, estimated_minutes } =
    parsed.value;
  const patch: Record<string, unknown> = {
    title,
    subtitle,
    objective,
    estimated_minutes,
  };
  if (variety) patch.variety = variety;
  const result = await run<Saved>(await serverSupabase(), 'update_lesson', {
    p_id: lessonId,
    p_expected_revision: revision,
    p_patch: patch,
  });
  if (!result.ok) return { ...result, values };
  refresh(lessonId);
  return result;
}

/** A new phrase at the end of the lesson. */
export async function createItem(
  _previous: EditorResult<Saved> | null,
  formData: FormData,
): Promise<EditorResult<Saved>> {
  const values = formValues(formData, ITEM_FIELDS);
  const lessonId = clean(formData.get('lesson_id'));
  const parsed = parseItemForm(formData, utcToday(new Date()));
  if (!parsed.ok) return refused(parsed, values);
  const result = await run<Saved>(await serverSupabase(), 'create_item', {
    p_lesson_id: lessonId,
    p_fields: parsed.value,
  });
  if (!result.ok) return { ...result, values };
  refresh(lessonId);
  return result;
}

/** A phrase's text, meaning, notes and source. Text changes void approval. */
export async function updateItem(
  _previous: EditorResult<Saved> | null,
  formData: FormData,
): Promise<EditorResult<Saved>> {
  const values = formValues(formData, ITEM_FIELDS);
  const itemId = clean(formData.get('item_id'));
  const lessonId = clean(formData.get('lesson_id'));
  const revision = parseRevision(formData.get('revision_no'));
  if (revision === null) return refused(STALE_FORM, values);
  const parsed = parseItemForm(formData, utcToday(new Date()));
  if (!parsed.ok) return refused(parsed, values);
  const result = await run<Saved>(await serverSupabase(), 'update_item', {
    p_id: itemId,
    p_expected_revision: revision,
    p_patch: parsed.value,
  });
  if (!result.ok) return { ...result, values };
  refresh(lessonId);
  return result;
}

/** A new exercise at the end of the lesson. */
export async function createExercise(
  _previous: EditorResult<string> | null,
  formData: FormData,
): Promise<EditorResult<string>> {
  const values = formValues(formData, EXERCISE_FIELDS);
  const lessonId = clean(formData.get('lesson_id'));
  const parsed = parseExerciseForm(formData);
  if (!parsed.ok) return refused(parsed, values);
  const result = await run<string>(await serverSupabase(), 'create_exercise', {
    p_lesson_id: lessonId,
    p_fields: parsed.value,
  });
  if (!result.ok) return { ...result, values };
  refresh(lessonId);
  return result;
}

/** An exercise's kind, answer, prompt, choices and difficulty. */
export async function updateExercise(
  _previous: EditorResult<Saved> | null,
  formData: FormData,
): Promise<EditorResult<Saved>> {
  const values = formValues(formData, EXERCISE_FIELDS);
  const exerciseId = clean(formData.get('exercise_id'));
  const lessonId = clean(formData.get('lesson_id'));
  const revision = parseRevision(formData.get('revision_no'));
  if (revision === null) return refused(STALE_FORM, values);
  const parsed = parseExerciseForm(formData);
  if (!parsed.ok) return refused(parsed, values);
  const result = await run<Saved>(await serverSupabase(), 'update_exercise', {
    p_id: exerciseId,
    p_expected_revision: revision,
    p_patch: parsed.value,
  });
  if (!result.ok) return { ...result, values };
  refresh(lessonId);
  return result;
}

export type Generated = { added: number; planned: number };

/**
 * "Generate exercises": plans from the lesson as it is in the database now
 * (lib/console/exercise-generator.ts, deterministic), then saves each
 * planned exercise under an id reserved for it with reserve_content_id.
 * What the lesson already has is never planned twice, so running it again
 * after a failure adds only what is still missing.
 */
export async function generateExercises(
  _previous: EditorResult<Generated> | null,
  formData: FormData,
): Promise<EditorResult<Generated>> {
  const lessonId = clean(formData.get('lesson_id'));
  const supabase = await serverSupabase();
  const page = await run<EditLessonPage>(supabase, 'page_edit_lesson', {
    p_lesson_id: lessonId,
  });
  if (!page.ok) return page;
  const plan = planExercises(page.data.items, page.data.exercises);
  if (plan.length === 0)
    return refused({
      code: 'PL422_NO_CHANGE',
      message:
        page.data.items.length === 0
          ? 'Add some phrases first. Exercises are made from them.'
          : 'Every phrase already has its exercises. Add a phrase to get more.',
    });

  let added = 0;
  for (const exercise of plan) {
    const id = await run<string>(supabase, 'reserve_content_id', {
      p_type: 'exercise',
      p_language: page.data.language.code,
    });
    const saved = id.ok
      ? await run<string>(supabase, 'create_exercise', {
          p_lesson_id: lessonId,
          p_fields: {
            id: id.data,
            kind: exercise.kind,
            answer: exercise.answer,
            prompt: exercise.prompt,
            options: exercise.options,
          },
        })
      : id;
    if (!saved.ok) {
      if (added > 0) refresh(lessonId);
      return refused({
        code: saved.code,
        message:
          added > 0
            ? `Added ${added} of ${plan.length} exercises, then stopped: ${saved.message} Press Generate again to add the rest.`
            : saved.message,
        detail: saved.detail,
      });
    }
    added += 1;
  }
  refresh(lessonId);
  return { ok: true, data: { added, planned: plan.length } };
}

type Submission = {
  lesson_id: string;
  submitted_at: string | null;
  review_status: string;
  already: boolean;
};

/** Sends the lesson to its variety's reviewers. */
export async function submitLesson(
  _previous: EditorResult<Submission> | null,
  formData: FormData,
): Promise<EditorResult<Submission>> {
  const lessonId = clean(formData.get('lesson_id'));
  const result = await run<Submission>(
    await serverSupabase(),
    'submit_lesson',
    {
      p_lesson_id: lessonId,
    },
  );
  if (result.ok) refresh(lessonId);
  return result;
}

/** Takes the lesson back out of review, to keep working on it. */
export async function withdrawSubmission(
  _previous: EditorResult<Submission> | null,
  formData: FormData,
): Promise<EditorResult<Submission>> {
  const lessonId = clean(formData.get('lesson_id'));
  const result = await run<Submission>(
    await serverSupabase(),
    'withdraw_lesson_submission',
    { p_lesson_id: lessonId },
  );
  if (result.ok) refresh(lessonId);
  return result;
}
