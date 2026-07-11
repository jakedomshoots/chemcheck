import { describe, expect, it } from 'vitest';
import { isAccountChange } from './sessionIdentity';

describe('isAccountChange', () => {
  it('detects a signed-in account that differs from locally restored data', () => {
    expect(isAccountChange({ email: 'first@example.com' }, 'second@example.com')).toBe(true);
  });

  it('does not clear data when the same account refreshes', () => {
    expect(isAccountChange({ email: 'first@example.com' }, 'first@example.com')).toBe(false);
  });
});
