import type { Metadata } from 'next';
import { LessonPlayer } from '@/components/lesson-player';
import { getCourse } from '@/lib/content';

type Params = Promise<{ course: string; lesson: string }>;

/**
 * The tab says which lesson this is: "A little hello · Pashto", and the root
 * layout's template adds "· PoliLingo". The server only knows the baseline
 * release, so a lesson that exists only in a newer published release gets
 * its title from the player once that release is active.
 */
export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { course, lesson } = await params;
  const c = getCourse(course);
  const l = c?.lessons.find((x) => x.id === lesson);
  return { title: c && l ? `${l.title} · ${c.name}` : 'Lesson' };
}

export default async function Page({ params }: { params: Params }) {
  const { course, lesson } = await params;
  return (
    <LessonPlayer
      key={`${course}/${lesson}`}
      courseId={course}
      lessonId={lesson}
    />
  );
}
