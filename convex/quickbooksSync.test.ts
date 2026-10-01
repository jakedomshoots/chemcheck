import { afterEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { FakeDb, makeCtx, seedBusiness, seedCustomer } from "./fakeConvexDb.testing";
import {
  QboError,
  backoffDelayMs,
  buildQboCustomer,
  buildQboInvoice,
  buildQboPayment,
  contentHash,
  invoiceDocNumber,
  qboDisplayName,
  qboRequest,
  scheduleQuickBooksSync,
  syncCustomerEntity,
  syncInvoiceEntity,
  syncPaymentEntity,
  type QboClient,
} from "./quickbooksSync";

const BUSINESS = "businesses:1" as any;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function client(overrides: Partial<QboClient> = {}): QboClient {
  return {
    realmId: "123",
    apiBase: "https://sandbox-quickbooks.api.intuit.com",
    accessToken: "old",
    refresh: vi.fn().mockResolvedValue("fresh"),
    sleep: vi.fn().mockResolvedValue(undefined),
    maxAttempts: 3,
    ...overrides,
  };
}

/** In-memory stand-in for ctx.runQuery/runMutation keyed by function name. */
function stubCtx() {
  const links = new Map<string, any>();
  const log: any[] = [];
  const connectionState: any[] = [];
  const key = (a: any) => `${a.entity_type}:${a.local_id}`;
  const ctx = {
    runQuery: vi.fn(async (ref: any, args: any) => {
      const name = getFunctionName(ref);
      if (name === "quickbooksSync:getLink") return links.get(key(args)) ?? null;
      throw new Error(`unexpected query ${name}`);
    }),
    runMutation: vi.fn(async (ref: any, args: any) => {
      const name = getFunctionName(ref);
      if (name === "quickbooksSync:upsertLink") {
        links.set(key(args), { ...args, synced_at: 1 });
        return "link";
      }
      if (name === "quickbooksSync:logSync") {
        log.push(args);
        return undefined;
      }
      if (name === "quickbooks:recordConnectionState") {
        connectionState.push(args);
        return undefined;
      }
      throw new Error(`unexpected mutation ${name}`);
    }),
  };
  return { ctx, links, log, connectionState };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("qboRequest retries", () => {
  it("refreshes the token once on 401 and retries", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ Fault: { Error: [{ Message: "Unauthorized" }] } }, 401))
      .mockResolvedValueOnce(json({ Customer: { Id: "9" } }));
    vi.stubGlobal("fetch", fetchMock);
    const c = client();
    const data = await qboRequest(c, "GET", "customer/9");
    expect(data.Customer.Id).toBe("9");
    expect(c.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer fresh");
    expect(fetchMock.mock.calls[0][0]).toBe("https://sandbox-quickbooks.api.intuit.com/v3/company/123/customer/9?minorversion=73");
  });

  it("backs off on 429 honouring Retry-After and gives up after maxAttempts on 5xx", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({}, 429, { "Retry-After": "2" }))
      .mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const c = client();
    await expect(qboRequest(c, "GET", "query?query=x")).resolves.toEqual({ ok: true });
    expect(c.sleep).toHaveBeenCalledWith(2000);
    expect(fetchMock.mock.calls[0][0]).toContain("query?query=x&minorversion=73");

    const failing = vi.fn().mockResolvedValue(json({}, 503));
    vi.stubGlobal("fetch", failing);
    const c2 = client();
    await expect(qboRequest(c2, "POST", "invoice", {})).rejects.toThrow(/busy \(HTTP 503\)/);
    expect(failing).toHaveBeenCalledTimes(3);
    expect(c2.sleep).toHaveBeenCalledTimes(2);
  });

  it("surfaces QBO fault details for 4xx errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ Fault: { Error: [{ Message: "Duplicate Name Exists Error", Detail: "The name supplied already exists.", code: "6240" }] } }, 400)));
    const error = await qboRequest(client(), "POST", "customer", {}).catch((e) => e);
    expect(error).toBeInstanceOf(QboError);
    expect(error.message).toContain("6240");
    expect(error.message).toContain("Duplicate Name Exists Error");
    expect(error.code).toBe("6240");
  });

  it("computes exponential backoff", () => {
    expect(backoffDelayMs(1)).toBe(500);
    expect(backoffDelayMs(3)).toBe(2000);
    expect(backoffDelayMs(10)).toBe(8000);
    expect(backoffDelayMs(1, "45")).toBe(30000);
    expect(backoffDelayMs(1, "nope")).toBe(500);
  });
});

