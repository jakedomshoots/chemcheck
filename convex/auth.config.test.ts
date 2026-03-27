import { afterEach, describe, expect, it, vi } from "vitest";

const PRODUCTION_DOMAIN = "https://clerk.chemcheck.xyz";
const DEV_DOMAIN = "https://game-sloth-45.clerk.accounts.dev";

async function loadConfigWithEnv(env: Record<string, string | undefined>) {
  vi.resetModules();

  const previous = {
    CONVEX_DEPLOYMENT_ENV: process.env.CONVEX_DEPLOYMENT_ENV,
    CONVEX_CLOUD_URL: process.env.CONVEX_CLOUD_URL,
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };

  Object.assign(process.env, env);

  const mod = await import("./auth.config.js");

  Object.assign(process.env, previous);

  return mod.default;
}

describe("auth.config", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.CONVEX_DEPLOYMENT_ENV;
    delete process.env.CONVEX_CLOUD_URL;
    delete process.env.NODE_ENV;
    delete process.env.VERCEL_ENV;
  });

  it("never includes the dev Clerk domain in production", async () => {
    const config = await loadConfigWithEnv({
      CONVEX_DEPLOYMENT_ENV: "production",
      CONVEX_CLOUD_URL: "https://steady-otter-123.convex.cloud",
      NODE_ENV: "production",
      VERCEL_ENV: "production",
    });

    const domains = config.providers.map((provider: { domain: string }) => provider.domain);
    expect(domains).toContain(PRODUCTION_DOMAIN);
    expect(domains).not.toContain(DEV_DOMAIN);
  });

  it("includes the dev Clerk domain outside production", async () => {
    const config = await loadConfigWithEnv({
      CONVEX_DEPLOYMENT_ENV: "development",
      NODE_ENV: "development",
      VERCEL_ENV: "preview",
    });

    const domains = config.providers.map((provider: { domain: string }) => provider.domain);
    expect(domains).toContain(PRODUCTION_DOMAIN);
    expect(domains).toContain(DEV_DOMAIN);
  });
});
