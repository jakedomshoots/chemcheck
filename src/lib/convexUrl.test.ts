import { describe, expect, it } from 'vitest';
import { normalizeConvexUrl } from './convexUrl';

describe('normalizeConvexUrl', () => {
  it('returns undefined for empty input', () => {
    expect(normalizeConvexUrl(undefined)).toBeUndefined();
    expect(normalizeConvexUrl('')).toBeUndefined();
    expect(normalizeConvexUrl('   ')).toBeUndefined();
  });

  it('removes trailing slashes to avoid websocket double-slash URLs', () => {
    expect(normalizeConvexUrl('https://loyal-wildebeest-375.convex.cloud/'))
      .toBe('https://loyal-wildebeest-375.convex.cloud');
    expect(normalizeConvexUrl('https://loyal-wildebeest-375.convex.cloud///'))
      .toBe('https://loyal-wildebeest-375.convex.cloud');
  });

  it('preserves valid URL when already normalized', () => {
    expect(normalizeConvexUrl('https://loyal-wildebeest-375.convex.cloud'))
      .toBe('https://loyal-wildebeest-375.convex.cloud');
  });
});
