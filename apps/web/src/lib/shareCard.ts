export interface ShareCardData {
  title: string;
  subtitle: string;
  lines: string[];
  names?: string[];
  url: string;
}
export const cardFormats = {
  landscape: { width: 1200, height: 630, label: 'Landscape · 1200 × 630' },
  square: { width: 1080, height: 1080, label: 'Square · 1080 × 1080' },
  story: { width: 1080, height: 1920, label: 'Story · 1080 × 1920' },
} as const;
export type CardFormat = keyof typeof cardFormats;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const characters = (value: string) => Array.from(segmenter.segment(value), (part) => part.segment);

// Bound every line by measured width, including emoji and words with no spaces.
// Ellipsis makes omitted text explicit instead of painting into another region.
export function wrapCardText(
  text: string,
  width: number,
  maxLines: number,
  measure: (text: string) => number,
): string[] {
  const units = characters(text.replace(/\s+/gu, ' ').trim());
  const lines: string[] = [];
  let offset = 0;
  while (offset < units.length && lines.length < maxLines) {
    let end = offset;
    while (end < units.length && measure(units.slice(offset, end + 1).join('')) <= width) end++;
    if (end === offset) break;
    if (lines.length === maxLines - 1 && end < units.length) {
      while (end > offset && measure(`${units.slice(offset, end).join('').trimEnd()}…`) > width)
        end--;
      lines.push(`${units.slice(offset, end).join('').trimEnd()}…`);
      break;
    }
    if (end < units.length) {
      const space = units.slice(offset, end).lastIndexOf(' ');
      if (space > 0) end = offset + space;
    }
    lines.push(units.slice(offset, end).join('').trim());
    offset = end;
    while (units[offset] === ' ') offset++;
  }
  return lines;
}

export function renderShareCard(
  canvas: HTMLCanvasElement,
  data: ShareCardData,
  format: CardFormat,
  includeNames: boolean,
): void {
  const { width, height } = cardFormats[format];
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context)
    throw new Error('Image export is unavailable in this browser. Copy the public link instead.');
  const landscape = format === 'landscape';
  const story = format === 'story';
  const margin = landscape ? 56 : 72;
  const contentWidth = width - margin * 2;
  const paper = '#f7f5ec';
  const ink = '#132e25';
  const secondary = '#465b4b';
  context.fillStyle = paper;
  context.fillRect(0, 0, width, height);
  context.fillStyle = ink;
  context.fillRect(0, 0, width, story ? 266 : 107);
  context.fillStyle = '#f2bd4d';
  context.fillRect(0, story ? 266 : 107, width, 5);
  context.textBaseline = 'top';

  const block = (
    text: string,
    top: number,
    fontSize: number,
    lineHeight: number,
    maxLines: number,
    color: string,
    weight = 400,
    family = 'system-ui, sans-serif',
  ) => {
    context.fillStyle = color;
    context.font = `${weight} ${fontSize}px ${family}`;
    const lines = wrapCardText(
      text,
      contentWidth,
      maxLines,
      (value) => context.measureText(value).width,
    );
    lines.forEach((line, index) => context.fillText(line, margin, top + index * lineHeight));
  };
  block('The Million Beer Project', story ? 172 : 37, 31, 40, 1, paper, 700);
  block(
    data.title,
    landscape ? 141 : story ? 340 : 180,
    landscape ? 52 : 68,
    landscape ? 62 : 82,
    landscape ? 2 : 3,
    ink,
    400,
    'Georgia, serif',
  );
  block(
    data.subtitle,
    landscape ? 278 : story ? 650 : 450,
    landscape ? 25 : 32,
    landscape ? 34 : 43,
    landscape ? 2 : 3,
    secondary,
  );
  data.lines.slice(0, 2).forEach((line, index) => {
    block(
      line,
      (landscape ? 368 : story ? 900 : 615) + index * (landscape ? 44 : 94),
      landscape ? 28 : 35,
      landscape ? 36 : 44,
      landscape ? 1 : 2,
      ink,
      600,
    );
  });
  if (includeNames && data.names?.length) {
    block(
      data.names.join(' · '),
      landscape ? 475 : story ? 1220 : 820,
      landscape ? 21 : 27,
      landscape ? 28 : 36,
      landscape ? 2 : story ? 6 : 3,
      secondary,
    );
  }
  const footer = story ? 1660 : height - 95;
  context.strokeStyle = '#9b9f89';
  context.beginPath();
  context.moveTo(margin, footer);
  context.lineTo(width - margin, footer);
  context.stroke();
  block('One crew. A shared record. By 2035.', footer + 22, landscape ? 20 : 24, 31, 1, secondary);
  if (story) block('Recorded moments, kept together.', footer + 65, 23, 30, 1, secondary);
}

export function shareCardBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Image export failed. Please try again.')),
      'image/png',
    ),
  );
}
