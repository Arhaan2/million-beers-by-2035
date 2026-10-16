import { describe, expect, it } from 'vitest';
import { wrapCardText } from './shareCard';
const width = (text: string) =>
  Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length;
describe('bounded card text', () => {
  it('wraps an unbroken maximum title and clearly marks truncation', () => {
    const lines = wrapCardText('W'.repeat(80), 18, 2, width);
    expect(lines).toEqual(['W'.repeat(18), `${'W'.repeat(17)}…`]);
    expect(lines.every((line) => width(line) <= 18)).toBe(true);
  });
  it('keeps emoji sequences and combining Unicode intact', () => {
    const text = '👨‍👩‍👧‍👦 café é 東京 '.repeat(25);
    const lines = wrapCardText(text, 15, 3, width);
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => width(line) <= 15)).toBe(true);
    expect(lines.join(' ')).toContain('👨‍👩‍👧‍👦');
    expect(lines.at(-1)).toMatch(/…$/u);
  });
  it('does not invent ellipsis for content that fits or empty text', () => {
    expect(wrapCardText('One crew', 20, 2, width)).toEqual(['One crew']);
    expect(wrapCardText('', 20, 2, width)).toEqual([]);
  });
});
