import { PageHeader } from '@/components/console/page-header';

/** While page_admin_publish builds the preview (a second or two). */
export default function PublishLoading() {
  return (
    <div className="publish-page" aria-busy="true">
      <PageHeader
        eyebrow="Admin"
        title="Publish"
        description="Send reviewed lessons to learners. Check what changes for them, then publish a new release."
      />
      <output className="publish-loading-text">
        Building the preview of the next release…
      </output>
      <div className="publish-status" aria-hidden="true">
        <div className="publish-status-card publish-skeleton" />
        <span className="publish-status-arrow" />
        <div className="publish-status-card publish-skeleton" />
      </div>
      <div
        className="publish-skeleton publish-skeleton-table"
        aria-hidden="true"
      />
      <div
        className="publish-skeleton publish-skeleton-table"
        aria-hidden="true"
      />
    </div>
  );
}
