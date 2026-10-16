import { useEffect, useRef, useState } from 'react';
import { ApiRequestError, fetchEntry, updateMemory } from '../lib/api';
import type { BeerEntry, MemoryMetadata } from '../lib/types';

const fields = ['title', 'shortNote', 'venue', 'city', 'beer', 'brewery'] as const;
function sameMemory(left: MemoryMetadata, right: MemoryMetadata | null | undefined) {
  return fields.every((field) => (left[field] ?? '').trim() === (right?.[field] ?? '').trim());
}
export function MemoryEditor({
  entry,
  token,
  onSaved,
  onLogin,
  initiallyOpen = false,
  available = true,
  resourceRevision = 0,
}: {
  entry: BeerEntry;
  token?: string | undefined;
  onSaved: (entry: BeerEntry) => void;
  onLogin: () => void;
  initiallyOpen?: boolean;
  available?: boolean;
  resourceRevision?: number;
}) {
  const projection = JSON.stringify([
    available,
    resourceRevision,
    entry.metadataVersion ?? 0,
    entry.memory ?? null,
  ]);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    return () => {
      generation.current = current + 1;
    };
  }, [projection]);
  const [sourceProjection, setSourceProjection] = useState(projection);
  const [dirty, setDirty] = useState<Set<(typeof fields)[number]>>(() => new Set());
  const [memory, setMemory] = useState<MemoryMetadata>(entry.memory ?? {});
  const [version, setVersion] = useState(entry.metadataVersion ?? 0);
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState<BeerEntry | null>(null);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [expired, setExpired] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  // Reconcile public projections during render so redacted saved text is never painted again.
  // Only fields the user actually changed survive; untouched saved text is not a draft.
  if (projection !== sourceProjection) {
    setSourceProjection(projection);
    setMemory(
      Object.fromEntries(
        fields.map((field) => [
          field,
          dirty.has(field) ? (memory[field] ?? '') : (entry.memory?.[field] ?? ''),
        ]),
      ),
    );
    if (!dirty.size) setVersion(entry.metadataVersion ?? 0);
    if (latest) {
      setLatest(null);
      setNeedsCheck(true);
    }
    if (dirty.size)
      setMessage({
        text: entry.memory
          ? 'Saved public details changed. Your typed changes are preserved; untouched fields use the latest public details.'
          : 'Saved public details are no longer available. Previously saved text was removed; your unsaved changes are preserved.',
        error: false,
      });
  }
  const confirmed = (saved: BeerEntry, recovered = false) => {
    setVersion(saved.metadataVersion ?? 0);
    setMemory(saved.memory ?? {});
    setDirty(new Set());
    setLatest(null);
    setNeedsCheck(false);
    onSaved(saved);
    setMessage({
      text: recovered
        ? 'The latest saved details match your draft. Save confirmed.'
        : 'Memory saved. Quantities and recording time are unchanged.',
      error: false,
    });
  };
  const reconcile = async (conflict = false) => {
    const attempt = generation.current;
    try {
      const saved = (await fetchEntry(entry.id)).entry;
      if (generation.current !== attempt) return;
      setNeedsCheck(false);
      if (!conflict && sameMemory(memory, saved.memory)) {
        confirmed(saved, true);
        return;
      }
      setLatest(saved);
      setMessage({
        text: conflict
          ? 'Someone saved different details. Your draft is preserved. Review the latest version before choosing what to save.'
          : 'Your save was not confirmed. Your draft is preserved. Review the latest saved details before trying again.',
        error: true,
      });
    } catch {
      if (generation.current !== attempt) return;
      setNeedsCheck(true);
      setMessage({
        text: 'The latest saved details could not be checked. Your draft is preserved. Check again before saving.',
        error: true,
      });
    }
  };
  const save = async () => {
    if (busy || needsCheck || latest || !available) return;
    if (!token || token === expired) {
      onLogin();
      return;
    }
    const attempt = generation.current;
    setBusy(true);
    setMessage(null);
    try {
      const saved = (
        await updateMemory(entry.id, { ...memory, visibility: 'public' }, version, token)
      ).entry;
      if (generation.current !== attempt) {
        setNeedsCheck(true);
        return;
      }
      confirmed(saved);
    } catch (caught) {
      if (generation.current !== attempt) {
        setNeedsCheck(true);
        return;
      }
      if (caught instanceof ApiRequestError && caught.status === 401) {
        setExpired(token);
        setMessage({
          text: 'Your session expired. Your draft is kept here. Sign in, then choose Save memory details.',
          error: true,
        });
        onLogin();
      } else if (caught instanceof ApiRequestError && (caught.status === 409 || caught.retryable)) {
        await reconcile(caught.status === 409);
      } else {
        setMessage({
          text: caught instanceof Error ? caught.message : 'Memory could not be saved.',
          error: true,
        });
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <details
      className="memory-editor"
      open={initiallyOpen || undefined}
      hidden={!available && !dirty.size}
    >
      <summary>Edit public memory details</summary>
      <p className="helper">
        The crew code authorizes edits to public details. Quantities stay unchanged. Private details
        and visibility changes require the project operator.
      </p>
      <form
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="metadata-grid">
          {fields.map((field) => (
            <label key={field}>
              {field === 'shortNote'
                ? 'Short note'
                : field.charAt(0).toUpperCase() + field.slice(1)}
              <input
                name={field}
                maxLength={field === 'shortNote' ? 140 : 80}
                value={memory[field] ?? ''}
                readOnly={busy}
                onChange={(event) => {
                  setMemory({ ...memory, [field]: event.target.value });
                  setDirty(new Set([...dirty, field]));
                  if (!latest && !needsCheck) setMessage(null);
                }}
              />
            </label>
          ))}
        </div>
        {latest ? (
          <section className="notice" aria-label="Latest saved memory">
            <h3>Latest saved details</h3>
            <dl>
              {fields.map((field) => (
                <div key={field}>
                  <dt>{field === 'shortNote' ? 'Short note' : field}</dt>
                  <dd>{latest.memory?.[field] || 'Not supplied'}</dd>
                </div>
              ))}
            </dl>
            <p>
              Your typed draft remains in the fields above. Choosing it prepares a new save against
              this version; a further change will be checked again.
            </p>
            <div className="button-row">
              <button
                type="button"
                className="button button--outline"
                onClick={() => {
                  setVersion(latest.metadataVersion ?? 0);
                  setLatest(null);
                  setMessage({
                    text: 'Your draft is ready. Review it, then choose Save memory details.',
                    error: false,
                  });
                }}
              >
                Keep my draft for review
              </button>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => {
                  setMemory(latest.memory ?? {});
                  setDirty(new Set());
                  onSaved(latest);
                  setVersion(latest.metadataVersion ?? 0);
                  setLatest(null);
                  setMessage({ text: 'Latest saved details loaded.', error: false });
                }}
              >
                Use latest saved details
              </button>
            </div>
          </section>
        ) : null}
        {!available ? (
          <p className="notice">
            Refresh the entry to check its latest public details before saving. Your unsaved changes
            remain here.
          </p>
        ) : null}
        {needsCheck ? (
          <button
            className="button button--outline"
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void reconcile().finally(() => setBusy(false));
            }}
          >
            Check latest saved details
          </button>
        ) : (
          <button
            className="button button--outline"
            disabled={busy || Boolean(latest) || !available}
          >
            {busy
              ? 'Saving…'
              : !token || token === expired
                ? 'Sign in to save memory'
                : 'Save memory details'}
          </button>
        )}
      </form>
      <p
        className={message?.error ? 'form-error' : 'helper'}
        role={message?.error ? 'alert' : 'status'}
        aria-atomic="true"
      >
        {busy ? 'Checking and saving memory details…' : message?.text}
      </p>
    </details>
  );
}