describe("payload builders", () => {
  const invoice: any = {
    _id: "invoices:abcdefghijklmnop",
    line_items: [{ description: "Weekly service", quantity: 2, unit_price: 50, amount: 100 }],
    subtotal: 100,
    tax: 8.25,
    deposit_applied: 20,
    total: 88.25,
    due_date: "2026-04-01",
    notes: "Thanks!",
    status: "sent",
    created_at: Date.UTC(2026, 2, 1),
    updated_at: Date.UTC(2026, 2, 1),
  };

  it("builds customers, invoices (with tax and deposit lines) and payments", () => {
    expect(buildQboCustomer({ full_name: "Alice: Johnson", email: "a@b.co", phone: "+1555", address: "1 Main" })).toEqual({
      DisplayName: "Alice Johnson",
      PrimaryEmailAddr: { Address: "a@b.co" },
      PrimaryPhone: { FreeFormNumber: "+1555" },
      BillAddr: { Line1: "1 Main" },
    });
    expect(qboDisplayName("x".repeat(120), "2")).toHaveLength(100);

    const payload: any = buildQboInvoice(invoice, "77", "5");
    expect(payload.CustomerRef).toEqual({ value: "77" });
    expect(payload.DocNumber).toBe("CC-ghijklmnop");
    expect(payload.TxnDate).toBe("2026-03-01");
    expect(payload.DueDate).toBe("2026-04-01");
    expect(payload.PrivateNote).toBe("Thanks!");
    expect(payload.TxnTaxDetail).toEqual({ TotalTax: 8.25 });
    expect(payload.Line).toHaveLength(2);
    expect(payload.Line[0]).toMatchObject({ DetailType: "SalesItemLineDetail", Amount: 100, SalesItemLineDetail: { ItemRef: { value: "5" }, Qty: 2, UnitPrice: 50, TaxCodeRef: { value: "TAX" } } });
    expect(payload.Line[1]).toMatchObject({ DetailType: "DiscountLineDetail", Amount: 20 });

    const untaxed: any = buildQboInvoice({ ...invoice, tax: 0, deposit_applied: undefined }, "77", "5");
    expect(untaxed.TxnTaxDetail).toBeUndefined();
    expect(untaxed.Line).toHaveLength(1);
    expect(untaxed.Line[0].SalesItemLineDetail.TaxCodeRef.value).toBe("NON");

    const payment: any = buildQboPayment({ ...invoice, status: "paid", paid_at: Date.UTC(2026, 2, 5) }, "77", "900");
    expect(payment).toEqual({
      CustomerRef: { value: "77" },
      TotalAmt: 88.25,
      TxnDate: "2026-03-05",
      PrivateNote: "ChemCheck invoice CC-ghijklmnop",
      Line: [{ Amount: 88.25, LinkedTxn: [{ TxnId: "900", TxnType: "Invoice" }] }],
    });
    expect(invoiceDocNumber("short")).toBe("CC-short");
    expect(contentHash({ a: 1 })).toBe(contentHash({ a: 1 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });
});

describe("entity sync (idempotent)", () => {
  const customer: any = { _id: "customers:1", full_name: "Alice", email: "a@b.co" };

  it("creates a customer once, skips unchanged pushes, and sparse-updates on change", async () => {
    const { ctx, links } = stubCtx();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ QueryResponse: {} }))                               // lookup by name
      .mockResolvedValueOnce(json({ Customer: { Id: "42", SyncToken: "0" } }))          // create
      .mockResolvedValueOnce(json({ Customer: { Id: "42", SyncToken: "3" } }))          // read for SyncToken
      .mockResolvedValueOnce(json({ Customer: { Id: "42", SyncToken: "4" } }));         // update
    vi.stubGlobal("fetch", fetchMock);

    expect(await syncCustomerEntity(ctx, client(), BUSINESS, customer)).toMatchObject({ action: "create", qbo_id: "42" });
    expect(links.get("customer:customers:1")).toMatchObject({ qbo_id: "42", sync_token: "0" });

    expect(await syncCustomerEntity(ctx, client(), BUSINESS, customer)).toMatchObject({ action: "skip", qbo_id: "42" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    expect(await syncCustomerEntity(ctx, client(), BUSINESS, { ...customer, phone: "+1555" })).toMatchObject({ action: "update", qbo_id: "42" });
    const updateBody = JSON.parse(fetchMock.mock.calls[3][1].body);
    expect(updateBody).toMatchObject({ Id: "42", SyncToken: "3", sparse: true, PrimaryPhone: { FreeFormNumber: "+1555" } });
    expect(links.get("customer:customers:1").sync_token).toBe("4");
  });

  it("reuses an existing QBO customer with the same display name", async () => {
    const { ctx, links } = stubCtx();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ QueryResponse: { Customer: [{ Id: "7", SyncToken: "1" }] } })));
    expect(await syncCustomerEntity(ctx, client(), BUSINESS, customer)).toMatchObject({ action: "create", qbo_id: "7" });
    expect(links.get("customer:customers:1").qbo_id).toBe("7");
  });

  it("creates, skips and voids invoices; records payments once", async () => {
    const { ctx, links } = stubCtx();
    const invoice: any = { _id: "invoices:1", line_items: [{ description: "x", quantity: 1, unit_price: 10, amount: 10 }], subtotal: 10, tax: 0, total: 10, status: "paid", paid_at: 1, created_at: 1, updated_at: 1 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ Invoice: { Id: "500", SyncToken: "0" } }))   // create invoice
      .mockResolvedValueOnce(json({ Payment: { Id: "600", SyncToken: "0" } }))   // create payment
      .mockResolvedValueOnce(json({ Invoice: { Id: "500", SyncToken: "2" } }))   // read before void
      .mockResolvedValueOnce(json({ Invoice: { Id: "500" } }));                  // void
    vi.stubGlobal("fetch", fetchMock);

    expect(await syncInvoiceEntity(ctx, client(), BUSINESS, invoice, "42", "5")).toMatchObject({ action: "create", qbo_id: "500" });
    expect(await syncInvoiceEntity(ctx, client(), BUSINESS, invoice, "42", "5")).toMatchObject({ action: "skip" });
    expect(await syncPaymentEntity(ctx, client(), BUSINESS, invoice, "42", "500")).toMatchObject({ action: "payment", qbo_id: "600" });
    expect(await syncPaymentEntity(ctx, client(), BUSINESS, invoice, "42", "500")).toMatchObject({ action: "skip", message: "already recorded" });
    expect(await syncPaymentEntity(ctx, client(), BUSINESS, { ...invoice, status: "sent" }, "42", "500")).toMatchObject({ action: "skip", message: "invoice not paid" });

    expect(await syncInvoiceEntity(ctx, client(), BUSINESS, { ...invoice, status: "cancelled" }, "42", "5")).toMatchObject({ action: "void", qbo_id: "500" });
    expect(fetchMock.mock.calls[3][0]).toContain("invoice?operation=void&minorversion=73");
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ Id: "500", SyncToken: "2" });
    expect(links.get("invoice:invoices:1").content_hash).toBe("void");
    expect(await syncInvoiceEntity(ctx, client(), BUSINESS, { ...invoice, status: "cancelled" }, "42", "5")).toMatchObject({ action: "skip", message: "already voided" });

    const { ctx: fresh } = stubCtx();
    expect(await syncInvoiceEntity(fresh, client(), BUSINESS, { ...invoice, _id: "invoices:2", status: "cancelled" }, "42", "5")).toMatchObject({ action: "skip", message: "cancelled before sync" });
  });
});

