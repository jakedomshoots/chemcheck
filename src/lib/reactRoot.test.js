import { describe, expect, it, vi } from 'vitest';
import { getOrCreateReactRoot } from './reactRoot';

describe('getOrCreateReactRoot', () => {
  it('reuses the same root for a container across repeated initialization', () => {
    const container = document.createElement('div');
    const root = { render: vi.fn() };
    const createRootFactory = vi.fn(() => root);

    expect(getOrCreateReactRoot(container, createRootFactory)).toBe(root);
    expect(getOrCreateReactRoot(container, createRootFactory)).toBe(root);
    expect(createRootFactory).toHaveBeenCalledTimes(1);
    expect(createRootFactory).toHaveBeenCalledWith(container);
  });

  it('fails clearly when the application container is missing', () => {
    expect(() => getOrCreateReactRoot(null, vi.fn())).toThrow(
      'ChemCheck root container was not found'
    );
  });
});
