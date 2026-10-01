import { describe, expect, it } from "vitest";
import { FakeDb, makeCtx, seedBusiness, seedCustomer, seedMember } from "./fakeConvexDb.testing";
import {
  PORTAL_MAX_OPEN_REQUESTS,
  PORTAL_TOKEN_TTL_MS,
  createOrRotatePortalLinkForCustomer,
  createServiceRequestForToken,
  firstNameOf,
  isPlausibleToken,
  loadPortalForToken,
  portalLinkStatusForCustomer,
  revokePortalLinksForCustomer,
  validatePortalToken,
  validateServiceRequest,
} from "./portal";

const OWNER = "owner@example.com";
const ADMIN = "admin@example.com";
const TECH = "tech@example.com";
const NOW = Date.UTC(2026, 2, 10, 12);
const TOKEN = "11111111-2222-4333-8444-555555555555";

async function setup(customerOverrides: Record<string, any> = {}) {
  const db = new FakeDb();
  const ctx = makeCtx(db);
  const biz = await seedBusiness(db, OWNER, "Blue Pools");
  await db.patch(biz, { phone: "+15551234567", email: "hello@bluepools.com" });
  await seedMember(db, biz, ADMIN, { role: "admin" });
  await seedMember(db, biz, TECH, { role: "technician" });
  const customer = await seedCustomer(db, TECH, { full_name: "Alice Johnson", business_id: biz, service_day: "Monday", ...customerOverrides });
  return { db, ctx, biz, customer };
}

describe("portal links", () => {
  it("creates a one-year token, rotates it, and reports status", async () => {
    const { db, ctx, customer } = await setup();
    const first = await createOrRotatePortalLinkForCustomer(ctx as any, TECH, customer as any, { now: NOW, token: TOKEN });
    expect(first).toEqual({ token: TOKEN, expires_at: NOW + PORTAL_TOKEN_TTL_MS });
    expect(await portalLinkStatusForCustomer(ctx, OWNER, customer as any, NOW)).toMatchObject({ token: TOKEN, last_access_at: null });

    const second = await createOrRotatePortalLinkForCustomer(ctx as any, ADMIN, customer as any, { now: NOW + 1000 });
    expect(second.token).not.toBe(TOKEN);
    expect(second.token).toMatch(/^[0-9a-f-]{36}$/);
    const rows = db.all("portalTokens");
    expect(rows.find((r) => r.token === TOKEN)?.revoked_at).toBe(NOW + 1000);
    expect((await portalLinkStatusForCustomer(ctx, TECH, customer as any, NOW + 2000))?.token).toBe(second.token);

    expect(await revokePortalLinksForCustomer(ctx as any, OWNER, customer as any, NOW + 3000)).toBe(1);
    expect(await portalLinkStatusForCustomer(ctx, TECH, customer as any, NOW + 4000)).toBeNull();
  });

  it("rejects callers who are not the creator or a business manager", async () => {
    const { db, ctx, customer } = await setup();
    await seedBusiness(db, "other@example.com", "Other Co");
    await expect(createOrRotatePortalLinkForCustomer(ctx as any, "other@example.com", customer as any)).rejects.toThrow(/access denied|manage portal/);
    const { customer: ownerCustomer } = await setup();
    void ownerCustomer;
    // A technician who did not create the customer cannot manage its link.
    const colleague = await seedCustomer(db, OWNER, { full_name: "Owner Customer" });
    await expect(createOrRotatePortalLinkForCustomer(ctx as any, TECH, colleague as any)).rejects.toThrow(/manage portal links/);
    expect(await portalLinkStatusForCustomer(ctx, "other@example.com", customer as any)).toBeNull();
  });

  it("validates token state and shape", () => {
    expect(validatePortalToken({}, NOW)).toBe("ok");
    expect(validatePortalToken({ revoked_at: 1 }, NOW)).toBe("revoked");
    expect(validatePortalToken({ expires_at: NOW }, NOW)).toBe("expired");
    expect(validatePortalToken({ expires_at: NOW + 1 }, NOW)).toBe("ok");
    expect(isPlausibleToken(TOKEN)).toBe(true);
    expect(isPlausibleToken("short")).toBe(false);
    expect(isPlausibleToken("x".repeat(65))).toBe(false);
    expect(isPlausibleToken("has space here, really")).toBe(false);
    expect(firstNameOf("Alice Johnson")).toBe("Alice");
    expect(firstNameOf("")).toBe("there");
  });
});

