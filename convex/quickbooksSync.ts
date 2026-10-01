/**
 * QuickBooks Online sync: customers, invoices and payments.
 *
 * Every push is idempotent through quickbooksLinks (local id -> QBO id, with
 * a content hash so unchanged records are skipped). Requests retry with
 * backoff on 429/5xx and refresh the access token once on 401. Each entity
 * operation is recorded in quickbooksSyncLog.
 *
 * Triggers: invoices.ts schedules `syncInvoice` when an invoice is created,
 * sent, cancelled or paid, but only when the business has a connection and
 * auto-sync is not disabled. Owners can also run `syncNow`.
 */
/// <reference types="node" />
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { fetchProvider } from "./providerConfig";
import { resolveBusinessForEmail } from "./entitlements";
import { NOT_DELETED_FILTER } from "./sync";
import {
  findConnectionForBusiness,
  openSecret,
  qboApiBase,
  readQboConfig,
  refreshConnectionTokens,
  type QboConfig,
  type QboEnvironment,
} from "./quickbooks";

type DbCtx = Pick<MutationCtx | QueryCtx, "db">;

export const QBO_MINOR_VERSION = "73";
export const DEFAULT_MAX_ATTEMPTS = 4;
export const SYNC_BATCH_CUSTOMERS = 100;
export const SYNC_BATCH_INVOICES = 100;
export const SYNC_LOG_LIMIT = 30;

export type EntityType = "customer" | "invoice" | "payment";

export class QboError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "QboError";
    this.status = status;
    this.code = code;
  }
}

export interface QboClient {
  realmId: string;
  apiBase: string;
  accessToken: string;
  /** Refresh and return a new access token (called once per request on 401). */
  refresh: () => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}

/** Minimal ctx surface used by the entity sync functions so tests can stub it. */
export interface SyncCtx {
  runQuery: (ref: any, args: any) => Promise<any>;
  runMutation: (ref: any, args: any) => Promise<any>;
}

// ============================================
// HTTP client with retry/backoff
// ============================================

export function backoffDelayMs(attempt: number, retryAfter?: string | null): number {
  const header = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 30_000);
  return Math.min(500 * 2 ** Math.max(0, attempt - 1), 8_000);
}

