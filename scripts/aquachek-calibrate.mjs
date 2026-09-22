#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import {
  CALIBRATION_MANIFEST_COLUMNS,
  parseCalibrationManifest,
  renderCalibrationMarkdown,
} from './aquachek-calibration-lib.mjs';

const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function usage() {
  return [
    'Usage:',
    '  npm run calibrate:aquachek -- --init <corpus-directory>',
    '  npm run calibrate:aquachek -- <corpus-directory> [--require-ready]',
    '',
    'The corpus directory must contain manifest.csv and the relative image paths listed in it.',
  ].join('\n');
}

function parseArguments(argv) {
  const flags = new Set(argv.filter((argument) => argument.startsWith('--')));
  const positional = argv.filter((argument) => !argument.startsWith('--'));
  const unknownFlags = [...flags].filter((flag) => !['--init', '--require-ready', '--help'].includes(flag));
  if (unknownFlags.length > 0) throw new Error(`Unknown option: ${unknownFlags[0]}\n\n${usage()}`);
  return {
    help: flags.has('--help'),
    initialize: flags.has('--init'),
    requireReady: flags.has('--require-ready'),
    corpusDirectory: positional[0],
  };
}

async function initializeCorpus(corpusRoot) {
  await fs.mkdir(path.join(corpusRoot, 'photos'), { recursive: true });
  const manifestPath = path.join(corpusRoot, 'manifest.csv');
  try {
    await fs.writeFile(manifestPath, `${CALIBRATION_MANIFEST_COLUMNS.join(',')}\n`, { flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    throw new Error(`Refusing to overwrite existing manifest: ${manifestPath}`);
  }
  console.log(`Created AquaChek calibration corpus at ${corpusRoot}`);
  console.log(`1. Put route photos in ${path.join(corpusRoot, 'photos')}`);
  console.log(`2. Add one row per photo to ${manifestPath}`);
  console.log(`3. Run: npm run calibrate:aquachek -- ${corpusRoot}`);
}

function resolveCorpusImage(corpusRoot, image) {
  const resolved = path.resolve(corpusRoot, image);
  const relative = path.relative(corpusRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Image path must stay inside the corpus directory: ${image}`);
  }
  return resolved;
}

async function validateImages(corpusRoot, rows) {
  const validated = [];
  const seenPaths = new Map();
  const seenHashes = new Map();
  for (const row of rows) {
    const imagePath = resolveCorpusImage(corpusRoot, row.image);
    const stats = await fs.stat(imagePath).catch(() => null);
    if (!stats?.isFile()) throw new Error(`Missing calibration photo for ${row.sampleId}: ${row.image}`);
    if (stats.size > 15 * 1024 * 1024) throw new Error(`Photo exceeds the app's 15 MB limit for ${row.sampleId}: ${row.image}`);
    const extension = path.extname(imagePath).toLowerCase();
    const mimeType = MIME_TYPES[extension];
    if (!mimeType) throw new Error(`Unsupported photo type for ${row.sampleId}: ${extension || '(none)'}`);
    const normalizedPath = path.normalize(imagePath).toLowerCase();
    if (seenPaths.has(normalizedPath)) {
      throw new Error(`Duplicate image path used by ${seenPaths.get(normalizedPath)} and ${row.sampleId}: ${row.image}`);
    }
    seenPaths.set(normalizedPath, row.sampleId);
    const hash = createHash('sha256').update(await fs.readFile(imagePath)).digest('hex');
    if (seenHashes.has(hash)) {
      throw new Error(`Byte-identical photos used by ${seenHashes.get(hash)} and ${row.sampleId}.`);
    }
    seenHashes.set(hash, row.sampleId);
    validated.push({ ...row, imagePath, mimeType });
  }
  return validated;
}

async function analyzeCorpus(corpusRows) {
  const server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
  });
  let browser;
  try {
    await server.listen();
    const origin = server.resolvedUrls?.local?.[0];
    if (!origin) throw new Error('Could not start the local calibration runtime.');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(origin, { waitUntil: 'domcontentloaded' });

    const analyzerVersion = await page.evaluate(async () => {
      const module = await import('/src/lib/aquachekImageAnalysis.ts');
      return module.AQUACHEK_ANALYSIS_VERSION;
    });

    const samples = [];
    for (const row of corpusRows) {
      const bytes = await fs.readFile(row.imagePath);
      const outcome = await page.evaluate(async ({ base64, filename, mimeType }) => {
        const binary = atob(base64);
        const data = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index);
        const file = new File([data], filename, { type: mimeType });
        const module = await import('/src/lib/aquachekImageAnalysis.ts');
        try {
          const analysis = await module.analyzeAquaChekPhoto(file);
          return {
            kind: 'accepted',
            readings: analysis.readings,
            confidence: analysis.confidence,
            analysisVersion: analysis.analysisVersion,
            padConfidence: analysis.padConfidence,
            quality: analysis.quality,
          };
        } catch (error) {
          return {
            kind: 'rejected',
            code: error?.code ?? 'analysis-error',
            message: error instanceof Error ? error.message : String(error),
          };
        }
      }, {
        base64: bytes.toString('base64'),
        filename: path.basename(row.imagePath),
        mimeType: row.mimeType,
      });
      samples.push({
        sampleId: row.sampleId,
        image: row.image,
        device: row.device,
        stripLot: row.stripLot,
        secondsAfterDip: row.secondsAfterDip,
        lighting: row.lighting,
        cohort: row.cohort,
        truthMethod: row.truthMethod,
        truthInstrument: row.truthInstrument,
        truth: row.truth,
        outcome,
      });
      console.log(`${outcome.kind === 'accepted' ? '✓' : '×'} ${row.sampleId}: ${outcome.kind === 'accepted' ? outcome.confidence : outcome.code}`);
    }

    const report = await page.evaluate(async (calibrationSamples) => {
      const module = await import('/src/lib/aquachekCalibration.ts');
      return module.scoreAquaChekCalibration(calibrationSamples);
    }, samples);
    return { analyzerVersion, samples, report };
  } finally {
    await browser?.close();
    await server.close();
  }
}

