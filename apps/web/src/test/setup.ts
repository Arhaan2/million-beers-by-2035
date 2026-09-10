import '@testing-library/jest-dom/vitest';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

// JSDOM has no Web Locks implementation; model the supported browser API here.
Object.defineProperty(navigator, 'locks', {
  configurable: true,
  value: {
    request: (_name: string, _options: unknown, callback: (lock: object) => Promise<unknown>) =>
      callback({ name: 'million-beers-entry-submit', mode: 'exclusive' }),
  },
});
