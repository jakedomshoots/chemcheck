/**
 * Square Customers / Orders / Invoices / Cards / Payments calls for work
 * tickets, made with the business's OWN seller OAuth token
 * (squareConnect.requireSellerCredentialsForBusiness refreshes it before use).
 *
 * Idempotency keys are deterministic per ticket + action (+ content hash for
 * objects built from line items), so retries return the same Square object
 * instead of creating a second one.
 */

import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireSellerCredentialsForBusiness, type SellerCredentials } from "./squareConnect";
import { SquareApiError, squareRequest } from "./squareApi";
import { validateEmail, validatePhone } from "./validation";
import { deliverCommunicationNow } from "./communications";
import {
  type DeliveredVia,
  type SquareDeliveryMethod,
  type TicketItemCents,
  canUseAutopay,
  formatUsd,
  invoiceDeliveryPlan,
  invoiceDueDate,
  pickCardOnFile,
  scopesNeedReconnect,
  ticketIdempotencyKey,
} from "./ticketLogic";

export const TICKET_CONNECT_MESSAGE = "Connect your Square account in Settings to send invoices.";
export const TICKET_RECONNECT_MESSAGE = "Reconnect Square in Settings to allow ChemCheck to send invoices.";

/** Seller credentials for tickets, with ticket-specific error messages. */
export async function requireTicketSeller(ctx: ActionCtx, businessId: Id<"businesses">): Promise<SellerCredentials> {
  const account = await ctx.runQuery(internal.squareConnect.getSellerAccountByBusiness, { business_id: businessId });
  if (!account || !account.location_id) throw new Error(TICKET_CONNECT_MESSAGE);
  if (scopesNeedReconnect(account.scopes)) throw new Error(TICKET_RECONNECT_MESSAGE);
  try {
    return await requireSellerCredentialsForBusiness(ctx, businessId);
  } catch {
    throw new Error(TICKET_RECONNECT_MESSAGE);
  }
}

