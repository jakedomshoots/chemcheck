import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BUILD_ID_PLACEHOLDER = '__CHEMCHECK_BUILD_ID__';
const APP_VERSION_PLACEHOLDER = '__CHEMCHECK_APP_VERSION__';
const HEALTH_MARKER_FILE = 'health.json';

function normalizeCommitSha(environment) {
  const candidate = environment.VERCEL_GIT_COMMIT_SHA || environment.GITHUB_SHA || '';
  return /^[a-f0-9]{7,64}$/i.test(candidate) ? candidate.toLowerCase() : null;
}

async function readOptionalFile(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readAppVersion(packageJsonPath) {
  const raw = await readOptionalFile(packageJsonPath);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return typeof parsed.version === 'string' && parsed.version.trim() ? parsed.version.trim() : null;
}

/**
 * dist/health.json is a static marker only. Live status comes from the Convex
 * `health.check` action; this just records which build the static host serves.
 */
function stampHealthMarker(template, { appVersion, buildId }) {
  const stamped = template
    .replaceAll(APP_VERSION_PLACEHOLDER, appVersion || 'unknown')
    .replaceAll(BUILD_ID_PLACEHOLDER, buildId);
  const parsed = JSON.parse(stamped);
  if (parsed.status !== 'static') {
    throw new Error(`health.json must be a static marker (status "static"), got "${parsed.status}"`);
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export async function stampServiceWorker({
  distDir = path.resolve('dist'),
  environment = process.env,
  packageJsonPath = path.resolve('package.json'),
} = {}) {
  const indexPath = path.join(distDir, 'index.html');
  const workerPath = path.join(distDir, 'sw.js');
  const metadataPath = path.join(distDir, 'build.json');
  const healthPath = path.join(distDir, HEALTH_MARKER_FILE);
  const [indexHtml, workerTemplate, healthTemplate, appVersion] = await Promise.all([
    readFile(indexPath, 'utf8'),
    readFile(workerPath, 'utf8'),
    readOptionalFile(healthPath),
    readAppVersion(packageJsonPath),
  ]);

  if (!workerTemplate.includes(BUILD_ID_PLACEHOLDER)) {
    throw new Error(`Service worker is missing ${BUILD_ID_PLACEHOLDER}`);
  }

  const commitSha = normalizeCommitSha(environment);
  const shellHash = createHash('sha256').update(indexHtml).digest('hex');
  const buildId = (commitSha || shellHash).slice(0, 16);
  const stampedWorker = workerTemplate.replaceAll(BUILD_ID_PLACEHOLDER, buildId);
  const metadata = {
    buildId,
    commitSha,
    appVersion,
    generatedAt: new Date().toISOString(),
  };

  const writes = [
    writeFile(workerPath, stampedWorker),
    writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`),
  ];
  if (healthTemplate !== null) {
    writes.push(writeFile(healthPath, stampHealthMarker(healthTemplate, { appVersion, buildId })));
  }
  await Promise.all(writes);

  return metadata;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  stampServiceWorker()
    .then(({ buildId }) => {
      console.log(`[PWA] Stamped service worker build ${buildId}`);
    })
    .catch((error) => {
      console.error('[PWA] Failed to stamp service worker', error);
      process.exitCode = 1;
    });
}
