import { describe, expect, it, vi } from 'vitest';
import { ensureMainCurrent, getRemoteName, parseAheadBehind } from './ensure-main-current.js';

function createLogger() {
  return {
    error: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
  };
}

function createGitRunner(outputs) {
  const calls = [];
  const runGit = (args) => {
    calls.push(args);
    const key = args.join(' ');
    const value = outputs[key];
    return value ?? { status: 1, stdout: '', stderr: `missing mock for ${key}` };
  };

  return { calls, runGit };
}

describe('ensure-main-current', () => {
  it('parses Git ahead and behind counts', () => {
    expect(parseAheadBehind('2\t3')).toEqual({ ahead: 2, behind: 3 });
    expect(parseAheadBehind('0 0')).toEqual({ ahead: 0, behind: 0 });
    expect(parseAheadBehind('bad output')).toBeNull();
  });

  it('gets the remote name from an upstream branch', () => {
    expect(getRemoteName('origin/main')).toBe('origin');
    expect(getRemoteName('main')).toBe('');
  });

  it('passes when local main matches its upstream', () => {
    const logger = createLogger();
    const { runGit } = createGitRunner({
      'rev-parse --is-inside-work-tree': { status: 0, stdout: 'true', stderr: '' },
      'branch --show-current': { status: 0, stdout: 'main', stderr: '' },
      'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { status: 0, stdout: 'origin/main', stderr: '' },
      'fetch --quiet --prune origin': { status: 0, stdout: '', stderr: '' },
      'rev-list --left-right --count HEAD...origin/main': { status: 0, stdout: '0\t0', stderr: '' },
    });

    expect(ensureMainCurrent({ logger, runGit })).toBe(0);
    expect(logger.log).toHaveBeenCalledWith('[freshness] main is current with origin/main');
  });

  it('fails when local main is behind its upstream', () => {
    const logger = createLogger();
    const { runGit } = createGitRunner({
      'rev-parse --is-inside-work-tree': { status: 0, stdout: 'true', stderr: '' },
      'branch --show-current': { status: 0, stdout: 'main', stderr: '' },
      'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { status: 0, stdout: 'origin/main', stderr: '' },
      'fetch --quiet --prune origin': { status: 0, stdout: '', stderr: '' },
      'rev-list --left-right --count HEAD...origin/main': { status: 0, stdout: '0\t2', stderr: '' },
    });

    expect(ensureMainCurrent({ logger, runGit })).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Local main is behind origin/main by 2 commit(s).'));
  });

  it('allows feature branches but warns to land UI work on main', () => {
    const logger = createLogger();
    const { runGit } = createGitRunner({
      'rev-parse --is-inside-work-tree': { status: 0, stdout: 'true', stderr: '' },
      'branch --show-current': { status: 0, stdout: 'codex/home-route-ux-polish', stderr: '' },
    });

    expect(ensureMainCurrent({ logger, runGit })).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not main'));
  });
});
