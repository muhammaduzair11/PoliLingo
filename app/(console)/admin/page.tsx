import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminSkeleton } from '@/components/console/admin/load-state';
import { OverviewData } from '@/components/console/admin/overview-data';
import { PageHeader } from '@/components/console/page-header';
import { requireRole } from '@/lib/console/access';

export const metadata: Metadata = { title: 'Overview' };

/** /admin: how the curriculum and the team are doing (docs/platform.md 4.10). */
export default async function AdminOverviewPage() {
  const gate = await requireRole('admin');
  if (!gate.ok) return gate.view;
  const name = gate.context.contributor?.display_name?.split(/\s+/)[0];
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Overview"
        description={`Salaam${name ? `, ${name}` : ''}. Here’s how each language is coming along, who reviews it, and what learners have today.`}
      />
      <Suspense
        fallback={
          <AdminSkeleton label="Loading the overview…" variant="overview" />
        }
      >
        <OverviewData />
      </Suspense>
    </>
  );
}
