import { Onboarding } from '@/components/onboarding';
export default async function Page({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course } = await params;
  return <Onboarding courseId={course} />;
}
