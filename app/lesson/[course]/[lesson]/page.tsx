import { LessonPlayer } from '@/components/lesson-player';
export default async function Page({
  params,
}: {
  params: Promise<{ course: string; lesson: string }>;
}) {
  const { course, lesson } = await params;
  return (
    <LessonPlayer
      key={`${course}/${lesson}`}
      courseId={course}
      lessonId={lesson}
    />
  );
}
