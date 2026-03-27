import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const ZERO_SHA = '0000000000000000000000000000000000000000';

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function resolveBaseSha() {
  const configuredBase = process.env.LINT_BASE_SHA?.trim();
  if (configuredBase && configuredBase !== ZERO_SHA) {
    return configuredBase;
  }

  try {
    return runGit(['rev-parse', 'HEAD~1']);
  } catch {
    return '';
  }
}

function getChangedFiles(baseSha, headSha) {
  if (!baseSha) {
    return runGit(['ls-files'])
      .split('\n')
      .filter(Boolean);
  }

  return runGit(['diff', '--name-only', `${baseSha}...${headSha}`])
    .split('\n')
    .filter(Boolean);
}

const headSha = process.env.LINT_HEAD_SHA?.trim() || 'HEAD';
const changedFiles = getChangedFiles(resolveBaseSha(), headSha)
  .filter((file) => ['.js', '.jsx'].some((extension) => file.endsWith(extension)))
  .filter((file) => existsSync(file));

if (changedFiles.length === 0) {
  console.log('No changed JS/JSX files to lint.');
  process.exit(0);
}

console.log('Linting changed files:');
changedFiles.forEach((file) => console.log(`- ${file}`));

const result = spawnSync(
  'npx',
  ['eslint', '--report-unused-disable-directives', '--quiet', ...changedFiles],
  { stdio: 'inherit' }
);

process.exit(result.status ?? 1);
