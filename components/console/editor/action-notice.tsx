'use client';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Notice } from '@/components/console/notice';
import { noticeTone, type EditorResult } from '@/lib/console/editor';

/**
 * What a save came back with: `success` when it worked, otherwise the
 * database's refusal in plain English with its code in small print. A
 * stale edit offers to load the latest version. The wrapper is a live
 * region that exists before any result, so a success is announced too.
 */
export function ActionNotice({
  result,
  success,
}: {
  result: EditorResult<unknown> | null;
  success?: ReactNode;
}) {
  const router = useRouter();
  return (
    <div className="editor-result" aria-live="polite">
      {result?.ok && success && <Notice tone="success">{success}</Notice>}
      {result && !result.ok && (
        <Notice tone={noticeTone(result.code)} code={result.code}>
          <p>{result.message}</p>
          {(result.code === 'PL409_STALE_EDIT' ||
            result.code === 'PL409_RETIRED') && (
            <button
              type="button"
              className="console-button console-button-outline editor-inline-button"
              onClick={() => router.refresh()}
            >
              Load the latest version
            </button>
          )}
        </Notice>
      )}
    </div>
  );
}
