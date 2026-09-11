import { Dashboard } from '@/components/polilingo';
export default async function Page({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course } = await params;
  return <Dashboard courseId={course} />;
}
