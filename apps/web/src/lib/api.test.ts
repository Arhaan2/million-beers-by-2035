import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});
describe('request purpose and cancellation', () => {
  it.each([
    ['read', 'Loading took too long.'],
    ['login', 'Sign-in took too long.'],
    ['ledger', 'Submission status unknown:'],
    ['memory', 'memory save could not be confirmed'],
    ['member', 'Member creation could not be confirmed'],
  ])('uses appropriate timeout feedback for %s', async (purpose, message) => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ),
    );
    const api = await import('./api');
    const request =
      purpose === 'read'
        ? api.fetchEntries()
        : purpose === 'login'
          ? api.login('code')
          : purpose === 'memory'
            ? api.updateMemory('id', {}, 0, 'token')
            : purpose === 'member'
              ? api.createMember('Name', 'token')
              : api.submitEntry(
                  {
                    totalAmount: 1,
                    allocations: [{ contributor: 'Name', amount: 1 }],
                    note: '',
                    idempotencyKey: 'key',
                  },
                  'token',
                );
    const assertion = expect(request).rejects.toThrow(message);
    await vi.advanceTimersByTimeAsync(12_000);
    await assertion;
  });
  it('preserves explicit cancellation as cancellation rather than an uncertain submission', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ),
    );
    const api = await import('./api');
    const controller = new AbortController();
    const request = api.fetchEntries('', controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});
