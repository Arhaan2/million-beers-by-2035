import { useEffect, useRef, useState } from 'react';
export interface ShareCardData {
  title: string;
  subtitle: string;
  lines: string[];
  names?: string[];
  url: string;
}
function drawLines(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  lineHeight: number,
  maxLines: number,
): number {
  const words = text.split(/\s+/u);
  let line = '';
  let count = 0;
  for (const word of words) {
    const next = `${line} ${word}`.trim();
    if (context.measureText(next).width > width && line) {
      context.fillText(line, x, y);
      y += lineHeight;
      count += 1;
      line = word;
      if (count >= maxLines) return y;
    } else line = next;
  }
  if (count < maxLines) context.fillText(line, x, y);
  return y + lineHeight;
}
async function exportCard(data: ShareCardData, includeNames: boolean): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image export is unavailable in this browser.');
  context.fillStyle = '#100e0a';
  context.fillRect(0, 0, 1200, 630);
  context.fillStyle = '#f2a91e';
  context.fillRect(56, 52, 64, 6);
  context.font = '700 20px sans-serif';
  context.fillText('THE MILLION BEER PROJECT', 56, 103);
  context.fillStyle = '#fff5df';
  context.font = '700 58px sans-serif';
  let y = drawLines(context, data.title, 56, 200, 1088, 68, 2);
  context.fillStyle = '#c4b7a0';
  context.font = '26px sans-serif';
  y = drawLines(context, data.subtitle, 56, y + 22, 1088, 34, 2);
  context.fillStyle = '#ffd476';
  context.font = '600 29px sans-serif';
  for (const line of data.lines.slice(0, 2)) {
    y = drawLines(context, line, 56, y + 26, 1088, 38, 1);
  }
  if (includeNames && data.names?.length) {
    context.fillStyle = '#c4b7a0';
    context.font = '22px sans-serif';
    drawLines(context, data.names.join(' · '), 56, 510, 1088, 29, 2);
  }
  context.strokeStyle = '#574321';
  context.beginPath();
  context.moveTo(56, 562);
  context.lineTo(1144, 562);
  context.stroke();
  context.fillStyle = '#c4b7a0';
  context.font = '18px sans-serif';
  context.fillText('One crew. A shared record of time together. By 2035.', 56, 601);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error('Image export failed.'))),
      'image/png',
    ),
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'million-beers-memory.png';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ShareActions({ data }: { data: ShareCardData }) {
  const [includeNames, setIncludeNames] = useState(false);
  const [message, setMessage] = useState('');
  const [fallback, setFallback] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [sharing, setSharing] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (fallback) linkRef.current?.focus();
  }, [fallback]);

  const showCopyFallback = (detail: string) => {
    setFallback(true);
    setMessage(detail);
    linkRef.current?.focus();
    linkRef.current?.select();
  };

  const download = async () => {
    setExporting(true);
    setMessage('Preparing image…');
    try {
      await exportCard(data, includeNames);
      setMessage('Image downloaded.');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Image export failed.');
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
      await navigator.share({ title: data.title, url: data.url });
      setMessage('Shared.');
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setMessage('Sharing canceled.');
      } else {
        showCopyFallback('Sharing unavailable. Copy the selected link below.');
      }
    } finally {
      setSharing(false);
    }
  };

  return (
    <section className="share-actions" aria-label="Share this saved record">
      <p className="helper">
        Share a public link or download a card from this saved record. Names are optional. Social
        links use the project’s generic preview.
      </p>
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
      <div className="button-row">
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
