import { beforeEach, describe, expect, it, vi } from "vitest";

const serverMocks = vi.hoisted(() => ({
  query: (config: any) => config,
  mutation: (config: any) => config,
  internalQuery: (config: any) => config,
  internalMutation: (config: any) => config,
}));

vi.mock("./_generated/server", () => serverMocks);
vi.mock("convex/values", () => ({
  v: new Proxy(
    {},
    {
      get: () => () => ({}),
    },
  ),
}));
vi.mock("./rateLimit", () => ({
  enforceRateLimit: vi.fn(async () => {}),
}));

type TableMap = Record<string, any[]>;

function createQuery(records: any[]) {
  let current = [...records];

  return {
    withIndex(_indexName: string, build?: (q: any) => any) {
      if (build) {
        const conditions: Array<{ field: string; value: unknown }> = [];
        const q = {
          field(name: string) {
            return { __field: name };
          },
          eq(fieldOrName: string | { __field: string }, value: unknown) {
            conditions.push({
              field: typeof fieldOrName === "string" ? fieldOrName : fieldOrName.__field,
              value,
            });
            return q;
          },
        };
        build(q);
        current = current.filter((record) =>
          conditions.every((condition) => record?.[condition.field] === condition.value),
        );
      }
      return this;
    },
    filter(predicate: (q: any) => boolean) {
      current = current.filter((record) =>
        predicate({
          field(name: string) {
            return { __field: name };
          },
          eq(fieldRef: { __field: string }, value: unknown) {
            return record?.[fieldRef.__field] === value;
          },
        }),
      );
      return this;
    },
    order(direction: "asc" | "desc") {
      current.sort((a, b) => {
        const left = String(a?.created_date ?? a?.service_date ?? a?.created_at ?? "");
        const right = String(b?.created_date ?? b?.service_date ?? b?.created_at ?? "");
        return direction === "desc" ? right.localeCompare(left) : left.localeCompare(right);
      });
      return this;
    },
    async collect() {
      return [...current];
    },
    async first() {
      return current[0] ?? null;
    },
    async take(limit: number) {
      return current.slice(0, limit);
    },
  };
}

function createCtx({
  identityEmail,
  tables,
}: {
  identityEmail?: string | null;
  tables: TableMap;
}) {
  return {
    auth: {
      getUserIdentity: vi.fn(async () =>
        identityEmail ? { email: identityEmail, name: identityEmail.split("@")[0] } : null,
      ),
    },
    db: {
      query(table: string) {
        return createQuery(tables[table] ?? []);
      },
      async get(id: string) {
        for (const records of Object.values(tables)) {
          const match = records.find((record) => String(record._id) === String(id));
          if (match) return match;
        }
        return null;
      },
      insert: vi.fn(async (_table: string, value: any) => value._id ?? "new_id"),
      patch: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    },
  };
}

describe("backend auth hardening", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("allows technicians to create service logs for customers created by the owner", async () => {
    const { create } = await import("./serviceLogs");
    const createHandler = (create as any).handler;
    const ctx = createCtx({
      identityEmail: "tech@example.com",
      tables: {
        businesses: [{ _id: "biz_1", owner_email: "owner@example.com", name: "ChemCheck" }],
        team_members: [
          {
            _id: "member_1",
            business_id: "biz_1",
            user_email: "tech@example.com",
            role: "technician",
            is_active: true,
          },
        ],
        customers: [
          {
            _id: "customer_1",
            created_by: "owner@example.com",
            business_id: "biz_1",
          },
        ],
        serviceLogs: [],
      },
    });

    await expect(
      createHandler(ctx as any, {
        customer_id: "customer_1",
        service_date: "2026-03-27",
        status: "completed",
        ph: "good",
        chlorine: "good",
        alkalinity: "good",
        stabilizer: "good",
      }),
    ).resolves.toBe("new_id");
  });

  it("allows technicians to update general business notes created by another teammate", async () => {
    const { update } = await import("./notes");
    const updateHandler = (update as any).handler;
    const ctx = createCtx({
      identityEmail: "tech@example.com",
      tables: {
        businesses: [{ _id: "biz_1", owner_email: "owner@example.com", name: "ChemCheck" }],
        team_members: [
          {
            _id: "member_1",
            business_id: "biz_1",
            user_email: "tech@example.com",
            role: "technician",
            is_active: true,
          },
        ],
        notes: [
          {
            _id: "note_1",
            title: "Pump check",
            content: "Needs follow-up",
            category: "maintenance",
            priority: "medium",
            created_by: "owner@example.com",
          },
        ],
      },
    });

    await expect(
      updateHandler(ctx as any, {
        id: "note_1",
        content: "Resolved on route",
      }),
    ).resolves.toBe("note_1");
  });

  it("lets technicians access quote and invoice payment contexts for the business", async () => {
    const quotes = await import("./quotes");
    const invoices = await import("./invoices");
    const quotePaymentHandler = (quotes.getForDepositPayment as any).handler;
    const invoicePaymentHandler = (invoices.getForPayment as any).handler;
    const tables = {
      businesses: [{ _id: "biz_1", owner_email: "owner@example.com", name: "ChemCheck" }],
      team_members: [
        {
          _id: "member_1",
          business_id: "biz_1",
          user_email: "tech@example.com",
          role: "technician",
          is_active: true,
        },
      ],
      customers: [
        {
          _id: "customer_1",
          created_by: "owner@example.com",
          business_id: "biz_1",
          full_name: "Pool Owner",
        },
      ],
      quotes: [
        {
          _id: "quote_1",
          customer_id: "customer_1",
          created_by: "owner@example.com",
          title: "Equipment repair",
          status: "sent",
          deposit_required: 50,
          deposit_status: "pending",
        },
      ],
      invoices: [
        {
          _id: "invoice_1",
          customer_id: "customer_1",
          created_by: "owner@example.com",
          status: "sent",
          total: 125,
          line_items: [{ description: "Weekly service", quantity: 1, unit_price: 125, amount: 125 }],
          created_at: 1,
        },
      ],
    };

    const quoteCtx = createCtx({ identityEmail: "tech@example.com", tables });
    await expect(
      quotePaymentHandler(quoteCtx as any, {
        id: "quote_1",
        user_email: "tech@example.com",
      }),
    ).resolves.toMatchObject({
      quote: expect.objectContaining({ _id: "quote_1" }),
      customer: expect.objectContaining({ _id: "customer_1" }),
    });

    const invoiceCtx = createCtx({ identityEmail: "tech@example.com", tables });
    await expect(
      invoicePaymentHandler(invoiceCtx as any, {
        id: "invoice_1",
        user_email: "tech@example.com",
      }),
    ).resolves.toMatchObject({
      invoice: expect.objectContaining({ _id: "invoice_1" }),
      customer: expect.objectContaining({ _id: "customer_1" }),
    });
  });
});
