import { AdminSkeleton } from '@/components/console/admin/load-state';
import { ConsoleShell } from '@/components/console/shell';

/** While the invitation loads. */
export default function InviteLoading() {
  return (
    <ConsoleShell>
      <div className="invite-page">
        <AdminSkeleton label="Opening your invitation…" variant="invite" />
      </div>
    </ConsoleShell>
  );
}
