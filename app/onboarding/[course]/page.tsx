import { Onboarding } from '@/components/polilingo';
export default async function Page({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course } = await params;
  return <Onboarding courseId={course} />;
}
