import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ConflictResolver, valuesEqual } from './ConflictResolver';

describe('ConflictResolver.mergeWithBase (clock-free field merge)', () => {
  const resolver = new ConflictResolver();

  it('keeps local-only edits, takes remote-only edits and re-bases pending fields', () => {
    const local = { full_name: 'Jane', phone: '555-0199', gate_code: '1234' };
    const remote = { full_name: 'Jane Smith', phone: '555-0100', gate_code: '1234' };
    const result = resolver.mergeWithBase(local, remote, { phone: '555-0100' });

    expect(result.merged).toMatchObject({ full_name: 'Jane Smith', phone: '555-0199', gate_code: '1234' });
    expect(result.dirtyBase).toEqual({ phone: '555-0100' });
    expect(result.conflictedFields).toEqual([]);
  });

  it('keeps the server value for fields changed on both sides', () => {
    const result = resolver.mergeWithBase({ phone: 'local' }, { phone: 'remote' }, { phone: 'base' });
    expect(result.merged.phone).toBe('remote');
    expect(result.conflictedFields).toEqual(['phone']);
    expect(result.dirtyBase).toBeUndefined();
  });

  it('treats converged values and missing/null bases as equal', () => {
    expect(resolver.mergeWithBase({ phone: 'same' }, { phone: 'same' }, { phone: 'old' }).dirtyBase).toBeUndefined();
    const cleared = resolver.mergeWithBase({ email: 'new@example.com' }, {}, { email: null });
    expect(cleared.merged.email).toBe('new@example.com');
    expect(cleared.dirtyBase).toEqual({ email: null });
    expect(valuesEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(valuesEqual(undefined, null)).toBe(true);
  });

  it('never depends on timestamps: result is identical whatever the clocks say', () => {
    fc.assert(fc.property(fc.integer(), fc.integer(), (localClock, remoteClock) => {
      const local = { title: 'local', local_updated_at: localClock };
      const remote = { title: 'remote', remote_updated_at: remoteClock };
      const result = resolver.mergeWithBase(local, remote, { title: 'base' });
      return result.merged.title === 'remote' && result.conflictedFields.length === 1;
    }));
  });
});
