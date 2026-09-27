import type { Metadata } from 'next';
import { Dashboard } from '@/components/dashboard';
import { courseTitle } from '@/app/learn/course-title';
type Props = { params: Promise<{ course: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: courseTitle((await params).course) };
}
export default async function Page({ params }: Props) {
  const { course } = await params;
  return <Dashboard courseId={course} />;
}