async function run() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.corpusDirectory) throw new Error(usage());
  const corpusRoot = path.resolve(args.corpusDirectory);
  if (args.initialize) {
    await initializeCorpus(corpusRoot);
    return;
  }

  const manifestPath = path.join(corpusRoot, 'manifest.csv');
  const manifest = await fs.readFile(manifestPath, 'utf8').catch(() => {
    throw new Error(`Missing manifest: ${manifestPath}\nRun with --init first.`);
  });
  const rows = parseCalibrationManifest(manifest);
  if (rows.length === 0) throw new Error('Manifest has no calibration samples.');
  const corpusRows = await validateImages(corpusRoot, rows);
  const analysis = await analyzeCorpus(corpusRows);
  const result = {
    generatedAt: new Date().toISOString(),
    analyzerVersion: analysis.analyzerVersion,
    corpus: { manifest: 'manifest.csv', sampleCount: rows.length },
    samples: analysis.samples,
    report: analysis.report,
  };
  const reportsDirectory = path.join(corpusRoot, 'reports');
  await fs.mkdir(reportsDirectory, { recursive: true });
  const jsonPath = path.join(reportsDirectory, 'latest.json');
  const markdownPath = path.join(reportsDirectory, 'latest.md');
  await fs.writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  await fs.writeFile(markdownPath, renderCalibrationMarkdown(result));

  console.log('');
  console.log(`Calibration decision: ${result.report.readiness.status}`);
  console.log(`Report: ${markdownPath}`);
  console.log(`Data: ${jsonPath}`);
  if (args.requireReady && result.report.readiness.status !== 'ready') process.exitCode = 2;
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
