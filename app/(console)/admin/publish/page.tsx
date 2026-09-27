import type { Metadata } from 'next';
import { Notice } from '@/components/console/notice';
import { PageHeader } from '@/components/console/page-header';
import {
  PUBLISH_DESCRIPTION,
  PublishScreen,
} from '@/components/console/publish/publish-screen';
import type { PublishPageData } from '@/components/console/publish/types';
import { requireRole } from '@/lib/console/access';
import { adminPublishPath } from '@/lib/console/paths';
import { callRpc } from '@/lib/rpc';
import { serverSupabase } from '@/lib/supabase/server';
import {
  countersignDecision,
  publishRelease,
  rollbackRelease,
} from './actions';

export const metadata: Metadata = { title: 'Publish' };

/** Admins: the preview of the next release, the countersign queue and history. */
export default async function PublishPage() {
  const gate = await requireRole('admin');
  if (!gate.ok) return gate.view;

  const result = await callRpc<PublishPageData>(
    await serverSupabase(),
    'page_admin_publish',
  );
  if (!result.ok)
    return (
      <div className="publish-page">
        <PageHeader
          eyebrow="Admin"
          title="Publish"
          description={PUBLISH_DESCRIPTION}
        />
        <Notice
          tone="error"
          title="We couldn't build the preview"
          code={result.error.code}
        >
          <p>{result.error.message}</p>
          <p>
            <a className="publish-link" href={adminPublishPath()}>
              Try again
            </a>
          </p>
        </Notice>
      </div>
    );

  return (
    <PublishScreen
      data={result.data}
      publishAction={publishRelease}
      countersignAction={countersignDecision}
      rollbackAction={rollbackRelease}
    />
  );
}
