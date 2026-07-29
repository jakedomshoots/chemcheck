import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PWA release contract', () => {
  it('uses a build-stamped cache identity and network-first app navigation', async () => {
    const source = await readFile(path.resolve('public/sw.js'), 'utf8');

    expect(source).toContain('__CHEMCHECK_BUILD_ID__');
    expect(source).not.toContain("const CACHE_NAME = 'chemcheck-v1.0.0'");
    expect(source).toMatch(/request\.mode === ['"]navigate['"]/);
    expect(source).toContain('networkFirstNavigation(request)');
  });
});
