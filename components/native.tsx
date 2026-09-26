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