/** Square error -> user-readable message. */
export function readableSquareError(error: unknown, action: string): string {
  if (error instanceof SquareApiError) {
    if (error.status === 401 || error.code === "UNAUTHORIZED" || error.code === "ACCESS_TOKEN_EXPIRED" || error.code === "ACCESS_TOKEN_REVOKED") {
      return TICKET_RECONNECT_MESSAGE;
    }
    if (error.status === 403 || error.code === "INSUFFICIENT_SCOPES") return TICKET_RECONNECT_MESSAGE;
    return `Square could not ${action}: ${error.message}`;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message === TICKET_CONNECT_MESSAGE || message === TICKET_RECONNECT_MESSAGE) return message;
  return `Square could not ${action}: ${message}`;
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export type TicketCustomer = {
  _id: Id<"customers">;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  square_customer_id?: string | null;
  square_merchant_id?: string | null;
};

function safeEmail(value: unknown): string | undefined {
  try {
    return validateEmail(typeof value === "string" ? value : undefined) || undefined;
  } catch {
    return undefined;
  }
}

/** E.164 phone for Square (10-digit numbers are treated as US). */
export function squarePhone(value: unknown): string | undefined {
  let normalized: string | undefined;
  try {
    normalized = validatePhone(typeof value === "string" ? value : undefined);
  } catch {
    return undefined;
  }
  if (!normalized) return undefined;
  const digits = normalized.replace(/\D/g, "");
  if (normalized.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}

export function splitName(fullName: string): { given_name?: string; family_name?: string } {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { given_name: parts[0].slice(0, 300) };
  return { given_name: parts.slice(0, -1).join(" ").slice(0, 300), family_name: parts[parts.length - 1].slice(0, 300) };
}

async function searchCustomer(seller: SellerCredentials, filter: Record<string, unknown>): Promise<string | null> {
  const data = await squareRequest("/v2/customers/search", {
    method: "POST",
    token: seller.accessToken,
    body: { limit: 1, query: { filter } },
  });
  const found = Array.isArray(data?.customers) ? data.customers[0] : undefined;
  return typeof found?.id === "string" ? found.id : null;
}

/** Existing Square customer by email then phone, without creating one. */
export async function findSquareCustomer(seller: SellerCredentials, customer: TicketCustomer): Promise<string | null> {
  if (customer.square_customer_id && customer.square_merchant_id === seller.merchantId) return customer.square_customer_id;
  const email = safeEmail(customer.email);
  if (email) {
    const id = await searchCustomer(seller, { email_address: { exact: email } });
    if (id) return id;
  }
  const phone = squarePhone(customer.phone);
  if (phone) {
    const id = await searchCustomer(seller, { phone_number: { exact: phone } });
    if (id) return id;
  }
  return null;
}

/** Linked Square customer: stored link (same merchant), else search email/phone, else create. Persists the link. */
export async function ensureSquareCustomer(
  ctx: ActionCtx,
  seller: SellerCredentials,
  customer: TicketCustomer,
): Promise<string> {
  if (customer.square_customer_id && customer.square_merchant_id === seller.merchantId) return customer.square_customer_id;
  let id = await findSquareCustomer(seller, customer);
  if (!id) {
    const email = safeEmail(customer.email);
    const phone = squarePhone(customer.phone);
    const data = await squareRequest("/v2/customers", {
      method: "POST",
      token: seller.accessToken,
      body: {
        idempotency_key: `c${String(customer._id).replace(/[^A-Za-z0-9]/g, "").slice(-20)}-${seller.merchantId}`.slice(0, 45),
        ...splitName(customer.full_name),
        ...(email ? { email_address: email } : {}),
        ...(phone ? { phone_number: phone } : {}),
        reference_id: String(customer._id).slice(0, 255),
      },
    });
    id = typeof data?.customer?.id === "string" ? data.customer.id : null;
    if (!id) throw new Error("Square did not return a customer.");
  }
  await ctx.runMutation(internal.tickets.linkSquareCustomer, {
    customer_id: customer._id,
    square_customer_id: id,
    square_merchant_id: seller.merchantId,
  });
  return id;
}

/** First enabled card on file for a Square customer. */
export async function findCardOnFile(seller: SellerCredentials, squareCustomerId: string): Promise<{ id: string; label: string } | null> {
  const data = await squareRequest(`/v2/cards?customer_id=${encodeURIComponent(squareCustomerId)}`, {
    method: "GET",
    token: seller.accessToken,
  });
  return pickCardOnFile(data?.cards);
}

// ---------------------------------------------------------------------------
// Orders and invoices
// ---------------------------------------------------------------------------

export function buildOrderBody(args: {
  idempotencyKey: string;
  locationId: string;
  squareCustomerId?: string;
  referenceId: string;
  items: TicketItemCents[];
}): Record<string, any> {
  return {
    idempotency_key: args.idempotencyKey,
    order: {
      location_id: args.locationId,
      ...(args.squareCustomerId ? { customer_id: args.squareCustomerId } : {}),
      reference_id: args.referenceId.slice(0, 40),
      source: { name: "ChemCheck" },
      line_items: args.items.map((item) => ({
        name: item.label.slice(0, 500),
        quantity: "1",
        base_price_money: { amount: item.amount_cents, currency: "USD" },
      })),
    },
  };
}

/** `action` scopes the idempotency key (e.g. "o3" = invoice order of send attempt 3). */
export async function createOrder(
  seller: SellerCredentials,
  args: { ticketId: string; action: string; squareCustomerId?: string; items: TicketItemCents[] },
): Promise<{ id: string; total_cents: number }> {
  const data = await squareRequest("/v2/orders", {
    method: "POST",
    token: seller.accessToken,
    body: buildOrderBody({
      idempotencyKey: ticketIdempotencyKey(args.ticketId, args.action, args.items),
      locationId: seller.locationId,
      squareCustomerId: args.squareCustomerId,
      referenceId: args.ticketId,
      items: args.items.filter((item) => item.amount_cents > 0),
    }),
  });
  const id = typeof data?.order?.id === "string" ? data.order.id : "";
  const total = data?.order?.total_money?.amount;
  if (!id) throw new Error("Square did not return an order.");
  return { id, total_cents: typeof total === "number" ? total : 0 };
}

export function buildInvoiceBody(args: {
  idempotencyKey: string;
  locationId: string;
  orderId: string;
  squareCustomerId: string;
  dueDate: string;
  deliveryMethod: SquareDeliveryMethod;
  title: string;
  description?: string;
  cardId?: string | null;
}): Record<string, any> {
  const autopay = Boolean(args.cardId) && args.deliveryMethod === "EMAIL";
  const paymentRequest: Record<string, any> = {
    request_type: "BALANCE",
    due_date: args.dueDate,
    tipping_enabled: false,
  };
  if (autopay) {
    paymentRequest.automatic_payment_source = "CARD_ON_FILE";
    paymentRequest.card_id = args.cardId;
  } else if (args.deliveryMethod === "EMAIL") {
    // Square emails reminders only for EMAIL delivery.
    paymentRequest.reminders = [
      { relative_scheduled_days: 0, message: "Your invoice is due today." },
      { relative_scheduled_days: 3, message: "Your invoice is past due." },
    ];
  }
  return {
    idempotency_key: args.idempotencyKey,
    invoice: {
      location_id: args.locationId,
      order_id: args.orderId,
      primary_recipient: { customer_id: args.squareCustomerId },
      payment_requests: [paymentRequest],
      delivery_method: args.deliveryMethod,
      accepted_payment_methods: {
        card: true,
        square_gift_card: false,
        bank_account: false,
        buy_now_pay_later: false,
        cash_app_pay: false,
      },
      store_payment_method_enabled: true,
      title: args.title.slice(0, 255),
      ...(args.description ? { description: args.description.slice(0, 65536) } : {}),
    },
  };
}

export type PublishedInvoice = {
  id: string;
  version: number;
  status: string;
  invoice_number?: string;
  public_url?: string;
  due_date?: string;
};

export function parseInvoice(data: any): PublishedInvoice {
  const invoice = data?.invoice;
  const id = typeof invoice?.id === "string" ? invoice.id : "";
  if (!id) throw new Error("Square did not return an invoice.");
  const request = Array.isArray(invoice.payment_requests) ? invoice.payment_requests[0] : undefined;
  return {
    id,
    version: typeof invoice.version === "number" ? invoice.version : 0,
    status: typeof invoice.status === "string" ? invoice.status : "UNKNOWN",
    invoice_number: typeof invoice.invoice_number === "string" ? invoice.invoice_number : undefined,
    public_url: typeof invoice.public_url === "string" && /^https:\/\//.test(invoice.public_url) ? invoice.public_url : undefined,
    due_date: typeof request?.due_date === "string" ? request.due_date : undefined,
  };
}

/** Create a DRAFT invoice for `orderId`; the caller publishes it. `attempt` scopes the idempotency key. */
export async function createInvoice(
  seller: SellerCredentials,
  args: Omit<Parameters<typeof buildInvoiceBody>[0], "idempotencyKey" | "locationId"> & {
    ticketId: string;
    attempt: number;
    items: TicketItemCents[];
  },
): Promise<PublishedInvoice> {
  const { ticketId, attempt, items, ...invoice } = args;
  const data = await squareRequest("/v2/invoices", {
    method: "POST",
    token: seller.accessToken,
    body: buildInvoiceBody({
      ...invoice,
      idempotencyKey: ticketIdempotencyKey(ticketId, `i${attempt}`, items),
      locationId: seller.locationId,
    }),
  });
  return parseInvoice(data);
}

export async function publishInvoice(seller: SellerCredentials, invoice: PublishedInvoice, ticketId: string): Promise<PublishedInvoice> {
  const data = await squareRequest(`/v2/invoices/${encodeURIComponent(invoice.id)}/publish`, {
    method: "POST",
    token: seller.accessToken,
    body: {
      version: invoice.version,
      idempotency_key: ticketIdempotencyKey(ticketId, `pub-${invoice.id.slice(-12)}`),
    },
  });
  return parseInvoice(data);
}

export async function getInvoice(seller: SellerCredentials, invoiceId: string): Promise<PublishedInvoice> {
  const data = await squareRequest(`/v2/invoices/${encodeURIComponent(invoiceId)}`, { method: "GET", token: seller.accessToken });
  return parseInvoice(data);
}

/** Best effort: delete an unpublished (DRAFT) invoice left behind by a failed publish. */
export async function deleteDraftInvoice(seller: SellerCredentials, invoice: PublishedInvoice): Promise<void> {
  try {
    await squareRequest(`/v2/invoices/${encodeURIComponent(invoice.id)}?version=${invoice.version}`, {
      method: "DELETE",
      token: seller.accessToken,
    });
  } catch (error) {
    console.warn("[Tickets] Could not delete draft Square invoice", error instanceof Error ? error.message : String(error));
  }
}

const CANCELABLE_INVOICE_STATUSES = new Set(["UNPAID", "SCHEDULED", "PARTIALLY_PAID"]);

/**
 * Cancel a published invoice with the stored version; on a version conflict
 * refetch the invoice and retry once. Returns the final invoice status.
 */
export async function cancelInvoice(
  seller: SellerCredentials,
  invoiceId: string,
  storedVersion: number | undefined,
): Promise<{ status: string; version: number }> {
  const attempt = async (version: number) => parseInvoice(await squareRequest(`/v2/invoices/${encodeURIComponent(invoiceId)}/cancel`, {
    method: "POST",
    token: seller.accessToken,
    body: { version },
  }));
  if (typeof storedVersion === "number") {
    try {
      const canceled = await attempt(storedVersion);
      return { status: canceled.status, version: canceled.version };
    } catch (error) {
      if (!(error instanceof SquareApiError) || (error.status !== 400 && error.status !== 409)) throw error;
    }
  }
  const current = await getInvoice(seller, invoiceId);
  if (current.status === "CANCELED") return { status: current.status, version: current.version };
  if (!CANCELABLE_INVOICE_STATUSES.has(current.status)) {
    throw new Error(current.status === "PAID" ? "This invoice is already paid in Square." : `This invoice cannot be canceled in Square (status ${current.status}).`);
  }
  const canceled = await attempt(current.version);
  return { status: canceled.status, version: canceled.version };
}

// ---------------------------------------------------------------------------
// Paid outside Square
// ---------------------------------------------------------------------------

export type ExternalMethod = "cash" | "check" | "other";

/**
 * Payment body recording money received outside Square against an order.
 * Cash uses `source_id: "CASH"` (cash_details); check/other use
 * `source_id: "EXTERNAL"` with external_details (Square's ExternalPaymentType
 * has CHECK and OTHER but no CASH type).
 */
export function buildExternalPaymentBody(args: {
  idempotencyKey: string;
  orderId: string;
  locationId: string;
  squareCustomerId?: string;
  amountCents: number;
  method: ExternalMethod;
  note?: string;
}): Record<string, any> {
  const money = { amount: args.amountCents, currency: "USD" };
  const body: Record<string, any> = {
    idempotency_key: args.idempotencyKey,
    amount_money: money,
    order_id: args.orderId,
    location_id: args.locationId,
    autocomplete: true,
    ...(args.squareCustomerId ? { customer_id: args.squareCustomerId } : {}),
    ...(args.note ? { note: args.note.slice(0, 500) } : {}),
  };
  if (args.method === "cash") {
    body.source_id = "CASH";
    body.cash_details = { buyer_supplied_money: money };
  } else {
    body.source_id = "EXTERNAL";
    body.external_details = {
      type: args.method === "check" ? "CHECK" : "OTHER",
      source: args.method === "check" ? "Check" : "Paid in person",
    };
  }
  return body;
}

/** Fresh Order + external payment so the in-person payment shows in Square sales. */
export async function recordExternalPayment(
  seller: SellerCredentials,
  args: { ticketId: string; squareCustomerId?: string; items: TicketItemCents[]; totalCents: number; method: ExternalMethod },
): Promise<{ order_id: string; payment_id: string }> {
  const order = await createOrder(seller, {
    ticketId: args.ticketId,
    action: "xo",
    squareCustomerId: args.squareCustomerId,
    items: args.items,
  });
  const data = await squareRequest("/v2/payments", {
    method: "POST",
    token: seller.accessToken,
    body: buildExternalPaymentBody({
      idempotencyKey: ticketIdempotencyKey(args.ticketId, "xp", args.items),
      orderId: order.id,
      locationId: seller.locationId,
      squareCustomerId: args.squareCustomerId,
      amountCents: order.total_cents || args.totalCents,
      method: args.method,
      note: `ChemCheck ticket ${args.ticketId}`,
    }),
  });
  const paymentId = typeof data?.payment?.id === "string" ? data.payment.id : "";
  if (!paymentId) throw new Error("Square did not return a payment.");
  return { order_id: order.id, payment_id: paymentId };
}

// ---------------------------------------------------------------------------
// Ticket -> Square invoice (send charge, approve quote, billing schedules)
// ---------------------------------------------------------------------------

export type TicketSendContext = {
  ticket_id: Id<"tickets">;
  business_id: Id<"businesses">;
  tenant_email: string;
  business_name: string;
  timezone: string;
  net_days: number;
  kind: string;
  status: string;
  note: string;
  items: TicketItemCents[];
  total_cents: number;
  square_invoice_id?: string;
  square_invoice_version?: number;
  square_invoice_number?: string;
  square_invoice_url?: string;
  square_due_date?: string;
  square_customer_id?: string;
  period_label?: string;
  customer: TicketCustomer;
};

const PUBLISHED_INVOICE_STATUSES = new Set(["UNPAID", "SCHEDULED", "PARTIALLY_PAID", "PAID", "PAYMENT_PENDING"]);

export type PushResult = {
  status: "requested" | "paid";
  square_invoice_number?: string;
  square_invoice_url?: string;
  delivered_via: DeliveredVia;
  autopay: boolean;
  card_label?: string;
};

function invoiceTitle(sc: TicketSendContext): string {
  if (sc.period_label) return `${sc.business_name}: ${sc.period_label}`;
  return `${sc.business_name} invoice`;
}

/**
 * Create (or adopt) and publish the Square invoice for a ticket, then mark it
 * requested. On any failure the ticket keeps its status, gets a timeline
 * error, and a readable Error is thrown. A draft Square invoice left by a
 * failed attempt is deleted before retrying; one that was already published
 * (the db write was lost) is adopted instead of creating a second.
 */
export async function pushTicketToSquare(
  ctx: ActionCtx,
  sc: TicketSendContext,
  opts: { fromStatuses: string[]; autopay: boolean; events: { type: string; text: string }[]; now?: number },
): Promise<PushResult> {
  let seller: SellerCredentials;
  try {
    seller = await requireTicketSeller(ctx, sc.business_id);
  } catch (error) {
    const message = error instanceof Error ? error.message : TICKET_CONNECT_MESSAGE;
    await ctx.runMutation(internal.tickets.addTimeline, { ticket_id: sc.ticket_id, type: "error", text: message });
    throw new Error(message);
  }

  const email = safeEmail(sc.customer.email);
  const phone = squarePhone(sc.customer.phone);
  const plan = invoiceDeliveryPlan({ email, phone });
  let draft: PublishedInvoice | null = null;

  // Takes a short send lock; throws (without touching the ticket) when another send is running.
  const started: { attempt: number; square_invoice_id?: string } = await ctx.runMutation(internal.tickets.startSquareAttempt, {
    ticket_id: sc.ticket_id,
    statuses: opts.fromStatuses,
  });
  const attempt = started.attempt;

  try {

    if (started.square_invoice_id) {
      const previous = await getInvoice(seller, started.square_invoice_id).catch(() => null);
      if (previous && PUBLISHED_INVOICE_STATUSES.has(previous.status)) {
        await ctx.runMutation(internal.tickets.markRequested, {
          ticket_id: sc.ticket_id,
          from_statuses: opts.fromStatuses,
          square_invoice_id: previous.id,
          square_invoice_version: previous.version,
          square_invoice_number: previous.invoice_number,
          square_invoice_url: previous.public_url,
          square_due_date: previous.due_date,
          paid: previous.status === "PAID",
          events: [...opts.events, { type: "sent", text: `Invoice${previous.invoice_number ? ` #${previous.invoice_number}` : ""} sent in Square` }],
        });
        return {
          status: previous.status === "PAID" ? "paid" : "requested",
          square_invoice_number: previous.invoice_number,
          square_invoice_url: previous.public_url,
          delivered_via: plan.delivered_via,
          autopay: false,
        };
      }
      if (previous && previous.status === "DRAFT") await deleteDraftInvoice(seller, previous);
    }

    const squareCustomerId = await ensureSquareCustomer(ctx, seller, sc.customer);
    let card: { id: string; label: string } | null = null;
    if (opts.autopay && plan.delivery_method === "EMAIL") {
      card = await findCardOnFile(seller, squareCustomerId).catch(() => null);
    }
    const autopay = canUseAutopay(opts.autopay, card?.id, plan.delivery_method);
    const order = await createOrder(seller, {
      ticketId: String(sc.ticket_id),
      action: `o${attempt}`,
      squareCustomerId,
      items: sc.items,
    });
    const dueDate = invoiceDueDate(opts.now ?? Date.now(), sc.timezone, sc.net_days);
    draft = await createInvoice(seller, {
      ticketId: String(sc.ticket_id),
      attempt,
      items: sc.items,
      orderId: order.id,
      squareCustomerId,
      dueDate,
      deliveryMethod: plan.delivery_method,
      title: invoiceTitle(sc),
      description: sc.note || undefined,
      cardId: autopay && card ? card.id : null,
    });
    await ctx.runMutation(internal.tickets.recordSquareDraft, {
      ticket_id: sc.ticket_id,
      square_customer_id: squareCustomerId,
      square_order_id: order.id,
      square_invoice_id: draft.id,
      square_invoice_version: draft.version,
    });
    const published = await publishInvoice(seller, draft, String(sc.ticket_id));
    draft = null;

    const invoiceLabel = `Invoice${published.invoice_number ? ` #${published.invoice_number}` : ""}`;
    const sentText = plan.delivered_via === "email"
      ? `${invoiceLabel} emailed by Square${autopay && card ? ` (autopay: ${card.label})` : ""}`
      : `${invoiceLabel} created in Square`;
    await ctx.runMutation(internal.tickets.markRequested, {
      ticket_id: sc.ticket_id,
      from_statuses: opts.fromStatuses,
      square_customer_id: squareCustomerId,
      square_order_id: order.id,
      square_invoice_id: published.id,
      square_invoice_version: published.version,
      square_invoice_number: published.invoice_number,
      square_invoice_url: published.public_url,
      square_due_date: published.due_date ?? dueDate,
      events: [...opts.events, { type: "sent", text: sentText }],
    });

    let deliveredVia: DeliveredVia = plan.delivered_via;
    if (deliveredVia === "sms") {
      deliveredVia = (await textInvoiceLink(ctx, sc, published)) ? "sms" : "link";
    }
    return {
      status: "requested",
      square_invoice_number: published.invoice_number,
      square_invoice_url: published.public_url,
      delivered_via: deliveredVia,
      autopay,
      card_label: card?.label,
    };
  } catch (error) {
    const hadDraft = Boolean(draft);
    if (draft) await deleteDraftInvoice(seller, draft);
    const message = readableSquareError(error, "send the invoice");
    await ctx.runMutation(internal.tickets.addTimeline, {
      ticket_id: sc.ticket_id,
      type: "error",
      text: message,
      clear_square_draft: hadDraft,
    });
    throw new Error(message);
  }
}

/** Text the Square payment link (SMS delivery is not settable through Square's API). */
async function textInvoiceLink(ctx: ActionCtx, sc: TicketSendContext, invoice: PublishedInvoice): Promise<boolean> {
  if (!invoice.public_url) return false;
  const text = `${sc.business_name}: your invoice${invoice.invoice_number ? ` #${invoice.invoice_number}` : ""} for ${formatUsd(sc.total_cents)} is ready. Pay here: ${invoice.public_url}`;
  try {
    const id: Id<"communications"> = await ctx.runMutation(internal.tickets.queueCustomerMessage, {
      ticket_id: sc.ticket_id,
      channel: "sms",
      template_key: "ticket_invoice",
      message: text,
    });
    const result = await deliverCommunicationNow(ctx, id, sc.tenant_email);
    await ctx.runMutation(internal.tickets.addTimeline, {
      ticket_id: sc.ticket_id,
      type: result.success ? "sent" : "error",
      text: result.success ? "Payment link texted to the customer" : `Payment link text failed: ${result.error ?? "unknown error"}`,
    });
    return result.success;
  } catch (error) {
    await ctx.runMutation(internal.tickets.addTimeline, {
      ticket_id: sc.ticket_id,
      type: "error",
      text: `Payment link text failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return false;
  }
}
