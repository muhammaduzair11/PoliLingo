import { Dashboard } from '@/components/dashboard';
export default async function Page({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course } = await params;
  return <Dashboard courseId={course} />;
}