describe("loadPortalForToken", () => {
  it("returns failure reasons for missing, revoked and expired tokens", async () => {
    const { db, ctx, customer } = await setup();
    expect(await loadPortalForToken(ctx, "nope", NOW)).toMatchObject({ found: false, failure_reason: "not_found" });
    expect(await loadPortalForToken(ctx, TOKEN, NOW)).toMatchObject({ found: false, failure_reason: "not_found" });
    await db.insert("portalTokens", { customer_id: customer, token: TOKEN, created_at: NOW, expires_at: NOW - 1 });
    expect(await loadPortalForToken(ctx, TOKEN, NOW)).toMatchObject({ found: false, failure_reason: "expired" });
    await db.insert("portalTokens", { customer_id: customer, token: "revoked-token-000000", created_at: NOW, revoked_at: NOW });
    expect(await loadPortalForToken(ctx, "revoked-token-000000", NOW)).toMatchObject({ found: false, failure_reason: "revoked" });
  });

  it("builds the customer view and enforces report settings", async () => {
    const { db, ctx, biz, customer } = await setup({
      report_settings: { show_chemical_readings: false, show_photos: true, show_service_notes: false, show_technician_name: true, show_service_duration: false, show_overall_status: true },
    });
    await createOrRotatePortalLinkForCustomer(ctx as any, TECH, customer as any, { now: NOW, token: TOKEN });
    const log = await db.insert("serviceLogs", { customer_id: customer, created_by: TECH, service_date: "2026-03-02", status: "completed", service_type: "Regular Cleaning", notes: "secret notes", ph: "high", chlorine: "good", alkalinity: "good", stabilizer: "good", duration_ms: 1800000 });
    await db.insert("serviceLogs", { customer_id: customer, created_by: TECH, service_date: "2026-03-09", status: "completed", ph: "good", chlorine: "good", alkalinity: "good", stabilizer: "good" });
    await db.insert("serviceLogs", { customer_id: customer, created_by: TECH, service_date: "2026-03-16", status: "completed", ph: "good", chlorine: "good", alkalinity: "good", stabilizer: "good", deleted_at: 1 });
    await db.insert("servicePhotos", { service_log_id: log, customer_id: customer, category: "after", storage_id: "st1", timestamp: "t", created_at: 1 });
    await db.insert("invoices", { customer_id: customer, created_by: TECH, status: "sent", line_items: [], subtotal: 100, tax: 0, total: 100, due_date: "2026-03-20", payment_url: "https://pay/1", sent_at: NOW, created_at: NOW, updated_at: NOW });
    await db.insert("invoices", { customer_id: customer, created_by: TECH, status: "paid", line_items: [], subtotal: 50, tax: 0, total: 50, created_at: NOW, updated_at: NOW });
    await db.insert("quotes", { customer_id: customer, created_by: TECH, title: "Pump replacement", status: "sent", line_items: [], subtotal: 900, tax: 0, total: 900, deposit_required: 200, deposit_status: "pending", deposit_payment_url: "https://pay/dep", created_at: NOW, updated_at: NOW });
    await db.insert("quotes", { customer_id: customer, created_by: TECH, title: "Old", status: "declined", line_items: [], subtotal: 1, tax: 0, total: 1, created_at: NOW, updated_at: NOW });
    await db.insert("workOrders", { customer_id: customer, business_id: biz, created_by: TECH, title: "Customer request: Filter", status: "requested", scheduled_date: "2026-03-12", is_recurring: false, created_at: NOW, updated_at: NOW });

    const storage = { getUrl: async (id: any) => (id === "st1" ? "https://img/1" : null) };
    const result = await loadPortalForToken({ ...ctx, storage } as any, TOKEN, NOW);
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.portal.business).toEqual({ name: "Blue Pools", phone: "+15551234567", email: "hello@bluepools.com" });
    expect(result.portal.customer).toEqual({ first_name: "Alice", service_day: "Monday" });
    expect(result.portal.visits.map((v) => v.date)).toEqual(["2026-03-09", "2026-03-02"]);
    const visit = result.portal.visits[1];
    expect(visit).toMatchObject({ overall_status: "needs_attention", readings: null, notes: null, technician: "Blue Pools", duration_ms: null, service_type: "Regular Cleaning" });
    expect(visit.photos).toEqual([{ id: expect.any(String), category: "after", url: "https://img/1" }]);
    expect(result.portal.open_invoices).toEqual([{ id: expect.any(String), total: 100, due_date: "2026-03-20", payment_url: "https://pay/1", sent_at: NOW }]);
    expect(result.portal.quotes).toEqual([expect.objectContaining({ title: "Pump replacement", total: 900, deposit_required: 200, deposit_payment_url: "https://pay/dep" })]);
    expect(result.portal.open_requests).toEqual([expect.objectContaining({ title: "Customer request: Filter" })]);
    expect(result.portal.allow_service_requests).toBe(true);
    expect(result.portal.expires_at).toBe(NOW + PORTAL_TOKEN_TTL_MS);
  });

  it("shows readings and notes when allowed and never includes photos without storage", async () => {
    const { db, ctx, customer } = await setup();
    await createOrRotatePortalLinkForCustomer(ctx as any, TECH, customer as any, { now: NOW, token: TOKEN });
    await db.insert("serviceLogs", { customer_id: customer, created_by: TECH, service_date: "2026-03-02", status: "completed", notes: "Brushed walls", ph: "good", chlorine: "low", alkalinity: "good", stabilizer: "good", salt: 3200 });
    const result = await loadPortalForToken(ctx, TOKEN, NOW);
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.portal.visits[0]).toMatchObject({ readings: { ph: "good", chlorine: "low", alkalinity: "good", stabilizer: "good", salt: 3200 }, notes: "Brushed walls", overall_status: "needs_attention", photos: [] });
  });

  it("honours a disabled portal in business settings", async () => {
    const { db, ctx, biz, customer } = await setup();
    const business = await db.get(biz);
    await db.patch(biz, { settings: { ...business!.settings, customer_portal: { enabled: false, allow_service_requests: true } } });
    await createOrRotatePortalLinkForCustomer(ctx as any, TECH, customer as any, { now: NOW, token: TOKEN });
    expect(await loadPortalForToken(ctx, TOKEN, NOW)).toMatchObject({ found: false, failure_reason: "disabled" });
  });
});

