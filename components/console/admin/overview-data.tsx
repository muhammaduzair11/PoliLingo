import { adminOverviewPath } from '@/lib/console/paths';
import { buildOverview, type OverviewData } from '@/lib/console/overview';
import { callRpc } from '@/lib/rpc';
import { serverSupabase } from '@/lib/supabase/server';
import { LoadError } from './load-state';
import { OverviewView } from './overview-view';

/** Loads page_admin_overview() and renders it; streamed behind a skeleton. */
export async function OverviewData() {
  const result = await callRpc<OverviewData>(
    await serverSupabase(),
    'page_admin_overview',
  );
  if (!result.ok)
    return (
      <LoadError
        error={result.error}
        retryHref={adminOverviewPath()}
        what="the overview"
      />
    );
  return <OverviewView view={buildOverview(result.data)} />;
}
