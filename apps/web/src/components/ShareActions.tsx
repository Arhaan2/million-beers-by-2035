import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  cardFormats,
  renderShareCard,
  shareCardBlob,
  type CardFormat,
  type ShareCardData,
} from '../lib/shareCard';
export type { ShareCardData } from '../lib/shareCard';

export function ShareActions({ data }: { data: ShareCardData }) {
  const [includeNames, setIncludeNames] = useState(false);
  const [format, setFormat] = useState<CardFormat>('landscape');
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState('');
  const [fallback, setFallback] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [sharing, setSharing] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prepared = useRef<{ key: string; file: File } | null>(null);
  const previewId = useId();
  const key = JSON.stringify([data, format, includeNames]);
  const currentKey = useRef(key);
  useLayoutEffect(() => {
    currentKey.current = key;
    prepared.current = null;
  }, [key]);

  useEffect(() => {
    if (fallback) linkRef.current?.focus();
  }, [fallback]);
  useEffect(() => {
    if (!preview || !canvasRef.current) return;
    let active = true;
    try {
      renderShareCard(canvasRef.current, data, format, includeNames);
      void shareCardBlob(canvasRef.current)
        .then((blob) => {
          if (active)
            prepared.current = {
              key,
              file: new File([blob], `million-beers-${format}.png`, { type: 'image/png' }),
            };
        })
        .catch(() => {
          /* Download/share can retry without losing the preview. */
        });
    } catch (error) {
      // Canvas itself exposes a textual fallback in unsupported browsers.
      if (canvasRef.current)
        canvasRef.current.textContent =
          error instanceof Error ? error.message : 'Preview unavailable.';
    }
    return () => {
      active = false;
    };
  }, [data, format, includeNames, key, preview]);

  const showCopyFallback = (detail: string) => {
    setFallback(true);
    setMessage(detail);
    linkRef.current?.focus();
    linkRef.current?.select();
  };
  const makeFile = async () => {
    if (prepared.current?.key === key) return prepared.current.file;
    const canvas = document.createElement('canvas');
    renderShareCard(canvas, data, format, includeNames);
    const file = new File([await shareCardBlob(canvas)], `million-beers-${format}.png`, {
      type: 'image/png',
    });
    if (currentKey.current !== key)
      throw new Error(
        'The saved data or image format changed. Preview the current card and try again.',
      );
    prepared.current = { key, file };
    return file;
  };
  const download = async () => {
    setExporting(true);
    setMessage('Preparing image…');
    try {
      const file = await makeFile();
      if (currentKey.current !== key)
        throw new Error('The saved data changed. Preview the current card and try again.');
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Image downloaded.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Image export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };
  const copyLink = async () => {
    setCopying(true);
    setMessage('Copying link…');
    try {
      await navigator.clipboard.writeText(data.url);
      setFallback(false);
      setMessage('Link copied.');
    } catch {
      showCopyFallback('Copy the selected link below.');
    } finally {
      setCopying(false);
    }
  };
  const share = async () => {
    setSharing(true);
    setMessage('Opening share sheet…');
    try {
      if (typeof navigator.canShare === 'function') {
        // Prepare before opening the native sheet so the next gesture retains
        // transient user activation on browsers that require it for file sharing.
        if (prepared.current?.key !== key) {
          await makeFile();
          setPreview(true);
          setMessage('Image ready. Choose Share… again to open the share sheet.');
          return;
        }
        const files = [prepared.current.file];
        if (navigator.canShare({ files })) await navigator.share({ files, title: data.title });
        else await navigator.share({ title: data.title, url: data.url });
      } else await navigator.share({ title: data.title, url: data.url });
      setMessage('Shared.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError')
        setMessage('Sharing canceled.');
      else
        showCopyFallback(
          'Sharing unavailable. Download the image or copy the selected link below.',
        );
    } finally {
      setSharing(false);
    }
  };
  return (
    <section className="share-actions" aria-label="Share this saved record">
      <p className="helper">
        Share a public link or image from this saved record. Names are optional. Social links use
        the project’s generic preview. Downloaded or shared images cannot be recalled.
      </p>
      <div className="card-options">
        <label>
          Image format
          <select
            aria-label="Image format"
            value={format}
            onChange={(event) => setFormat(event.target.value as CardFormat)}
          >
            {Object.entries(cardFormats).map(([value, option]) => (
              <option key={value} value={value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {data.names?.length ? (
          <label className="check-label">
            <input
              type="checkbox"
              checked={includeNames}
              onChange={(event) => setIncludeNames(event.target.checked)}
            />
            Include public display names on the image
          </label>
        ) : null}
      </div>
      <div className="button-row">
        <button
          type="button"
          className="button button--quiet"
          aria-expanded={preview}
          aria-controls={previewId}
          onClick={() => setPreview(!preview)}
        >
          {preview ? 'Hide preview' : 'Preview image card'}
        </button>
        <button
          type="button"
          className="button button--outline"
          disabled={exporting}
          aria-busy={exporting}
          onClick={() => void download()}
        >
          {exporting ? 'Preparing image…' : 'Download image card'}
        </button>
        <button
          type="button"
          className="button button--quiet"
          disabled={copying}
          aria-busy={copying}
          onClick={() => void copyLink()}
        >
          {copying ? 'Copying…' : 'Copy link'}
        </button>
        {typeof navigator.share === 'function' ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={sharing}
            aria-busy={sharing}
            onClick={() => void share()}
          >
            {sharing ? 'Sharing…' : 'Share…'}
          </button>
        ) : null}
      </div>
      {preview ? (
        <figure id={previewId} className={`card-preview card-preview--${format}`}>
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`${cardFormats[format].label} card: ${data.title}. ${data.subtitle}. ${data.lines.join('. ')}${includeNames ? `. ${data.names?.join(', ')}` : ''}`}
          />
          <figcaption>
            Preview uses the same image as the download. Long text may be shortened with an
            ellipsis.
          </figcaption>
        </figure>
      ) : null}
      {fallback ? (
        <label>
          Public link
          <input
            className="public-link"
            ref={linkRef}
            value={data.url}
            readOnly
            onFocus={(event) => event.target.select()}
          />
        </label>
      ) : null}
      <p role="status" aria-atomic="true" className="helper share-actions__status">
        {message}
      </p>
    </section>
  );
}
