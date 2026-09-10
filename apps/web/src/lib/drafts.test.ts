import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormDraft } from './drafts';
import type { EntryPayload } from './types';

const form: FormDraft = {
  mode: 'single',
  amount: 1,
  groupTotal: 2,
  participants: [],
  contributor: 'Synthetic',
  note: '',
  correction: false,
  memory: {},
  date: '',
  time: '',
  timezone: 'America/Los_Angeles',
};
const payload: EntryPayload = {
  totalAmount: 1,
  allocations: [{ contributor: 'Synthetic', amount: 1 }],
  note: '',
  idempotencyKey: '60000000-0000-4000-8000-000000000001',
  memory: { title: 'Synthetic gathering' },
};

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('durable entry drafts', () => {
  it('persists the exact uncertain payload and original key across a module reload', async () => {
    let drafts = await import('./drafts');
    const record = drafts.makeDraft(form, { payload, state: 'unknown' });
    expect(drafts.writeDraft(record)).toBe(true);
    vi.resetModules();
    drafts = await import('./drafts');
    expect(drafts.readDraft()?.attempt).toEqual({ payload, state: 'unknown' });
    expect(localStorage.getItem(drafts.DRAFT_KEY)).not.toMatch(/token|password|crew.?code/iu);
  });

  it('expires editable drafts while retaining an old unresolved attempt', async () => {
    const drafts = await import('./drafts');
    const record = { ...drafts.makeDraft(form), expiresAt: Date.now() - 1 };
    localStorage.setItem(drafts.DRAFT_KEY, JSON.stringify(record));
    expect(drafts.readDraft()).toBeNull();
    localStorage.setItem(
      drafts.DRAFT_KEY,
      JSON.stringify({ ...record, attempt: { payload, state: 'unknown' } }),
    );
    expect(drafts.readDraft()?.attempt?.payload).toEqual(payload);
  });

  it('never lets a newer editable draft mask an uncertain attempt stored for this tab', async () => {
    const drafts = await import('./drafts');
    sessionStorage.setItem(
      drafts.DRAFT_KEY,
      JSON.stringify({ ...drafts.makeDraft(form, { payload, state: 'auth' }), updatedAt: 1 }),
    );
    localStorage.setItem(
      drafts.DRAFT_KEY,
      JSON.stringify(drafts.makeDraft({ ...form, amount: 12 })),
    );
    expect(drafts.readDraft()?.attempt?.payload).toEqual(payload);
  });

  it('uses session storage when device storage is unavailable and preserves the retry key across reload', async () => {
    const originalSet = Reflect.get(Storage.prototype, 'setItem');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (this === localStorage) throw new DOMException('Quota full', 'QuotaExceededError');
      originalSet.call(this, key, value);
    });
    let drafts = await import('./drafts');
    expect(drafts.writeDraft(drafts.makeDraft(form, { payload, state: 'submitting' }))).toBe(true);
    expect(drafts.getDraftStatus()).toMatch(/only for this tab/u);
    vi.resetModules();
    drafts = await import('./drafts');
    expect(drafts.readDraft()?.attempt?.payload).toEqual(payload);
  });

  it('reports unavailable durable storage without crashing editable state', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError');
    });
    const drafts = await import('./drafts');
    expect(drafts.writeDraft(drafts.makeDraft(form))).toBe(false);
    expect(drafts.readDraft()?.form).toEqual(form);
    expect(drafts.getDraftStatus()).toMatch(/recording is paused/u);
  });

  it('ignores corrupted and incompatible saved drafts', async () => {
    const drafts = await import('./drafts');
    localStorage.setItem(drafts.DRAFT_KEY, '{malformed');
    expect(drafts.readDraft()).toBeNull();
    localStorage.setItem(drafts.DRAFT_KEY, JSON.stringify({ version: 99, form }));
    expect(drafts.readDraft()).toBeNull();
  });

  it.each([
    { form: { participants: [] } },
    { form: { ...form, note: null } },
    { form: { ...form, participants: [null] } },
    { form: { ...form, memory: { title: 42 } } },
    { expiresAt: null },
    { attempt: { payload, state: 'invented-state' } },
    { attempt: { payload: { ...payload, allocations: [null] }, state: 'unknown' } },
  ])(
    'ignores structurally damaged draft %# instead of crashing the recording form',
    async (damage) => {
      const drafts = await import('./drafts');
      localStorage.setItem(
        drafts.DRAFT_KEY,
        JSON.stringify({ ...drafts.makeDraft(form), ...damage }),
      );
      expect(drafts.readDraft()).toBeNull();
    },
  );

  it('ignores damaged saved participant groups', async () => {
    const drafts = await import('./drafts');
    localStorage.setItem(
      'million-beers:v1:participant-groups',
      JSON.stringify([
        null,
        { name: 'Damaged', people: [null, {}] },
        { name: 'Valid', people: [{ contributor: 'A' }, { contributor: 'B' }] },
      ]),
    );
    expect(drafts.readGroups()).toEqual([
      { name: 'Valid', people: [{ contributor: 'A' }, { contributor: 'B' }] },
    ]);
  });

  it('blocks a fresh dispatch without Web Locks while allowing the exact saved retry', async () => {
    vi.stubGlobal('navigator', {});
    const drafts = await import('./drafts');
    const submit = vi.fn(() => Promise.resolve('submitted'));
    await expect(drafts.withDraftLock(submit)).rejects.toThrow(
      /cannot coordinate new submissions/u,
    );
    expect(submit).not.toHaveBeenCalled();
    expect(await drafts.withDraftLock(submit, true)).toBe('submitted');
    expect(submit).toHaveBeenCalledOnce();
  });

  it('does not treat tab-only durability as a shared cross-tab pending key', async () => {
    const originalSet = Reflect.get(Storage.prototype, 'setItem');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (this === localStorage) throw new DOMException('Quota full', 'QuotaExceededError');
      originalSet.call(this, key, value);
    });
    const drafts = await import('./drafts');
    expect(drafts.writeDraft(drafts.makeDraft(form, { payload, state: 'unknown' }))).toBe(true);
    expect(drafts.isDraftShared(payload.idempotencyKey)).toBe(false);
    expect(drafts.readDraft()?.attempt?.payload).toEqual(payload);
  });

  it('clears both durable stores only when explicitly discarded or resolved', async () => {
    const drafts = await import('./drafts');
    const record = drafts.makeDraft(form, { payload, state: 'unknown' });
    localStorage.setItem(drafts.DRAFT_KEY, JSON.stringify(record));
    sessionStorage.setItem(drafts.DRAFT_KEY, JSON.stringify(record));
    expect(drafts.clearDraft()).toBe(false);
    expect(drafts.clearDraft(payload.idempotencyKey)).toBe(true);
    expect(drafts.readDraft()).toBeNull();
  });

  it('serializes competing autosave and discard behind a submission and preserves an unknown attempt after reload', async () => {
    let held = false;
    const request = async <T>(
      name: string,
      _options: unknown,
      callback: (lock: { name: string; mode: 'exclusive' } | null) => Promise<T>,
    ): Promise<T> => {
      if (held) return callback(null);
      held = true;
      try {
        return await callback({ name, mode: 'exclusive' });
      } finally {
        held = false;
      }
    };
    vi.stubGlobal('navigator', { locks: { request } });
    let drafts = await import('./drafts');
    let finish!: () => void;
    const pendingResponse = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const submitting = drafts.withDraftLock(async () => {
      expect(drafts.writeDraft(drafts.makeDraft(form, { payload, state: 'submitting' }))).toBe(
        true,
      );
      await pendingResponse;
      drafts.writeDraft(drafts.makeDraft(form, { payload, state: 'unknown' }));
    });
    expect(await drafts.persistEditableDraft({ ...form, amount: 99 })).toBe(false);
    expect(await drafts.discardEditableDraft()).toBe(false);
    expect(drafts.readDraft()?.attempt?.payload).toEqual(payload);
    finish();
    await submitting;
    // Even after the active lock releases, each new operation re-reads and
    // protects the original unresolved key instead of trusting a stale form.
    expect(await drafts.persistEditableDraft({ ...form, amount: 99 })).toBe(false);
    expect(await drafts.discardEditableDraft()).toBe(false);
    vi.resetModules();
    drafts = await import('./drafts');
    expect(drafts.readDraft()?.attempt).toEqual({ payload, state: 'unknown' });
  });

  it('does not let a cancelled autosave overwrite current editable data', async () => {
    vi.stubGlobal('navigator', {});
    const drafts = await import('./drafts');
    drafts.writeDraft(drafts.makeDraft(form));
    expect(await drafts.persistEditableDraft({ ...form, amount: 99 }, () => false)).toBe(false);
    expect(drafts.readDraft()?.form.amount).toBe(1);
  });

  it('does not delete a newly stored pending key when an expired read races a submission', async () => {
    const drafts = await import('./drafts');
    const expired = JSON.stringify({ ...drafts.makeDraft(form), expiresAt: Date.now() - 1 });
    const pending = JSON.stringify(drafts.makeDraft(form, { payload, state: 'submitting' }));
    localStorage.setItem(drafts.DRAFT_KEY, expired);
    const originalGet = Reflect.get(Storage.prototype, 'getItem');
    let interleaved = false;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      const result = originalGet.call(this, key);
      if (this === localStorage && key === drafts.DRAFT_KEY && !interleaved) {
        interleaved = true;
        localStorage.setItem(key, pending);
      }
      return result;
    });
    expect(drafts.readDraft()).toBeNull();
    expect(drafts.readDraft()?.attempt?.payload).toEqual(payload);
  });

  it('never clears a different unresolved key from either durable store', async () => {
    const drafts = await import('./drafts');
    const otherPayload = { ...payload, idempotencyKey: '60000000-0000-4000-8000-000000000002' };
    localStorage.setItem(
      drafts.DRAFT_KEY,
      JSON.stringify(drafts.makeDraft(form, { payload, state: 'unknown' })),
    );
    sessionStorage.setItem(
      drafts.DRAFT_KEY,
      JSON.stringify(drafts.makeDraft(form, { payload: otherPayload, state: 'unknown' })),
    );
    expect(drafts.clearDraft(payload.idempotencyKey)).toBe(false);
    expect(localStorage.getItem(drafts.DRAFT_KEY)).toContain(payload.idempotencyKey);
    expect(sessionStorage.getItem(drafts.DRAFT_KEY)).toContain(otherPayload.idempotencyKey);
  });

  it('does not execute a cross-tab retry when another tab owns the submission lock', async () => {
    const request = vi.fn(
      (_name: string, _options: unknown, callback: (lock: null) => Promise<unknown>) =>
        callback(null),
    );
    vi.stubGlobal('navigator', { locks: { request } });
    const drafts = await import('./drafts');
    const submit = vi.fn(() => Promise.resolve('submitted'));
    expect(await drafts.withDraftLock(submit)).toBeUndefined();
    expect(submit).not.toHaveBeenCalled();
  });
});
