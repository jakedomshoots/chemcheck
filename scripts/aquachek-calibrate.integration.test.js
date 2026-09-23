import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const temporaryDirectories = [];
const projectRoot = process.cwd();
const runner = path.join(projectRoot, 'scripts/aquachek-calibrate.mjs');
const fixture = path.join(projectRoot, 'artifacts/lsi-screenshots/aquachek-synthetic-strip.jpg');
const header = 'sample_id,image,device,strip_lot,seconds_after_dip,lighting,cohort,truth_method,truth_instrument,total_hardness,total_chlorine,free_chlorine,ph,total_alkalinity,cyanuric_acid';

async function createCorpus(rows) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chemcheck-aquachek-integration-'));
  temporaryDirectories.push(directory);
  await fs.mkdir(path.join(directory, 'photos'));
  await fs.copyFile(fixture, path.join(directory, 'photos/synthetic.jpg'));
  await fs.writeFile(path.join(directory, 'manifest.csv'), `${header}\n${rows.join('\n')}\n`);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.rm(directory, { recursive: true, force: true })
  )));
});

describe('AquaChek calibration command', () => {
  it('runs the production decoder in Chromium and writes both audit reports', async () => {
    const directory = await createCorpus([
      'synthetic-001,photos/synthetic.jpg,Synthetic Camera,TEST-LOT,15,test-light,validation,laboratory,Synthetic truth fixture,250,3,3,7.2,120,100',
    ]);

    const result = await execFileAsync(process.execPath, [runner, directory], {
      cwd: projectRoot,
      timeout: 20000,
    });

    expect(result.stdout).toContain('synthetic-001: high');
    expect(result.stdout).toContain('Calibration decision: needs-data');
    const json = JSON.parse(await fs.readFile(path.join(directory, 'reports/latest.json'), 'utf8'));
    expect(json.analyzerVersion).toBe('aquachek-select-v4');
    expect(json.report.summary.acceptedValidationPhotos).toBe(1);
    expect(json.report.analytes.ph.exactLevelRate).toBe(1);
    await expect(fs.readFile(path.join(directory, 'reports/latest.md'), 'utf8')).resolves.toContain('Held-out validation accuracy');
  }, 25000);

  it('rejects a duplicated photo before it can inflate readiness', async () => {
    const directory = await createCorpus([
      'first,photos/synthetic.jpg,Synthetic Camera,TEST-LOT,15,test-light,validation,laboratory,Synthetic truth fixture,250,3,3,7.2,120,100',
      'second,photos/synthetic.jpg,Synthetic Camera,TEST-LOT,15,test-light,validation,laboratory,Synthetic truth fixture,250,3,3,7.2,120,100',
    ]);

    await expect(execFileAsync(process.execPath, [runner, directory], {
      cwd: projectRoot,
      timeout: 10000,
    })).rejects.toMatchObject({ code: 1 });
  });
});
