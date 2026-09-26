'use client';
import { Notice } from '@/components/console/notice';
import { PageHeader } from '@/components/console/page-header';

/**
 * Publish failed to render. The error's own text is never shown (it can
 * hold server details); its digest goes in the small print for support.
 */
export default function PublishError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="publish-page">
      <PageHeader eyebrow="Admin" title="Publish" />
      <Notice
        tone="error"
        title="We couldn't open Publish"
        code={error.digest ?? null}
      >
        <p>Nothing was published or changed. Please try again.</p>
      </Notice>
      <p className="console-actions">
        <button
          type="button"
          className="console-button console-button-outline"
          onClick={() => retry()}
        >
          Try again
        </button>
      </p>
    </div>
  );
}
