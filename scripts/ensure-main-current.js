import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_BRANCH = 'main';
const SKIP_ENV_VAR = 'CHEMCHECK_SKIP_GIT_FRESHNESS_CHECK';

function defaultRunGit(args) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function warn(logger, message) {
  logger.warn(`[freshness] ${message}`);
}

export function parseAheadBehind(output) {
  const [aheadText, behindText] = output.trim().split(/\s+/);
  const ahead = Number.parseInt(aheadText, 10);
  const behind = Number.parseInt(behindText, 10);

  if (!Number.isInteger(ahead) || !Number.isInteger(behind) || ahead < 0 || behind < 0) {
    return null;
  }

  return { ahead, behind };
}

export function getRemoteName(upstream) {
  const [remote, branch] = upstream.split('/');
  return remote && branch ? remote : '';
}

export function ensureMainCurrent({
  env = process.env,
  logger = console,
  runGit = defaultRunGit,
} = {}) {
  if (env[SKIP_ENV_VAR] === 'true') {
    warn(logger, `skipped because ${SKIP_ENV_VAR}=true`);
    return 0;
  }

  const insideWorkTree = runGit(['rev-parse', '--is-inside-work-tree']);
  if (insideWorkTree.status !== 0 || insideWorkTree.stdout !== 'true') {
    warn(logger, 'not inside a Git worktree, so the freshness check was skipped');
    return 0;
  }

  const branchResult = runGit(['branch', '--show-current']);
  if (branchResult.status !== 0 || !branchResult.stdout) {
    warn(logger, 'detached HEAD or unknown branch, so the freshness check was skipped');
    return 0;
  }

  const currentBranch = branchResult.stdout;
  if (currentBranch !== DEFAULT_BRANCH) {
    warn(logger, `running on ${currentBranch}, not ${DEFAULT_BRANCH}; make sure UI work lands on ${DEFAULT_BRANCH}`);
    return 0;
  }

  const upstreamResult = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  if (upstreamResult.status !== 0 || !upstreamResult.stdout) {
    warn(logger, `${DEFAULT_BRANCH} has no upstream; cannot confirm it is current`);
    return 0;
  }

  const upstream = upstreamResult.stdout;
  const remote = getRemoteName(upstream);
  if (remote) {
    const fetchResult = runGit(['fetch', '--quiet', '--prune', remote]);
    if (fetchResult.status !== 0) {
      warn(logger, `could not refresh ${remote}; checking against the last known ${upstream}`);
    }
  }

  const countResult = runGit(['rev-list', '--left-right', '--count', `HEAD...${upstream}`]);
  if (countResult.status !== 0) {
    warn(logger, `could not compare ${DEFAULT_BRANCH} with ${upstream}`);
    return 0;
  }

  const counts = parseAheadBehind(countResult.stdout);
  if (!counts) {
    warn(logger, `could not parse Git ahead/behind output: ${countResult.stdout}`);
    return 0;
  }

  if (counts.behind > 0) {
    logger.error([
      `[freshness] Local ${DEFAULT_BRANCH} is behind ${upstream} by ${counts.behind} commit(s).`,
      '[freshness] The app may show an older UI until you update it.',
      `[freshness] Run: git pull --ff-only`,
      `[freshness] To bypass once: ${SKIP_ENV_VAR}=true npm run dev`,
    ].join('\n'));
    return 1;
  }

  if (counts.ahead > 0) {
    warn(logger, `local ${DEFAULT_BRANCH} is ${counts.ahead} commit(s) ahead of ${upstream}; push when ready`);
    return 0;
  }

  logger.log(`[freshness] ${DEFAULT_BRANCH} is current with ${upstream}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = ensureMainCurrent();
}