export function qboErrorMessage(data: any, status: number): { message: string; code?: string } {
  const fault = data?.Fault?.Error?.[0] ?? data?.fault?.error?.[0];
  if (fault) {
    const detail = fault.Detail ? ` ${String(fault.Detail).slice(0, 200)}` : "";
    return { message: `QuickBooks error ${fault.code ?? status}: ${fault.Message ?? "request failed"}.${detail}`, code: fault.code ? String(fault.code) : undefined };
  }
  return { message: `QuickBooks request failed (HTTP ${status}).` };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function qboRequest<T = any>(
  client: QboClient,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const sleep = client.sleep ?? defaultSleep;
  const maxAttempts = client.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const separator = path.includes("?") ? "&" : "?";
  const url = `${client.apiBase}/v3/company/${encodeURIComponent(client.realmId)}/${path}${separator}minorversion=${QBO_MINOR_VERSION}`;
  let refreshed = false;
  let lastError: Error = new QboError("QuickBooks request failed.", 0);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetchProvider(url, {
      method,
      headers: {
        Authorization: `Bearer ${client.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (response.status === 401 && !refreshed) {
      refreshed = true;
      client.accessToken = await client.refresh();
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      lastError = new QboError(`QuickBooks is busy (HTTP ${response.status}).`, response.status);
      if (attempt < maxAttempts) {
        await sleep(backoffDelayMs(attempt, response.headers.get("Retry-After")));
        continue;
      }
      throw lastError;
    }

    let data: any = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const { message, code } = qboErrorMessage(data, response.status);
      throw new QboError(message, response.status, code);
    }
    return data as T;
  }
  throw lastError;
}

export function escapeQboString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function qboQuery(client: QboClient, sql: string): Promise<any> {
  const data = await qboRequest(client, "GET", `query?query=${encodeURIComponent(sql)}`);
  return data?.QueryResponse ?? {};
}

// ============================================
// Payload builders (pure)
// ============================================

export function contentHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(16);
}

export function isoDate(ms: number | undefined): string {
  const date = ms ? new Date(ms) : new Date();
  return date.toISOString().slice(0, 10);
}

/** QBO forbids ':' in names and caps DisplayName at 100 characters. */
export function qboDisplayName(fullName: string, suffix?: string): string {
  const base = String(fullName ?? "").replace(/:/g, " ").replace(/\s+/g, " ").trim() || "Customer";
  const tail = suffix ? ` (${suffix})` : "";
  return base.slice(0, 100 - tail.length) + tail;
}

export function buildQboCustomer(customer: Pick<Doc<"customers">, "full_name" | "email" | "phone" | "address">): Record<string, unknown> {
  const payload: Record<string, unknown> = { DisplayName: qboDisplayName(customer.full_name) };
  if (customer.email) payload.PrimaryEmailAddr = { Address: customer.email };
  if (customer.phone) payload.PrimaryPhone = { FreeFormNumber: customer.phone };
  if (customer.address) payload.BillAddr = { Line1: customer.address.slice(0, 500) };
  return payload;
}

export function invoiceDocNumber(invoiceId: string): string {
  return `CC-${String(invoiceId).slice(-10)}`.slice(0, 21);
}

export function buildQboInvoice(
  invoice: Doc<"invoices">,
  customerQboId: string,
  itemId: string,
): Record<string, unknown> {
  const taxable = invoice.tax > 0;
  const lines: Record<string, unknown>[] = invoice.line_items.map((item) => ({
    DetailType: "SalesItemLineDetail",
    Amount: Number(item.amount.toFixed(2)),
    Description: String(item.description ?? "").slice(0, 4000),
    SalesItemLineDetail: {
      ItemRef: { value: itemId },
      Qty: item.quantity,
      UnitPrice: item.unit_price,
      TaxCodeRef: { value: taxable ? "TAX" : "NON" },
    },
  }));
  if (invoice.deposit_applied && invoice.deposit_applied > 0) {
    lines.push({
      DetailType: "DiscountLineDetail",
      Amount: Number(invoice.deposit_applied.toFixed(2)),
      Description: "Deposit applied",
      DiscountLineDetail: { PercentBased: false },
    });
  }
  const payload: Record<string, unknown> = {
    CustomerRef: { value: customerQboId },
    DocNumber: invoiceDocNumber(String(invoice._id)),
    TxnDate: isoDate(invoice.created_at),
    Line: lines,
  };
  if (invoice.due_date) payload.DueDate = invoice.due_date;
  if (invoice.notes) payload.PrivateNote = invoice.notes.slice(0, 4000);
  if (taxable) payload.TxnTaxDetail = { TotalTax: Number(invoice.tax.toFixed(2)) };
  return payload;
}

export function buildQboPayment(invoice: Doc<"invoices">, customerQboId: string, invoiceQboId: string): Record<string, unknown> {
  const amount = Number(invoice.total.toFixed(2));
  return {
    CustomerRef: { value: customerQboId },
    TotalAmt: amount,
    TxnDate: isoDate(invoice.paid_at ?? invoice.updated_at),
    PrivateNote: `ChemCheck invoice ${invoiceDocNumber(String(invoice._id))}`,
    Line: [{ Amount: amount, LinkedTxn: [{ TxnId: invoiceQboId, TxnType: "Invoice" }] }],
  };
}

// ============================================
// Links + log (internal data access)
// ============================================

export async function findLink(ctx: DbCtx, businessId: Id<"businesses">, entity: EntityType, localId: string): Promise<Doc<"quickbooksLinks"> | null> {
  return await ctx.db
    .query("quickbooksLinks")
    .withIndex("by_local", (q) => q.eq("business_id", businessId).eq("entity_type", entity).eq("local_id", localId))
    .first();
}

export const getLink = internalQuery({
  args: { business_id: v.id("businesses"), entity_type: v.string(), local_id: v.string() },
  handler: async (ctx, args) => await findLink(ctx, args.business_id, args.entity_type as EntityType, args.local_id),
});

export const upsertLink = internalMutation({
  args: {
    business_id: v.id("businesses"),
    entity_type: v.string(),
    local_id: v.string(),
    qbo_id: v.string(),
    sync_token: v.optional(v.string()),
    content_hash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await findLink(ctx, args.business_id, args.entity_type as EntityType, args.local_id);
    const fields = { qbo_id: args.qbo_id, sync_token: args.sync_token, content_hash: args.content_hash, synced_at: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("quickbooksLinks", {
      business_id: args.business_id,
      entity_type: args.entity_type,
      local_id: args.local_id,
      ...fields,
    });
  },
});

export const logSync = internalMutation({
  args: {
    business_id: v.id("businesses"),
    entity_type: v.string(),
    local_id: v.string(),
    qbo_id: v.optional(v.string()),
    action: v.string(),
    status: v.string(),
    message: v.optional(v.string()),
    attempts: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("quickbooksSyncLog", {
      business_id: args.business_id,
      entity_type: args.entity_type,
      local_id: args.local_id,
      qbo_id: args.qbo_id,
      action: args.action,
      status: args.status,
      message: args.message?.slice(0, 500),
      attempts: args.attempts ?? 1,
      created_at: Date.now(),
    });
  },
});

/** Business that owns a customer: explicit business_id first, then the creator's business. */
export async function businessForCustomer(ctx: DbCtx, customer: Doc<"customers">): Promise<Doc<"businesses"> | null> {
  if (customer.business_id) {
    try {
      const business = await ctx.db.get(customer.business_id as Id<"businesses">);
      if (business) return business;
    } catch {
      // Legacy rows may hold a non-id string; fall through to the creator lookup.
    }
  }
  return await resolveBusinessForEmail(ctx, customer.created_by);
}

export const getInvoiceForSync = internalQuery({
  args: { invoice_id: v.id("invoices") },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoice_id);
    if (!invoice) return null;
    const customer = await ctx.db.get(invoice.customer_id);
    if (!customer) return null;
    const business = await businessForCustomer(ctx, customer);
    if (!business) return null;
    return { invoice, customer, business_id: business._id };
  },
});

export const listCustomersForSync = internalQuery({
  args: { business_id: v.id("businesses"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? SYNC_BATCH_CUSTOMERS, 1), 500);
    const business = await ctx.db.get(args.business_id);
    if (!business) return [];
    let customers = await ctx.db
      .query("customers")
      .withIndex("by_business", (q) => q.eq("business_id", String(args.business_id)))
      .filter(NOT_DELETED_FILTER)
      .take(limit);
    if (customers.length === 0) {
      customers = await ctx.db
        .query("customers")
        .withIndex("by_created_by", (q) => q.eq("created_by", business.owner_email))
        .filter(NOT_DELETED_FILTER)
        .take(limit);
    }
    return customers;
  },
});

export const listInvoicesForSync = internalQuery({
  args: { business_id: v.id("businesses"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? SYNC_BATCH_INVOICES, 1), 500);
    const customers: Doc<"customers">[] = await listCustomersForSyncHelper(ctx, args.business_id, limit);
    const invoices: Doc<"invoices">[] = [];
    for (const customer of customers) {
      if (invoices.length >= limit) break;
      const rows = await ctx.db
        .query("invoices")
        .withIndex("by_customer", (q) => q.eq("customer_id", customer._id))
        .take(20);
      for (const row of rows) {
        if (row.status === "cancelled" && !(await findLink(ctx, args.business_id, "invoice", String(row._id)))) continue;
        invoices.push(row);
        if (invoices.length >= limit) break;
      }
    }
    return invoices;
  },
});

async function listCustomersForSyncHelper(ctx: DbCtx, businessId: Id<"businesses">, limit: number): Promise<Doc<"customers">[]> {
  const business = await ctx.db.get(businessId);
  if (!business) return [];
  const byBusiness = await ctx.db
    .query("customers")
    .withIndex("by_business", (q) => q.eq("business_id", String(businessId)))
    .filter(NOT_DELETED_FILTER)
    .take(limit);
  if (byBusiness.length > 0) return byBusiness;
  return await ctx.db
    .query("customers")
    .withIndex("by_created_by", (q) => q.eq("created_by", business.owner_email))
    .filter(NOT_DELETED_FILTER)
    .take(limit);
}

export const listSyncLog = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    const business = await resolveBusinessForEmail(ctx, identity.email);
    if (!business) return [];
    const rows = await ctx.db
      .query("quickbooksSyncLog")
      .withIndex("by_business", (q) => q.eq("business_id", business._id))
      .order("desc")
      .take(Math.min(Math.max(args.limit ?? SYNC_LOG_LIMIT, 1), 100));
    return rows.sort((a, b) => b.created_at - a.created_at);
  },
});

// ============================================
// Entity sync
// ============================================

export interface EntityResult {
  entity: EntityType;
  local_id: string;
  qbo_id?: string;
  action: "create" | "update" | "skip" | "void" | "payment";
  message?: string;
}

async function record(ctx: SyncCtx, businessId: Id<"businesses">, result: EntityResult, status: "success" | "error" | "skipped"): Promise<void> {
  await ctx.runMutation(internal.quickbooksSync.logSync, {
    business_id: businessId,
    entity_type: result.entity,
    local_id: result.local_id,
    qbo_id: result.qbo_id,
    action: result.action,
    status,
    message: result.message,
  });
}

/** Service Item used for every invoice line. Found or created once per connection. */
export async function ensureDefaultItem(ctx: SyncCtx, client: QboClient, connection: Doc<"quickbooksConnections">): Promise<string> {
  if (connection.default_item_id) return connection.default_item_id;
  const found = await qboQuery(client, "SELECT Id, Name FROM Item WHERE Type = 'Service' AND Active = true MAXRESULTS 10");
  const items: Array<{ Id: string; Name: string }> = found.Item ?? [];
  let itemId = (items.find((i) => /pool service|services/i.test(i.Name)) ?? items[0])?.Id;
  if (!itemId) {
    const accounts = await qboQuery(client, "SELECT Id FROM Account WHERE AccountType = 'Income' MAXRESULTS 1");
    const account = accounts.Account?.[0];
    if (!account?.Id) throw new QboError("QuickBooks company has no income account to attach services to.", 400);
    const created = await qboRequest(client, "POST", "item", {
      Name: "Pool Service",
      Type: "Service",
      IncomeAccountRef: { value: account.Id },
    });
    itemId = created?.Item?.Id;
    if (!itemId) throw new QboError("QuickBooks did not return the created service item.", 500);
  }
  await ctx.runMutation(internal.quickbooks.recordConnectionState, { connection_id: connection._id, default_item_id: itemId });
  return itemId!;
}

export async function syncCustomerEntity(
  ctx: SyncCtx,
  client: QboClient,
  businessId: Id<"businesses">,
  customer: Doc<"customers">,
): Promise<EntityResult> {
  const localId = String(customer._id);
  const payload = buildQboCustomer(customer);
  const hash = contentHash(payload);
  const link: Doc<"quickbooksLinks"> | null = await ctx.runQuery(internal.quickbooksSync.getLink, { business_id: businessId, entity_type: "customer", local_id: localId });

  if (link) {
    if (link.content_hash === hash) {
      return { entity: "customer", local_id: localId, qbo_id: link.qbo_id, action: "skip", message: "unchanged" };
    }
    const current = await qboRequest(client, "GET", `customer/${encodeURIComponent(link.qbo_id)}`);
    const updated = await qboRequest(client, "POST", "customer", {
      ...payload,
      Id: link.qbo_id,
      SyncToken: current?.Customer?.SyncToken ?? "0",
      sparse: true,
    });
    await ctx.runMutation(internal.quickbooksSync.upsertLink, {
      business_id: businessId, entity_type: "customer", local_id: localId,
      qbo_id: link.qbo_id, sync_token: updated?.Customer?.SyncToken, content_hash: hash,
    });
    return { entity: "customer", local_id: localId, qbo_id: link.qbo_id, action: "update" };
  }

  // Reuse an existing QBO customer with the same display name before creating one.
  const existing = await qboQuery(client, `SELECT Id, SyncToken FROM Customer WHERE DisplayName = '${escapeQboString(String(payload.DisplayName))}' MAXRESULTS 1`);
  let qboId: string | undefined = existing.Customer?.[0]?.Id;
  let syncToken: string | undefined = existing.Customer?.[0]?.SyncToken;
  if (!qboId) {
    const created = await qboRequest(client, "POST", "customer", payload);
    qboId = created?.Customer?.Id;
    syncToken = created?.Customer?.SyncToken;
    if (!qboId) throw new QboError("QuickBooks did not return the created customer.", 500);
  }
  await ctx.runMutation(internal.quickbooksSync.upsertLink, {
    business_id: businessId, entity_type: "customer", local_id: localId, qbo_id: qboId, sync_token: syncToken, content_hash: hash,
  });
  return { entity: "customer", local_id: localId, qbo_id: qboId, action: "create" };
}

export async function syncInvoiceEntity(
  ctx: SyncCtx,
  client: QboClient,
  businessId: Id<"businesses">,
  invoice: Doc<"invoices">,
  customerQboId: string,
  itemId: string,
): Promise<EntityResult> {
  const localId = String(invoice._id);
  const link: Doc<"quickbooksLinks"> | null = await ctx.runQuery(internal.quickbooksSync.getLink, { business_id: businessId, entity_type: "invoice", local_id: localId });

  if (invoice.status === "cancelled") {
    if (!link || link.content_hash === "void") {
      return { entity: "invoice", local_id: localId, qbo_id: link?.qbo_id, action: "skip", message: link ? "already voided" : "cancelled before sync" };
    }
    const current = await qboRequest(client, "GET", `invoice/${encodeURIComponent(link.qbo_id)}`);
    await qboRequest(client, "POST", "invoice?operation=void", { Id: link.qbo_id, SyncToken: current?.Invoice?.SyncToken ?? "0" });
    await ctx.runMutation(internal.quickbooksSync.upsertLink, {
      business_id: businessId, entity_type: "invoice", local_id: localId, qbo_id: link.qbo_id, content_hash: "void",
    });
    return { entity: "invoice", local_id: localId, qbo_id: link.qbo_id, action: "void" };
  }

  const payload = buildQboInvoice(invoice, customerQboId, itemId);
  const hash = contentHash(payload);
  if (link) {
    if (link.content_hash === hash) {
      return { entity: "invoice", local_id: localId, qbo_id: link.qbo_id, action: "skip", message: "unchanged" };
    }
    const current = await qboRequest(client, "GET", `invoice/${encodeURIComponent(link.qbo_id)}`);
    const updated = await qboRequest(client, "POST", "invoice", {
      ...payload,
      Id: link.qbo_id,
      SyncToken: current?.Invoice?.SyncToken ?? "0",
      sparse: true,
    });
    await ctx.runMutation(internal.quickbooksSync.upsertLink, {
      business_id: businessId, entity_type: "invoice", local_id: localId,
      qbo_id: link.qbo_id, sync_token: updated?.Invoice?.SyncToken, content_hash: hash,
    });
    return { entity: "invoice", local_id: localId, qbo_id: link.qbo_id, action: "update" };
  }

  const created = await qboRequest(client, "POST", "invoice", payload);
  const qboId: string | undefined = created?.Invoice?.Id;
  if (!qboId) throw new QboError("QuickBooks did not return the created invoice.", 500);
  await ctx.runMutation(internal.quickbooksSync.upsertLink, {
    business_id: businessId, entity_type: "invoice", local_id: localId,
    qbo_id: qboId, sync_token: created?.Invoice?.SyncToken, content_hash: hash,
  });
  return { entity: "invoice", local_id: localId, qbo_id: qboId, action: "create" };
}

export async function syncPaymentEntity(
  ctx: SyncCtx,
  client: QboClient,
  businessId: Id<"businesses">,
  invoice: Doc<"invoices">,
  customerQboId: string,
  invoiceQboId: string,
): Promise<EntityResult> {
  const localId = String(invoice._id);
  if (invoice.status !== "paid" || invoice.total <= 0) {
    return { entity: "payment", local_id: localId, action: "skip", message: "invoice not paid" };
  }
  const link: Doc<"quickbooksLinks"> | null = await ctx.runQuery(internal.quickbooksSync.getLink, { business_id: businessId, entity_type: "payment", local_id: localId });
  if (link) return { entity: "payment", local_id: localId, qbo_id: link.qbo_id, action: "skip", message: "already recorded" };

  const created = await qboRequest(client, "POST", "payment", buildQboPayment(invoice, customerQboId, invoiceQboId));
  const qboId: string | undefined = created?.Payment?.Id;
  if (!qboId) throw new QboError("QuickBooks did not return the created payment.", 500);
  await ctx.runMutation(internal.quickbooksSync.upsertLink, {
    business_id: businessId, entity_type: "payment", local_id: localId, qbo_id: qboId, sync_token: created?.Payment?.SyncToken,
  });
  return { entity: "payment", local_id: localId, qbo_id: qboId, action: "payment" };
}

/** Customer -> invoice -> payment for one invoice, logging each step. Throws on the first failure. */
export async function syncInvoiceBundle(
  ctx: SyncCtx,
  client: QboClient,
  connection: Doc<"quickbooksConnections">,
  invoice: Doc<"invoices">,
  customer: Doc<"customers">,
): Promise<EntityResult[]> {
  const businessId = connection.business_id;
  const results: EntityResult[] = [];
  const step = async (run: () => Promise<EntityResult>, entity: EntityType, localId: string) => {
    try {
      const result = await run();
      results.push(result);
      await record(ctx, businessId, result, result.action === "skip" ? "skipped" : "success");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed";
      await record(ctx, businessId, { entity, local_id: localId, action: "create", message }, "error");
      throw error;
    }
  };

  const customerResult = await step(() => syncCustomerEntity(ctx, client, businessId, customer), "customer", String(customer._id));
  const itemId = await ensureDefaultItem(ctx, client, connection);
  const invoiceResult = await step(() => syncInvoiceEntity(ctx, client, businessId, invoice, customerResult.qbo_id!, itemId), "invoice", String(invoice._id));
  if (invoiceResult.qbo_id && invoiceResult.action !== "void") {
    await step(() => syncPaymentEntity(ctx, client, businessId, invoice, customerResult.qbo_id!, invoiceResult.qbo_id!), "payment", String(invoice._id));
  }
  return results;
}

// ============================================
// Client construction + scheduling
// ============================================

export async function openClient(ctx: SyncCtx, config: QboConfig, connection: Doc<"quickbooksConnections">): Promise<QboClient> {
  const environment = (connection.environment as QboEnvironment | undefined) ?? config.environment;
  let accessToken = await openSecret(connection.access_token, config.encryptionKey);
  if (connection.access_expires_at - 60_000 < Date.now()) {
    accessToken = (await refreshConnectionTokens(ctx, config, connection)).access_token;
  }
  return {
    realmId: connection.realm_id,
    apiBase: qboApiBase(environment),
    accessToken,
    refresh: async () => (await refreshConnectionTokens(ctx, config, connection)).access_token,
  };
}

/**
 * Called from invoice mutations. Schedules a sync only when the invoice's
 * business has a QuickBooks connection and auto-sync is on. Never throws:
 * a sync problem must not fail the invoice write.
 */
export async function scheduleQuickBooksSync(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  invoiceId: Id<"invoices">,
  customerId: Id<"customers">,
  reason: string,
): Promise<boolean> {
  try {
    const customer = await ctx.db.get(customerId);
    if (!customer) return false;
    const business = await businessForCustomer(ctx, customer);
    if (!business || business.settings?.quickbooks_auto_sync === false) return false;
    const connection = await findConnectionForBusiness(ctx, business._id);
    if (!connection) return false;
    await ctx.scheduler.runAfter(0, internal.quickbooksSync.syncInvoice, {
      business_id: business._id,
      invoice_id: invoiceId,
      reason,
    });
    return true;
  } catch (error) {
    console.error("[quickbooks] failed to schedule sync", error instanceof Error ? error.message : "unknown error");
    return false;
  }
}

export const syncInvoice = internalAction({
  args: { business_id: v.id("businesses"), invoice_id: v.id("invoices"), reason: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    const { config } = readQboConfig();
    if (!config) return { ok: false, error: "not_configured" };
    const connection: Doc<"quickbooksConnections"> | null = await ctx.runQuery(internal.quickbooks.getConnectionInternal, { business_id: args.business_id });
    if (!connection) return { ok: false, error: "not_connected" };
    const bundle: { invoice: Doc<"invoices">; customer: Doc<"customers">; business_id: Id<"businesses"> } | null =
      await ctx.runQuery(internal.quickbooksSync.getInvoiceForSync, { invoice_id: args.invoice_id });
    if (!bundle || String(bundle.business_id) !== String(args.business_id)) return { ok: false, error: "invoice_not_found" };
    try {
      const client = await openClient(ctx, config, connection);
      await syncInvoiceBundle(ctx, client, connection, bundle.invoice, bundle.customer);
      await ctx.runMutation(internal.quickbooks.recordConnectionState, { connection_id: connection._id, last_sync_at: Date.now(), clear_error: true });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed";
      await ctx.runMutation(internal.quickbooks.recordConnectionState, { connection_id: connection._id, last_error: message });
      return { ok: false, error: message };
    }
  },
});

export const syncNow = action({
  args: {},
  handler: async (ctx): Promise<{ customers: number; invoices: number; payments: number; skipped: number; errors: string[] }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Not authenticated");
    const managed: { business_id: Id<"businesses"> } | null = await ctx.runQuery(internal.quickbooks.canManageQuickBooks, { email: identity.email });
    if (!managed) throw new Error("Only business owners and admins can run a QuickBooks sync.");
    const { config, missing } = readQboConfig();
    if (!config) throw new Error(`QuickBooks is not configured. Missing: ${missing.join(", ")}.`);
    const connection: Doc<"quickbooksConnections"> | null = await ctx.runQuery(internal.quickbooks.getConnectionInternal, { business_id: managed.business_id });
    if (!connection) throw new Error("QuickBooks is not connected.");

    const summary = { customers: 0, invoices: 0, payments: 0, skipped: 0, errors: [] as string[] };
    const client = await openClient(ctx, config, connection);
    const businessId = connection.business_id;
    const customerQboIds = new Map<string, string>();

    const customers: Doc<"customers">[] = await ctx.runQuery(internal.quickbooksSync.listCustomersForSync, { business_id: businessId });
    for (const customer of customers) {
      try {
        const result = await syncCustomerEntity(ctx, client, businessId, customer);
        customerQboIds.set(String(customer._id), result.qbo_id!);
        await record(ctx, businessId, result, result.action === "skip" ? "skipped" : "success");
        if (result.action === "skip") summary.skipped += 1; else summary.customers += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Customer sync failed";
        summary.errors.push(`${customer.full_name}: ${message}`);
        await record(ctx, businessId, { entity: "customer", local_id: String(customer._id), action: "create", message }, "error");
      }
    }

    let itemId: string | null = null;
    try {
      itemId = await ensureDefaultItem(ctx, client, connection);
    } catch (error) {
      summary.errors.push(error instanceof Error ? error.message : "Could not resolve a QuickBooks service item");
    }

    if (itemId) {
      const invoices: Doc<"invoices">[] = await ctx.runQuery(internal.quickbooksSync.listInvoicesForSync, { business_id: businessId });
      for (const invoice of invoices) {
        const customerQboId = customerQboIds.get(String(invoice.customer_id));
        if (!customerQboId) {
          summary.skipped += 1;
          continue;
        }
        try {
          const invoiceResult = await syncInvoiceEntity(ctx, client, businessId, invoice, customerQboId, itemId);
          await record(ctx, businessId, invoiceResult, invoiceResult.action === "skip" ? "skipped" : "success");
          if (invoiceResult.action === "skip") summary.skipped += 1; else summary.invoices += 1;
          if (invoiceResult.qbo_id && invoiceResult.action !== "void") {
            const paymentResult = await syncPaymentEntity(ctx, client, businessId, invoice, customerQboId, invoiceResult.qbo_id);
            await record(ctx, businessId, paymentResult, paymentResult.action === "skip" ? "skipped" : "success");
            if (paymentResult.action === "payment") summary.payments += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Invoice sync failed";
          summary.errors.push(`Invoice ${invoiceDocNumber(String(invoice._id))}: ${message}`);
          await record(ctx, businessId, { entity: "invoice", local_id: String(invoice._id), action: "create", message }, "error");
        }
      }
    }

    await ctx.runMutation(internal.quickbooks.recordConnectionState, {
      connection_id: connection._id,
      last_sync_at: Date.now(),
      last_error: summary.errors.length > 0 ? summary.errors[0] : undefined,
      clear_error: summary.errors.length === 0,
    });
    return summary;
  },
});
