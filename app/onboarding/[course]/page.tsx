import type { Metadata } from 'next';
import { Onboarding } from '@/components/onboarding';
import { courseTitle } from '@/app/learn/course-title';
type Props = { params: Promise<{ course: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: courseTitle((await params).course) };
}
export default async function Page({ params }: Props) {
  const { course } = await params;
  return <Onboarding courseId={course} />;
}
