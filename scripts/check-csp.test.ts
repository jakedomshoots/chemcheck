/**
 * Guards the production Content-Security-Policy in vercel.json. The policy is
 * enforcing (not report-only), script-src stays strict, and every third-party
 * host the app talks to is allow-listed. The inline theme bootstrap script in
 * index.html is permitted via its SHA-256 hash, so this test also fails when
 * that script changes without the hash being updated.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const vercel = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const indexHtml = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const serviceWorker = readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> };

function globalHeaders(): Array<{ key: string; value: string }> {
  const rule = (vercel.headers as HeaderRule[]).find((entry) => entry.source === '/(.*)');
  if (!rule) throw new Error('vercel.json has no global /(.*) header rule');
  return rule.headers;
}

export function parseCsp(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const [name, ...values] = tokens;
    directives.set(name, values);
  }
  return directives;
}

function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const pattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const body = match[1];
    if (!body.trim()) continue;
    hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return hashes;
}

const REQUIRED: Record<string, string[]> = {
  'default-src': ["'self'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
  'frame-ancestors': ["'none'"],
  'form-action': ["'self'"],
  'worker-src': ["'self'", 'blob:'],
  'script-src': [
    "'self'",
    'https://clerk.chemcheck.xyz',
    'https://*.clerk.accounts.dev',
    'https://challenges.cloudflare.com',
    'https://js.stripe.com',
    'https://www.googletagmanager.com',
  ],
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
  'img-src': ["'self'", 'data:', 'blob:', 'https://*.convex.cloud', 'https://*.convex.site', 'https://img.clerk.com'],
  'connect-src': [
    "'self'",
    'https://clerk.chemcheck.xyz',
    'https://*.clerk.accounts.dev',
    'https://*.convex.cloud',
    'https://*.convex.site',
    'wss://*.convex.cloud',
    'wss://*.convex.site',
    'https://api.stripe.com',
    'https://*.sentry.io',
    'https://*.ingest.sentry.io',
    'https://*.ingest.us.sentry.io',
    'https://www.google-analytics.com',
  ],
  'frame-src': [
    "'self'",
    'https://js.stripe.com',
    'https://hooks.stripe.com',
    'https://clerk.chemcheck.xyz',
    'https://*.clerk.accounts.dev',
    'https://challenges.cloudflare.com',
  ],
};

describe('vercel.json Content-Security-Policy', () => {
  const headers = globalHeaders();
  const cspHeader = headers.find((h) => h.key === 'Content-Security-Policy');
  const directives = parseCsp(cspHeader?.value ?? '');

  it('is enforcing, not report-only', () => {
    expect(cspHeader, 'Content-Security-Policy header missing').toBeDefined();
    expect(headers.some((h) => h.key === 'Content-Security-Policy-Report-Only')).toBe(false);
    expect(cspHeader?.value).not.toMatch(/report-uri|report-to/);
  });

  it.each(Object.entries(REQUIRED))('%s allows every required source', (directive, sources) => {
    const actual = directives.get(directive);
    expect(actual, `${directive} directive missing`).toBeDefined();
    for (const source of sources) {
      expect(actual, `${directive} is missing ${source}`).toContain(source);
    }
  });

  it('keeps script-src strict: no unsafe-inline or unsafe-eval', () => {
    const scriptSrc = directives.get('script-src') ?? [];
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).not.toContain('*');
    expect(scriptSrc).not.toContain('https:');
  });

  it('does not rely on inline event handlers outside the hashed theme bootstrap', () => {
    expect(indexHtml).not.toMatch(/\son[a-z]+\s*=/i);
    expect(serviceWorker).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it('allows the inline theme bootstrap in index.html by hash and nothing else inline', () => {
    const hashes = inlineScriptHashes(indexHtml);
    expect(hashes.length, 'index.html should contain exactly one inline script').toBe(1);
    const scriptSrc = directives.get('script-src') ?? [];
    for (const hash of hashes) {
      expect(scriptSrc, `script-src is missing ${hash}; update vercel.json after changing the inline script in index.html`).toContain(hash);
    }
    const listedHashes = scriptSrc.filter((token) => token.startsWith("'sha256-"));
    expect(listedHashes).toEqual(hashes);
  });

  it('uses only https/wss sources outside of self and scheme keywords', () => {
    for (const [directive, sources] of directives) {
      if (directive === 'upgrade-insecure-requests') continue;
      for (const source of sources) {
        if (source.startsWith("'") || /^(data|blob):$/.test(source)) continue;
        expect(source, `${directive} has non-TLS source ${source}`).toMatch(/^(https|wss):\/\//);
      }
    }
  });
});
