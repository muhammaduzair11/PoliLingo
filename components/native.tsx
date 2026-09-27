'use client';
import { useLearning } from './learning-provider';
import { type Course, type Phrase } from '@/lib/content';
export function Native({
  phrase,
  course,
  large = false,
}: {
  phrase: Pick<Phrase, 'native' | 'roman'>;
  course: Course;
  large?: boolean;
}) {
  const { state } = useLearning();
  return (
    <span className={`phrase ${large ? 'phrase-large' : ''}`}>
      <span className="native" lang={course.lang} dir={course.dir}>
        {phrase.native}
      </span>
      {state.prefs.transliteration && (
        <span className="roman" dir="ltr">
          {phrase.roman}
        </span>
      )}
    </span>
  );
}
/**
 * Native-script text with its language and direction, for the console,
 * where there is no Course and no learner preference: the caller passes
 * `lang` (ps, ur, hno) and `dir` from the language record.
 */
export function NativeText({
  text,
  lang,
  dir,
  large = false,
}: {
  text: string;
  lang: string;
  dir: 'rtl' | 'ltr';
  large?: boolean;
}) {
  return (
    <span
      className={`native native-text${large ? ' native-text-large' : ''}`}
      lang={lang}
      dir={dir}
    >
      {text}
    </span>
  );
}
