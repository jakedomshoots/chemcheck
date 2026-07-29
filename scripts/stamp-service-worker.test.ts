import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { stampServiceWorker } from './stamp-service-worker.js';

const tempDirectories: string[] = [];

async function makeDistFixture() {
  const distDir = await mkdtemp(path.join(tmpdir(), 'chemcheck-pwa-'));
  tempDirectories.push(distDir);
  await writeFile(path.join(distDir, 'index.html'), '<main>current ChemCheck build</main>');
  await writeFile(
    path.join(distDir, 'sw.js'),
    "const BUILD_ID = '__CHEMCHECK_BUILD_ID__';\nconst CACHE = `chemcheck-${BUILD_ID}`;\n",
  );
  return distDir;
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('service worker build stamping', () => {
  it('derives a deterministic cache identity from the built app shell', async () => {
    const distDir = await makeDistFixture();
    const expectedBuildId = createHash('sha256')
      .update('<main>current ChemCheck build</main>')
      .digest('hex')
      .slice(0, 16);

    const result = await stampServiceWorker({ distDir, environment: {} });
    const stampedWorker = await readFile(path.join(distDir, 'sw.js'), 'utf8');
    const buildMetadata = JSON.parse(await readFile(path.join(distDir, 'build.json'), 'utf8'));

    expect(result.buildId).toBe(expectedBuildId);
    expect(stampedWorker).toContain(`const BUILD_ID = '${expectedBuildId}'`);
    expect(stampedWorker).not.toContain('__CHEMCHECK_BUILD_ID__');
    expect(buildMetadata).toMatchObject({ buildId: expectedBuildId, commitSha: null });
  });

  it('prefers the deployment commit SHA when the provider supplies one', async () => {
    const distDir = await makeDistFixture();
    const commitSha = '75d061adb219a58dd0d9e401286d43386f2a61b2';

    const result = await stampServiceWorker({
      distDir,
      environment: { VERCEL_GIT_COMMIT_SHA: commitSha },
    });

    expect(result.buildId).toBe(commitSha.slice(0, 16));
    expect(result.commitSha).toBe(commitSha);
  });
});
