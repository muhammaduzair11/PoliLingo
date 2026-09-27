'use server';
/**
 * Course maker writes for the lesson tree (docs/platform.md 3.9 E, 4.3):
 * new units and lessons, reordering, retiring, and the admin-only publish
 * gates and demo sunset. Each calls one database function as the signed-in
 * person; the database checks the role, the language and the state, and a
 * refusal comes back as one plain-English sentence (describeDbError).
 *
 * The lesson page's own writes are in ./lesson/[id]/actions.ts.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  LESSON_FIELDS,
  UNIT_FIELDS,
  clean,
  formValues,
  parseLessonForm,
  parseReason,
  parseUnitForm,
  type EditorResult,
} from '@/lib/console/editor';
import { editLessonPath, editTreePath } from '@/lib/console/paths';
import { callRpc } from '@/lib/rpc';
import { serverSupabase } from '@/lib/supabase/server';

const LESSON_ID = /^[a-z]{2,3}-lsn-[0-9a-f]{6}$/;

/** Refreshes the tree, and the lesson page when one is named. */
function refresh(lessonId?: string | null) {
  revalidatePath(editTreePath());
  if (lessonId && LESSON_ID.test(lessonId))
    revalidatePath(editLessonPath(lessonId));
}

/** A refusal with what was typed, so the form can show it again. */
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

/** One database function as the signed-in person, keeping a refusal's detail. */
async function run<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<EditorResult<T>> {
  const result = await callRpc<T>(await serverSupabase(), fn, args);
  return result.ok ? result : refused(result.error);
}

/** A new unit at the end of a course. It starts held back from learners. */
export async function createUnit(
  _previous: EditorResult<{ id: string }> | null,
  formData: FormData,
): Promise<EditorResult<{ id: string }>> {
  const values = formValues(formData, UNIT_FIELDS);
  const parsed = parseUnitForm(formData);
  if (!parsed.ok) return refused(parsed, values);
  const result = await run<string>('create_unit', {
    p_course_id: clean(formData.get('course_id')),
    p_title: parsed.value.title,
    p_goal: parsed.value.goal,
    p_theme: parsed.value.theme,
  });
  if (!result.ok) return { ...result, values };
  refresh();
  return { ok: true, data: { id: result.data } };
}

/** A new lesson at the end of a unit; then opens it in the lesson editor. */
export async function createLesson(
  _previous: EditorResult<{ id: string }> | null,
  formData: FormData,
): Promise<EditorResult<{ id: string }>> {
  const values = formValues(formData, LESSON_FIELDS);
  const parsed = parseLessonForm(formData);
  if (!parsed.ok) return refused(parsed, values);
  const result = await run<string>('create_lesson', {
    p_unit_id: clean(formData.get('unit_id')),
    p_title: parsed.value.title,
    p_objective: parsed.value.objective,
    p_subtitle: parsed.value.subtitle,
    p_variety_id: parsed.value.variety,
    p_estimated_minutes: parsed.value.estimated_minutes,
  });
  if (!result.ok) return { ...result, values };
  refresh();
  redirect(editLessonPath(result.data));
}

export type ParentType = 'course' | 'unit' | 'lesson';

/**
 * Puts a parent's live children in the order given (every child, once):
 * a course's units, a unit's lessons, a lesson's phrases or exercises.
 * Called directly by the up and down buttons.
 */
export async function reorderChildren(
  parentType: ParentType,
  parentId: string,
  childIds: string[],
): Promise<EditorResult<{ order: string[] }>> {
  if (
    !['course', 'unit', 'lesson'].includes(parentType) ||
    typeof parentId !== 'string' ||
    !Array.isArray(childIds) ||
    childIds.some((id) => typeof id !== 'string')
  )
    return refused({
      code: 'PL422_BAD_INPUT',
      message: "That move didn't make sense. Reload the page and try again.",
    });
  const result = await run<{ order: string[] }>('reorder_children', {
    p_parent_type: parentType,
    p_parent_id: parentId,
    p_child_ids: childIds,
  });
  if (result.ok) refresh(parentType === 'lesson' ? parentId : null);
  return result;
}

/**
 * Retires a unit, lesson, phrase or exercise, with a reason. Nothing is
 * deleted: retired content leaves the lesson and its id is never reused.
 */
export async function retireContent(
  _previous: EditorResult<unknown> | null,
  formData: FormData,
): Promise<EditorResult<unknown>> {
  const values = formValues(formData, ['reason']);
  const type = clean(formData.get('type'));
  const id = clean(formData.get('id'));
  const reason = parseReason(formData);
  if (!reason.ok) return refused(reason, values);
  const result = await run<unknown>('retire_content', {
    p_type: type,
    p_id: id,
    p_reason: reason.value,
  });
  if (!result.ok) return { ...result, values };
  refresh(clean(formData.get('lesson_id')) || (type === 'lesson' ? id : null));
  return result;
}

/** Opens a unit, lesson or variety to learners, or holds it back (admin). */
export async function setPublishGate(
  _previous: EditorResult<unknown> | null,
  formData: FormData,
): Promise<EditorResult<unknown>> {
  const values = formValues(formData, ['reason']);
  const reason = parseReason(formData);
  if (!reason.ok) return refused(reason, values);
  const result = await run<unknown>('set_publish_gate', {
    p_type: clean(formData.get('type')),
    p_id: clean(formData.get('id')),
    p_gate: clean(formData.get('gate')),
    p_reason: reason.value,
  });
  if (!result.ok) return { ...result, values };
  refresh(clean(formData.get('lesson_id')));
  return result;
}

/** Moves the last day a language's demo lessons stay live (admin). */
export async function setDemoSunset(
  _previous: EditorResult<unknown> | null,
  formData: FormData,
): Promise<EditorResult<unknown>> {
  const values = formValues(formData, ['sunset', 'reason']);
  const sunset = clean(formData.get('sunset'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sunset))
    return refused(
      {
        code: 'PL422_BAD_DATE',
        message: 'Choose the last day the demo lessons stay live.',
        field: 'sunset',
      },
      values,
    );
  const reason = parseReason(formData);
  if (!reason.ok) return refused(reason, values);
  const result = await run<unknown>('set_demo_sunset', {
    p_language: clean(formData.get('language')),
    p_sunset: sunset,
    p_reason: reason.value,
  });
  if (!result.ok) return { ...result, values };
  refresh();
  return result;
}
