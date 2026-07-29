import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BUILD_ID_PLACEHOLDER = '__CHEMCHECK_BUILD_ID__';

function normalizeCommitSha(environment) {
  const candidate = environment.VERCEL_GIT_COMMIT_SHA || environment.GITHUB_SHA || '';
  return /^[a-f0-9]{7,64}$/i.test(candidate) ? candidate.toLowerCase() : null;
}

export async function stampServiceWorker({
  distDir = path.resolve('dist'),
  environment = process.env,
} = {}) {
  const indexPath = path.join(distDir, 'index.html');
  const workerPath = path.join(distDir, 'sw.js');
  const metadataPath = path.join(distDir, 'build.json');
  const [indexHtml, workerTemplate] = await Promise.all([
    readFile(indexPath, 'utf8'),
    readFile(workerPath, 'utf8'),
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
    generatedAt: new Date().toISOString(),
  };

  await Promise.all([
    writeFile(workerPath, stampedWorker),
    writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`),
  ]);

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
