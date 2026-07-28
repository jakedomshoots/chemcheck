import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPreferredScrollBehavior,
  scrollElementIntoView,
} from './scrollMotion';

describe('scroll motion', () => {
  beforeEach(() => {
    vi.mocked(window.matchMedia).mockImplementation((query) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it('uses immediate scrolling when reduced motion is requested', () => {
    expect(getPreferredScrollBehavior()).toBe('auto');
  });

  it('uses smooth scrolling when motion is allowed', () => {
    vi.mocked(window.matchMedia).mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    expect(getPreferredScrollBehavior()).toBe('smooth');
  });

  it('applies the preferred behavior without overriding the requested alignment', () => {
    const element = { scrollIntoView: vi.fn() } as unknown as Element;

    scrollElementIntoView(element, { block: 'center', inline: 'nearest' });

    expect(element.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'center',
      inline: 'nearest',
    });
  });
});
