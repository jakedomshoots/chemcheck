import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeDb, makeCtx, seedBusiness, seedMember } from "./fakeConvexDb.testing";
import {
  buildAuthorizeUrl,
  buildSettingsRedirect,
  exchangeCodeForTokens,
  fromBase64Url,
  managedBusinessFor,
  openSecret,
  qboApiBase,
  qboCompanyUrl,
  readQboConfig,
  refreshAccessToken,
  sealSecret,
  signState,
  toBase64Url,
  verifyState,
  type QboConfig,
} from "./quickbooks";

const ENV = {
  QBO_CLIENT_ID: "client-id",
  QBO_CLIENT_SECRET: "client-secret",
  QBO_REDIRECT_URI: "https://deploy.convex.site/quickbooks/callback",
  QBO_ENVIRONMENT: "sandbox",
  SITE_URL: "https://app.chemcheck.test/",
};

function config(overrides: Partial<QboConfig> = {}): QboConfig {
  return { ...readQboConfig(ENV).config!, ...overrides };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("configuration", () => {
  it("reads a complete config and reports missing variables", () => {
    const ok = readQboConfig(ENV);
    expect(ok.missing).toEqual([]);
    expect(ok.config).toMatchObject({ clientId: "client-id", environment: "sandbox", siteUrl: "https://app.chemcheck.test", stateSecret: "client-secret" });
    const bad = readQboConfig({ QBO_CLIENT_ID: "x", QBO_REDIRECT_URI: "http://example.com/cb", QBO_ENVIRONMENT: "prod" });
    expect(bad.config).toBeNull();
    expect(bad.missing).toEqual(["QBO_CLIENT_SECRET", "QBO_REDIRECT_URI (must be https)", "QBO_ENVIRONMENT (sandbox|production)", "SITE_URL"]);
    expect(readQboConfig({ ...ENV, SITE_URL: "", APP_URL: "https://fallback.test" }).config?.siteUrl).toBe("https://fallback.test");
  });

  it("picks API and company URLs per environment", () => {
    expect(qboApiBase("sandbox")).toContain("sandbox-quickbooks");
    expect(qboApiBase("production")).toBe("https://quickbooks.api.intuit.com");
    expect(qboCompanyUrl("production")).toContain("app.qbo.intuit.com");
  });

  it("builds the authorize URL and the settings redirect", () => {
    const url = new URL(buildAuthorizeUrl(config(), "the-state"));
    expect(url.origin + url.pathname).toBe("https://appcenter.intuit.com/connect/oauth2");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("state")).toBe("the-state");
    expect(url.searchParams.get("scope")).toBe("com.intuit.quickbooks.accounting");
    expect(buildSettingsRedirect("https://app.chemcheck.test", { ok: true })).toBe("https://app.chemcheck.test/settings?section=integrations&quickbooks=connected");
    expect(buildSettingsRedirect("https://app.chemcheck.test", { ok: false, error: "invalid_state" })).toContain("quickbooks=error&reason=invalid_state");
    expect(buildSettingsRedirect("", { ok: true })).toContain("https://app.chemcheck.app/settings");
  });
});

describe("state signing", () => {
  it("round-trips, rejects tampering, and expires", async () => {
    const payload = { b: "biz1", e: "owner@example.com", n: "nonce", x: Date.now() + 60_000 };
    const state = await signState(payload, "secret");
    expect(await verifyState(state, "secret")).toEqual(payload);
    expect(await verifyState(state, "other-secret")).toBeNull();
    const [body, sig] = state.split(".");
    const tampered = `${toBase64Url(new TextEncoder().encode(JSON.stringify({ ...payload, b: "biz2" })))}.${sig}`;
    expect(await verifyState(tampered, "secret")).toBeNull();
    expect(await verifyState(`${body}.`, "secret")).toBeNull();
    expect(await verifyState("garbage", "secret")).toBeNull();
    expect(await verifyState(undefined, "secret")).toBeNull();
    expect(await verifyState(state, "secret", payload.x + 1)).toBeNull();
  });

  it("base64url helpers round-trip bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const text = toBase64Url(bytes);
    expect(text).not.toMatch(/[+/=]/);
    expect(Array.from(fromBase64Url(text))).toEqual(Array.from(bytes));
  });
});

describe("token sealing", () => {
  it("encrypts with a key and tags plaintext without one", async () => {
    const sealed = await sealSecret("access-token", "a-long-encryption-key");
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("access-token");
    expect(await openSecret(sealed, "a-long-encryption-key")).toBe("access-token");
    await expect(openSecret(sealed, "wrong-key")).rejects.toThrow();
    await expect(openSecret(sealed)).rejects.toThrow(/QBO_TOKEN_ENCRYPTION_KEY/);
    const plain = await sealSecret("refresh", undefined);
    expect(plain).toBe("plain:refresh");
    expect(await openSecret(plain)).toBe("refresh");
    await expect(openSecret("??")).rejects.toThrow(/Unrecognized/);
  });
});

describe("Intuit token endpoints", () => {
  it("exchanges a code and refreshes without leaking the response body in errors", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "A", refresh_token: "R", expires_in: 3600, x_refresh_token_expires_in: 100 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_grant", access_token: "LEAK" }), { status: 400 }))
      .mockResolvedValueOnce(new Response("not json", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const tokens = await exchangeCodeForTokens(config(), "code123");
    expect(tokens).toEqual({ access_token: "A", refresh_token: "R", expires_in: 3600, x_refresh_token_expires_in: 100 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
    expect(init.headers.Authorization).toBe(`Basic ${btoa("client-id:client-secret")}`);
    expect(String(init.body)).toContain("grant_type=authorization_code");
    expect(String(init.body)).toContain("code=code123");
    await expect(refreshAccessToken(config(), "R")).rejects.toThrow("QuickBooks token request failed (invalid_grant).");
    await expect(refreshAccessToken(config(), "R")).rejects.toThrow("QuickBooks token request failed (HTTP 500).");
  });
});

describe("managedBusinessFor", () => {
  it("allows owners and admins only", async () => {
    const db = new FakeDb();
    const ctx = makeCtx(db);
    const biz = await seedBusiness(db, "owner@example.com");
    await seedMember(db, biz, "admin@example.com", { role: "admin" });
    await seedMember(db, biz, "tech@example.com", { role: "technician" });
    expect((await managedBusinessFor(ctx, "owner@example.com"))?._id).toBe(biz);
    expect((await managedBusinessFor(ctx, "admin@example.com"))?._id).toBe(biz);
    expect(await managedBusinessFor(ctx, "tech@example.com")).toBeNull();
    expect(await managedBusinessFor(ctx, "nobody@example.com")).toBeNull();
  });
});
