import { useEffect, useRef, useState } from 'react';
import { archiveCsv, collectPublicArchive } from '../lib/archive';

export function ArchiveExport({
  query,
  resourceRevision = 0,
}: {
  query: string;
  resourceRevision?: number;
}) {
  const active = useRef<AbortController | null>(null);
  const [status, setStatus] = useState({ busy: false, text: '', error: false });
  useEffect(
    () => () => {
      active.current?.abort();
    },
    [query, resourceRevision],
  );
  const start = async (format: 'csv' | 'json') => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setStatus({ busy: true, text: 'Preparing the selected public archive…', error: false });
    try {
      const archive = await collectPublicArchive(query, controller.signal, (records, batches) => {
        setStatus({
          busy: true,
          text: `Loaded ${records} records in ${batches} batches. Checking completion…`,
          error: false,
        });
      });
      controller.signal.throwIfAborted();
      const content = format === 'json' ? JSON.stringify(archive, null, 2) : archiveCsv(archive);
      const url = URL.createObjectURL(
        new Blob([content], {
          type: format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8',
        }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `million-beers-public-${archive.exportedAt.slice(0, 10)}-r${archive.revision}.${format}`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus({
        busy: false,
        text: `Complete: ${archive.entries.length} public records exported at revision ${archive.revision}.`,
        error: false,
      });
    } catch (caught) {
      setStatus({
        busy: false,
        text: controller.signal.aborted
          ? 'Export canceled. No file was created.'
          : caught instanceof Error
            ? caught.message
            : 'Export could not be completed. No file was created.',
        error: !controller.signal.aborted,
      });
    } finally {
      active.current = null;
    }
  };
  return (
    <section className="archive-export panel" aria-label="Export public archive">
      <h3>Take the public archive with you</h3>
      <p className="helper">
        Export all records matching the applied filters. CSV has one row per allocation; JSON keeps
        each entry together. Dates, signed quantities and correction links are included.
      </p>
      <p className="helper">
        If records or privacy settings change during export, it stops so you can start again.
        Records load in batches of 50; you can cancel at any time. Downloaded copies cannot be
        recalled.
      </p>
      <div className="button-row">
        <button
          className="button button--outline"
          disabled={status.busy}
          onClick={() => void start('csv')}
        >
          Export public CSV
        </button>
        <button
          className="button button--outline"
          disabled={status.busy}
          onClick={() => void start('json')}
        >
          Export public JSON
        </button>
        {status.busy ? (
          <button className="button button--quiet" onClick={() => active.current?.abort()}>
            Cancel export
          </button>
        ) : null}
      </div>
      {status.text ? (
        <p
          className={status.error ? 'form-error' : 'helper'}
          role={status.error ? 'alert' : 'status'}
          aria-live="polite"
        >
          {status.text}
        </p>
      ) : null}
    </section>
  );
}
