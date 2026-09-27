import type { Metadata } from 'next';
import { NotFoundView } from '@/components/status-views';
export const metadata: Metadata = { title: 'Page not found' };
export default function Page() {
  return <NotFoundView />;
}
