import '@testing-library/jest-dom';

// jsdom does not implement `window.matchMedia` by default, which
// `useMediaQuery`/`useIsMobile` call. Provide a configurable mock so
// responsive-behaviour tests can drive the match state.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Silence the scrollTo / resizeTo APIs some components touch in tests.
Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: jest.fn(),
});
