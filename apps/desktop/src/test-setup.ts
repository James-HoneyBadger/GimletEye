// jsdom has no matchMedia, and the store reads it while the module evaluates.
// Registering the stub here means a test can import the store directly.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
  configurable: true,
    value: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
}
