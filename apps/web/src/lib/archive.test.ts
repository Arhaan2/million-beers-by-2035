import { describe, expect, it, vi } from 'vitest';
import { archiveCsv, collectPublicArchive, publicArchiveEntry } from './archive';
import type { BeerEntry, EntryPage } from './types';
const entry: BeerEntry = {
  id: 'a',
  totalAmount: -2,
  note: 'A "quoted", note\nline two',
  createdAt: 0,
  localDay: '1969-12-31',
  isCorrection: true,
  isGroup: false,
  correctionOfEntryId: 'original',
  correctionKind: 'linked',
  allocations: [{ id: 'allocation-a', contributor: '  =1+1', amount: -2, memberId: null }],
  memory: { title: '夜 🍻', city: '@formula', visibility: 'public' },
};

describe('public archive snapshot', () => {
  it('collects several pages at one revision, removes paging inputs and validates immediately before completion', async () => {
    const load = vi
      .fn<(query: string, signal?: AbortSignal) => Promise<EntryPage>>()
      .mockResolvedValueOnce({ revision: 7, entries: [entry], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ revision: 7, entries: [{ ...entry, id: 'b' }], nextCursor: null })
      .mockResolvedValueOnce({ revision: 7, entries: [entry], nextCursor: 'cursor-2' });
    const progress = vi.fn();
    const archive = await collectPublicArchive(
      'city=Portland&cursor=old&revision=2&token=secret&operator=private',
      new AbortController().signal,
      progress,
      load,
    );
    expect(archive.entries.map((row) => row.id)).toEqual(['a', 'b']);
    expect(archive.filters).toEqual({ city: 'Portland' });
    expect(new URLSearchParams(load.mock.calls[1]![0]).get('revision')).toBe('7');
    const finalQuery = new URLSearchParams(load.mock.calls[2]![0]);
    expect(finalQuery.get('limit')).toBe('1');
    expect(finalQuery.has('cursor')).toBe(false);
    expect(progress).toHaveBeenLastCalledWith(2, 2);
  });
  it.each(['changed', 'duplicate', 'missing revision', 'final change'] as const)(
    'rejects %s rather than producing a complete file',
    async (failure) => {
      const load = vi
        .fn<(query: string, signal?: AbortSignal) => Promise<EntryPage>>()
        .mockResolvedValueOnce({ revision: 7, entries: [entry], nextCursor: 'next' })
        .mockResolvedValueOnce({
          ...(failure !== 'missing revision' ? { revision: failure === 'changed' ? 8 : 7 } : {}),
          entries: [{ ...entry, id: failure === 'duplicate' ? 'a' : 'b' }],
          nextCursor: null,
        })
        .mockResolvedValueOnce({ revision: 8, entries: [], nextCursor: null });
      await expect(
        collectPublicArchive('', new AbortController().signal, () => undefined, load),
      ).rejects.toThrow(/archive changed|revision/u);
    },
  );
  it('stops cancellation without requesting more pages or returning data', async () => {
    const controller = new AbortController();
    const load = vi.fn().mockResolvedValue({ revision: 1, entries: [entry], nextCursor: 'next' });
    await expect(
      collectPublicArchive('', controller.signal, () => controller.abort(), load),
    ).rejects.toThrow();
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('continues beyond fifty bounded pages until the selected archive is complete', async () => {
    let index = 0;
    const load = vi.fn((query: string) =>
      Promise.resolve({
        revision: 7,
        entries: [{ ...entry, id: String(index++) }],
        nextCursor:
          new URLSearchParams(query).get('limit') === '1' || index === 51 ? null : String(index),
      }),
    );
    const archive = await collectPublicArchive(
      '',
      new AbortController().signal,
      () => undefined,
      load,
    );
    expect(archive.entries).toHaveLength(51);
    expect(load).toHaveBeenCalledTimes(52);
    expect(
      load.mock.calls
        .slice(0, -1)
        .every(([query]) => new URLSearchParams(query).get('limit') === '50'),
    ).toBe(true);
  });
  it('allowlists fields and escapes Unicode, quotes, newlines and text formulas while retaining signed numeric amounts', async () => {
    const source = {
      ...entry,
      token: 'never-export',
      memory: { ...entry.memory, privateOperatorNote: 'never-export' },
    };
    expect(JSON.stringify(publicArchiveEntry(source))).not.toContain('never-export');
    expect(
      publicArchiveEntry({ ...entry, memory: { title: 'private', visibility: 'private' } }).memory,
    ).toBeNull();
    const load = vi.fn().mockResolvedValue({ revision: 7, entries: [entry], nextCursor: null });
    const csv = archiveCsv(
      await collectPublicArchive('', new AbortController().signal, () => undefined, load),
    );
    expect(csv).toContain('"\'  =1+1"');
    expect(csv).toContain('"\'@formula"');
    expect(csv).toContain('夜 🍻');
    expect(csv).toContain('"A ""quoted"", note\nline two"');
    expect(csv).toContain(',-2,-2,');
    expect(csv).toContain('"original","linked"');
  });
  it('preserves allocation correction linkage and redacts date/note details defensively', () => {
    const linked = publicArchiveEntry({
      ...entry,
      allocations: [{ ...entry.allocations[0]!, sourceAllocationId: 'source-a' }],
      occurrenceSource: 'provided',
      occurredAt: '2026-10-01T12:00:00Z',
    });
    expect(linked.allocations[0]?.sourceAllocationId).toBe('source-a');
    expect(linked.occurrenceSource).toBe('provided');
    for (const privateEntry of [
      { ...linked, memory: { visibility: 'private' as const } },
      { ...linked, allocations: [{ ...linked.allocations[0]!, contributor: 'Private member' }] },
    ]) {
      const safe = publicArchiveEntry(privateEntry);
      expect(safe.note).toBeNull();
      expect(safe.occurredAt).toBeNull();
      expect(safe.memory).toBeNull();
      expect(safe.occurrenceSource).toBe('unknown');
    }
  });
});