describe("service requests", () => {
  it("validates the message and preferred date", () => {
    expect(() => validateServiceRequest({ message: "hi" }, NOW)).toThrow(/tell us/);
    expect(() => validateServiceRequest({ message: "x".repeat(1001) }, NOW)).toThrow(/1000/);
    expect(() => validateServiceRequest({ message: "Pump noise", preferred_date: "2026-13-01" }, NOW)).toThrow(/valid date/);
    expect(() => validateServiceRequest({ message: "Pump noise", preferred_date: "2026-03-01" }, NOW)).toThrow(/past/);
    expect(validateServiceRequest({ message: "  Pump   noise ", preferred_date: "2026-03-12" }, NOW)).toEqual({ message: "Pump noise", preferred_date: "2026-03-12" });
    expect(validateServiceRequest({ message: "Pump noise", preferred_date: "" }, NOW)).toEqual({ message: "Pump noise", preferred_date: undefined });
  });

  it("creates a requested work order plus a note, attributed to the customer's creator", async () => {
    const { db, ctx, biz, customer } = await setup();
    await createOrRotatePortalLinkForCustomer(ctx as any, TECH, customer as any, { now: NOW, token: TOKEN });
    const result = await createServiceRequestForToken(ctx as any, TOKEN, { message: "The pump is grinding", preferred_date: "2026-03-14" }, NOW);
    expect(result.ok).toBe(true);
    const workOrder = db.all("workOrders")[0];
    expect(workOrder).toMatchObject({ customer_id: customer, business_id: biz, created_by: TECH, status: "requested", scheduled_date: "2026-03-14", title: "Customer request: The pump is grinding", description: "The pump is grinding", is_recurring: false, priority: "medium" });
    const note = db.all("notes")[0];
    expect(note).toMatchObject({ customer_id: customer, created_by: TECH, category: "Customer", title: "Portal request from Alice Johnson", created_date: "2026-03-10" });
    expect(note.content).toContain("Preferred date: 2026-03-14");
  });

  it("refuses invalid tokens, disabled requests and too many open requests", async () => {
    const { db, ctx, biz, customer } = await setup();
    expect(await createServiceRequestForToken(ctx as any, TOKEN, { message: "Hello there" }, NOW)).toMatchObject({ ok: false });
    await createOrRotatePortalLinkForCustomer(ctx as any, TECH, customer as any, { now: NOW, token: TOKEN });
    for (let i = 0; i < PORTAL_MAX_OPEN_REQUESTS; i++) {
      await db.insert("workOrders", { customer_id: customer, created_by: TECH, title: `r${i}`, status: "requested", scheduled_date: "2026-03-12", is_recurring: false, created_at: NOW, updated_at: NOW });
    }
    expect(await createServiceRequestForToken(ctx as any, TOKEN, { message: "One more please" }, NOW)).toMatchObject({ ok: false, error: expect.stringMatching(/open requests/) });
    const business = await db.get(biz);
    await db.patch(biz, { settings: { ...business!.settings, customer_portal: { enabled: true, allow_service_requests: false } } });
    expect(await createServiceRequestForToken(ctx as any, TOKEN, { message: "Another request" }, NOW)).toMatchObject({ ok: false, error: expect.stringMatching(/not available/) });
  });
});
