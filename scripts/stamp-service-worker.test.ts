import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { stampServiceWorker } from './stamp-service-worker.js';

const tempDirectories: string[] = [];

async function makeDistFixture({ withHealth = true } = {}) {
  const distDir = await mkdtemp(path.join(tmpdir(), 'chemcheck-pwa-'));
  tempDirectories.push(distDir);
  await writeFile(path.join(distDir, 'index.html'), '<main>current ChemCheck build</main>');
  await writeFile(
    path.join(distDir, 'sw.js'),
    "const BUILD_ID = '__CHEMCHECK_BUILD_ID__';\nconst CACHE = `chemcheck-${BUILD_ID}`;\n",
  );
  if (withHealth) {
    await writeFile(
      path.join(distDir, 'health.json'),
      JSON.stringify({
        status: 'static',
        note: 'use /api or Convex health action for live status',
        version: '__CHEMCHECK_APP_VERSION__',
        buildId: '__CHEMCHECK_BUILD_ID__',
      }),
    );
  }
  return distDir;
}

async function makePackageJson(version: string) {
  const dir = await mkdtemp(path.join(tmpdir(), 'chemcheck-pkg-'));
  tempDirectories.push(dir);
  const packageJsonPath = path.join(dir, 'package.json');
  await writeFile(packageJsonPath, JSON.stringify({ name: 'fixture', version }));
  return packageJsonPath;
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

  it('stamps the static health marker with the package version and build id', async () => {
    const distDir = await makeDistFixture();
    const packageJsonPath = await makePackageJson('9.8.7');

    const result = await stampServiceWorker({ distDir, environment: {}, packageJsonPath });
    const health = JSON.parse(await readFile(path.join(distDir, 'health.json'), 'utf8'));

    expect(result.appVersion).toBe('9.8.7');
    expect(health).toEqual({
      status: 'static',
      note: 'use /api or Convex health action for live status',
      version: '9.8.7',
      buildId: result.buildId,
    });
    expect(health.status).not.toBe('healthy');
  });

  it('reads the real package.json version by default and tolerates a missing health marker', async () => {
    const distDir = await makeDistFixture({ withHealth: false });
    const { version } = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));

    const result = await stampServiceWorker({ distDir, environment: {} });
    const buildMetadata = JSON.parse(await readFile(path.join(distDir, 'build.json'), 'utf8'));

    expect(result.appVersion).toBe(version);
    expect(buildMetadata.appVersion).toBe(version);
    await expect(readFile(path.join(distDir, 'health.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses to ship a health marker that claims live status', async () => {
    const distDir = await makeDistFixture({ withHealth: false });
    await writeFile(path.join(distDir, 'health.json'), JSON.stringify({ status: 'healthy', version: '__CHEMCHECK_APP_VERSION__' }));

    await expect(stampServiceWorker({ distDir, environment: {} })).rejects.toThrow(/static marker/);
  });
});
