import { renderHook, act } from '@testing-library/react';
import { useMediaQuery, useIsMobile } from './useMediaQuery';

function mockMatchMedia(matches: boolean) {
  (window.matchMedia as jest.Mock).mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}

describe('useMediaQuery / useIsMobile (responsive behavior)', () => {
  beforeEach(() => {
    // Default: no match (mobile=false).
    mockMatchMedia(false);
  });

  it('returns false before mount (SSR-safe default)', () => {
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('reports true when the media query matches (mobile breakpoint)', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('updates when the match state changes', () => {
    const mql = window.matchMedia as jest.Mock;
    let changeHandler: ((event: MediaQueryListEvent) => void) | undefined;
    mql.mockImplementation(() => ({
      matches: false,
      media: '(max-width: 639px)',
      addEventListener: jest.fn((_type: string, handler: (event: MediaQueryListEvent) => void) => {
        changeHandler = handler;
      }),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    } as any));

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      changeHandler?.({ matches: true } as MediaQueryListEvent);
    });
    expect(result.current).toBe(true);
  });

  it('accepts an arbitrary media query string', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 1024px)');
  });
});