describe("scheduleQuickBooksSync", () => {
  it("schedules only when the customer's business has a connection and auto-sync is on", async () => {
    const db = new FakeDb();
    const base = makeCtx(db);
    const scheduler = { runAfter: vi.fn().mockResolvedValue("job") };
    const ctx: any = { ...base, scheduler };
    const biz = await seedBusiness(db, "owner@example.com");
    const customer = await seedCustomer(db, "owner@example.com");
    const invoiceId = await db.insert("invoices", { customer_id: customer, created_by: "owner@example.com", status: "draft", line_items: [], subtotal: 0, tax: 0, total: 0, created_at: 1, updated_at: 1 });

    expect(await scheduleQuickBooksSync(ctx, invoiceId as any, customer as any, "created")).toBe(false);
    expect(scheduler.runAfter).not.toHaveBeenCalled();

    await db.insert("quickbooksConnections", { business_id: biz, realm_id: "r", access_token: "plain:a", refresh_token: "plain:r", access_expires_at: 1, refresh_expires_at: 1, connected_by: "owner@example.com", connected_at: 1 });
    expect(await scheduleQuickBooksSync(ctx, invoiceId as any, customer as any, "created")).toBe(true);
    expect(scheduler.runAfter).toHaveBeenCalledTimes(1);
    const [delay, ref, args] = scheduler.runAfter.mock.calls[0];
    expect(delay).toBe(0);
    expect(getFunctionName(ref)).toBe("quickbooksSync:syncInvoice");
    expect(args).toEqual({ business_id: biz, invoice_id: invoiceId, reason: "created" });

    const business = await db.get(biz);
    await db.patch(biz, { settings: { ...business!.settings, quickbooks_auto_sync: false } });
    expect(await scheduleQuickBooksSync(ctx, invoiceId as any, customer as any, "paid")).toBe(false);
    expect(scheduler.runAfter).toHaveBeenCalledTimes(1);

    expect(await scheduleQuickBooksSync(ctx, invoiceId as any, "customers:missing" as any, "paid")).toBe(false);
  });
});
