import { describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import {
  DEFAULT_BUSINESS_NAME,
  accessReportByToken,
  canAccessCustomer,
  cleanupExpiredReportsAndLogs,
  generateSimpleEmailContent,
  isActiveTeamMember,
  isWellFormedReportToken,
  resolveReportAccessRateLimitKey,
  resolveReportBaseUrl,
  resolveReportRecipientEmail,
  sendReport,
  verifyServiceLogOwnershipForSend,
} from "./serviceReports";
import {
  buildCommunicationEmailHtml,
  getDeliveryPolicyError,
  isCustomerPhone,
  normalizePhoneForComparison,
  queueServiceText,
  toPositiveInt,
} from "./communications";
import { exportUserData } from "./account";

// ---------------------------------------------------------------------------
// Minimal in-memory stand-in for the Convex database, used to call registered
// handlers directly (`fn._handler(ctx, args)`). Supports the subset of the
// query API these handlers use.
// ---------------------------------------------------------------------------
type Doc = Record<string, any> & { _id: string; _creationTime: number };
type Condition = { field: string; op: "eq" | "lt" | "lte" | "gt" | "gte"; value: any };

function compare(a: any, b: any): number {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return a < b ? -1 : 1;
}

function matches(doc: Doc, conditions: Condition[]): boolean {
  return conditions.every(({ field, op, value }) => {
    const c = compare(doc[field], value);
    if (op === "eq") return c === 0;
    if (op === "lt") return c < 0;
    if (op === "lte") return c <= 0;
    if (op === "gt") return c > 0;
    return c >= 0;
  });
}

function rangeBuilder(conditions: Condition[]) {
  const builder: any = {};
  for (const op of ["eq", "lt", "lte", "gt", "gte"] as const) {
    builder[op] = (field: string, value: any) => {
      conditions.push({ field, op, value });
      return builder;
    };
  }
  return builder;
}

function filterBuilder() {
  return {
    field: (name: string) => ({ __field: name }),
    eq: (a: any, b: any) => (doc: Doc) => {
      const left = a && a.__field ? doc[a.__field] : a;
      const right = b && b.__field ? doc[b.__field] : b;
      return left === right;
    },
    and: (...preds: Array<(doc: Doc) => boolean>) => (doc: Doc) => preds.every((p) => p(doc)),
  };
}

function createFakeDb(initial: Record<string, Array<Record<string, any>>> = {}) {
  const tables = new Map<string, Doc[]>();
  let counter = 0;

  const insertRow = (table: string, value: Record<string, any>): string => {
    counter += 1;
    const _id = value._id ?? `${table}:${counter}`;
    const doc = { _creationTime: counter, ...value, _id } as Doc;
    if (!tables.has(table)) tables.set(table, []);
    tables.get(table)!.push(doc);
    return _id;
  };

  for (const [table, rows] of Object.entries(initial)) {
    for (const row of rows) insertRow(table, row);
  }

  const findById = (id: string): { table: string; index: number } | null => {
    for (const [table, rows] of tables) {
      const index = rows.findIndex((row) => row._id === id);
      if (index >= 0) return { table, index };
    }
    return null;
  };

  const db = {
    get: async (id: string) => {
      const found = findById(id);
      return found ? { ...tables.get(found.table)![found.index] } : null;
    },
    insert: async (table: string, value: Record<string, any>) => insertRow(table, value),
    patch: async (id: string, value: Record<string, any>) => {
      const found = findById(id);
      if (!found) throw new Error(`patch: ${id} not found`);
      const rows = tables.get(found.table)!;
      rows[found.index] = { ...rows[found.index], ...value };
    },
    delete: async (id: string) => {
      const found = findById(id);
      if (found) tables.get(found.table)!.splice(found.index, 1);
    },
    normalizeId: (table: string, id: string) => (id.startsWith(`${table}:`) ? id : null),
    query: (table: string) => {
      const conditions: Condition[] = [];
      const predicates: Array<(doc: Doc) => boolean> = [];
      let direction: "asc" | "desc" = "asc";
      const run = () => {
        const rows = (tables.get(table) || [])
          .filter((doc) => matches(doc, conditions) && predicates.every((p) => p(doc)))
          .sort((a, b) => a._creationTime - b._creationTime)
          .map((doc) => ({ ...doc }));
        return direction === "desc" ? rows.reverse() : rows;
      };
      const chain: any = {
        withIndex: (_name: string, fn?: (q: any) => any) => {
          if (fn) fn(rangeBuilder(conditions));
          return chain;
        },
        filter: (fn: (q: any) => (doc: Doc) => boolean) => {
          predicates.push(fn(filterBuilder()));
          return chain;
        },
        order: (dir: "asc" | "desc") => {
          direction = dir;
          return chain;
        },
        first: async () => run()[0] ?? null,
        take: async (n: number) => run().slice(0, n),
        collect: async () => run(),
      };
      return chain;
    },
  };

  return {
    db,
    rows: (table: string) => (tables.get(table) || []).map((doc) => ({ ...doc })),
  };
}

const handler = (fn: unknown) => (fn as any)._handler as (ctx: any, args: any) => Promise<any>;

const OWNER = "owner@pool.test";
const MEMBER = "tech@pool.test";
const TOKEN = "0f8fad5b-d9cb-469f-a165-70867728950e";

function seed(extra: Record<string, Array<Record<string, any>>> = {}) {
  return createFakeDb({
    businesses: [{ _id: "businesses:1", name: "Blue Water Pools", owner_email: OWNER }],
    team_members: [
      { business_id: "businesses:1", user_email: MEMBER, name: "Tech", role: "employee", is_active: true },
      { business_id: "businesses:1", user_email: "former@pool.test", name: "Former", role: "employee", is_active: false },
      { business_id: "businesses:1", user_email: "invitee@pool.test", name: "Invitee", role: "employee", is_active: true, status: "pending" },
    ],
    customers: [
      {
        _id: "customers:1",
        full_name: "Pat Customer",
        phone: "+1 (555) 123-4567",
        email: "Pat@Customer.test",
        created_by: OWNER,
        business_id: "businesses:1",
      },
    ],
    serviceLogs: [
      {
        _id: "serviceLogs:1",
        customer_id: "customers:1",
        service_date: "2026-09-01",
        ph: "ok",
        notes: "Private tech notes",
        duration_ms: 1800000,
        start_time: "09:00",
        end_time: "09:30",
      },
    ],
    ...extra,
  });
}

function authCtx(db: any, email: string | null) {
  return {
    db,
    auth: { getUserIdentity: async () => (email ? { email } : null) },
  };
}

describe("canAccessCustomer", () => {
  it("allows the creator, the business owner and active team members only", async () => {
    const { db } = seed();
    const customer = await db.get("customers:1");
    expect(await canAccessCustomer({ db }, customer, OWNER)).toBe(true);
    expect(await canAccessCustomer({ db }, customer, MEMBER.toUpperCase())).toBe(true);
    expect(await canAccessCustomer({ db }, customer, "former@pool.test")).toBe(false);
    expect(await canAccessCustomer({ db }, customer, "invitee@pool.test")).toBe(false);
    expect(await canAccessCustomer({ db }, customer, "stranger@else.test")).toBe(false);
    expect(await canAccessCustomer({ db }, customer, "")).toBe(false);
  });

  it("treats members as active only when is_active and status allow it", () => {
    expect(isActiveTeamMember({ is_active: true })).toBe(true);
    expect(isActiveTeamMember({ is_active: true, status: "active" })).toBe(true);
    expect(isActiveTeamMember({ is_active: true, status: "pending" })).toBe(false);
    expect(isActiveTeamMember({ is_active: false, status: "active" })).toBe(false);
  });
});

describe("sendReport action", () => {
  it("authorizes through an internal mutation instead of ctx.db", async () => {
    const calls: string[] = [];
    const ctx = {
      auth: { getUserIdentity: async () => ({ email: MEMBER }) },
      runMutation: async (ref: any) => {
        calls.push(getFunctionName(ref));
        return null;
      },
      runQuery: async (ref: any) => {
        calls.push(getFunctionName(ref));
        return {
          service_date: "2026-09-01",
          customer: { _id: "customers:1", email: "pat@customer.test", phone: "+15551234567" },
          business: { name: "Blue Water Pools" },
        };
      },
    };

    const result = await handler(sendReport)(ctx, {
      service_log_id: "serviceLogs:1",
      delivery_method: "email",
      recipient_email: "attacker@evil.test",
    });

    expect(calls[0]).toBe("serviceReports:verifyServiceLogOwnershipForSend");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/must match the customer's email/);
    expect(calls).not.toContain("serviceReports:getOrCreateReportInternal");
  });

  it("lets team members pass the ownership mutation and rate limits sends", async () => {
    const { db } = seed();
    await expect(
      handler(verifyServiceLogOwnershipForSend)({ db }, { service_log_id: "serviceLogs:1", user_email: MEMBER })
    ).resolves.toBeNull();
    await expect(
      handler(verifyServiceLogOwnershipForSend)({ db }, { service_log_id: "serviceLogs:1", user_email: "stranger@else.test" })
    ).rejects.toThrow("Access denied");
  });

  it("only mails the customer's email and links to the configured app origin", () => {
    expect(resolveReportRecipientEmail("Pat@Customer.test", "pat@customer.test ")).toBe("Pat@Customer.test");
    expect(resolveReportRecipientEmail("pat@customer.test", undefined)).toBe("pat@customer.test");
    expect(resolveReportRecipientEmail("pat@customer.test", "attacker@evil.test")).toBeNull();
    expect(resolveReportRecipientEmail(undefined, "attacker@evil.test")).toBeNull();

    expect(resolveReportBaseUrl("https://evil.test", "https://app.chemcheck.test/")).toBe("https://app.chemcheck.test");
    expect(resolveReportBaseUrl("https://evil.test", undefined)).toBeNull();
    expect(resolveReportBaseUrl("http://localhost:5173", undefined)).toBe("http://localhost:5173");
  });

  it("uses a neutral fallback business name", () => {
    const email = generateSimpleEmailContent({ customerName: "Pat", serviceDate: "09/01/2026", poolStatus: "good" });
    expect(email.htmlBody).toContain(`completed by ${DEFAULT_BUSINESS_NAME}`);
    expect(email.textBody).toContain(`completed by ${DEFAULT_BUSINESS_NAME}`);
  });
});

describe("cleanupExpiredReportsAndLogs", () => {
  it("deletes expired reports and stale access logs using index ranges", async () => {
    const now = Date.now();
    const { db, rows } = createFakeDb({
      serviceReports: [
        { report_token: "a", expires_at: now - 1 },
        { report_token: "b", expires_at: now + 60_000 },
        { report_token: "legacy" },
      ],
      reportAccessLogs: [
        { report_token: "a", success: true, accessed_at: now - 91 * 24 * 60 * 60 * 1000 },
        { report_token: "b", success: true, accessed_at: now - 1000 },
      ],
    });

    const result = await handler(cleanupExpiredReportsAndLogs)({ db }, {});

    expect(result).toEqual({ deletedReports: 2, deletedAccessLogs: 1 });
    expect(rows("serviceReports").map((r) => r.report_token)).toEqual(["b"]);
    expect(rows("reportAccessLogs").map((r) => r.report_token)).toEqual(["b"]);
  });
});

describe("public report access", () => {
  const reportRow = { report_token: TOKEN, service_log_id: "serviceLogs:1", customer_id: "customers:1", created_at: 0 };

  function publicCtx(db: any) {
    const getUrl = vi.fn(async (id: string) => `https://files.test/${id}`);
    return { ctx: { db, storage: { getUrl } }, getUrl };
  }

  it("writes nothing for malformed or unknown tokens", async () => {
    const { db, rows } = seed();
    const { ctx } = publicCtx(db);

    expect((await handler(accessReportByToken)(ctx, { token: "x".repeat(5000) })).found).toBe(false);
    expect((await handler(accessReportByToken)(ctx, { token: TOKEN })).found).toBe(false);
    expect(rows("rateLimits")).toHaveLength(0);
    expect(rows("reportAccessLogs")).toHaveLength(0);
  });

  it("rate limits per token regardless of the client-supplied IP and audits one denial per window", async () => {
    const { db, rows } = seed({ serviceReports: [{ ...reportRow, expires_at: Date.now() + 60_000 }] });
    const { ctx } = publicCtx(db);

    for (let i = 0; i < 30; i++) {
      const result = await handler(accessReportByToken)(ctx, { token: TOKEN, ip_address: `10.0.0.${i}` });
      expect(result.found).toBe(true);
    }
    const limited = await handler(accessReportByToken)(ctx, { token: TOKEN, ip_address: "10.9.9.9" });
    expect(limited.rate_limited).toBe(true);
    await handler(accessReportByToken)(ctx, { token: TOKEN, ip_address: "10.9.9.10" });

    expect(rows("rateLimits").map((r) => r.key)).toEqual([resolveReportAccessRateLimitKey(TOKEN)]);
    const logs = rows("reportAccessLogs");
    expect(logs).toHaveLength(31);
    expect(logs.filter((log) => log.failure_reason === "rate_limited")).toHaveLength(1);
  });

  it("omits sections hidden by the customer's report settings", async () => {
    const { db } = seed({
      serviceReports: [{ ...reportRow, expires_at: Date.now() + 60_000 }],
      servicePhotos: [{ service_log_id: "serviceLogs:1", category: "before", storage_id: "s1", timestamp: "t" }],
    });
    await db.patch("customers:1", {
      report_settings: {
        show_chemical_readings: false,
        show_photos: false,
        show_service_notes: false,
        show_technician_name: false,
        show_service_duration: false,
        show_overall_status: true,
      },
    });
    const { ctx, getUrl } = publicCtx(db);

    const result = await handler(accessReportByToken)(ctx, { token: TOKEN });

    expect(result.found).toBe(true);
    expect(result.report.businessName).toBe("Blue Water Pools");
    expect(result.report.notes).toBeNull();
    expect(result.report.chemicalReadings).toBeNull();
    expect(result.report.technicianName).toBeNull();
    expect(result.report.serviceDuration).toBeNull();
    expect(result.report.startTime).toBeNull();
    expect(result.report.photos).toEqual({ before: [], after: [] });
    expect(getUrl).not.toHaveBeenCalled();
  });

  it("returns visible sections when settings allow them", async () => {
    const { db } = seed({
      serviceReports: [{ ...reportRow, expires_at: Date.now() + 60_000 }],
      servicePhotos: [{ service_log_id: "serviceLogs:1", category: "before", storage_id: "s1", timestamp: "t" }],
    });
    const { ctx } = publicCtx(db);

    const result = await handler(accessReportByToken)(ctx, { token: TOKEN });

    expect(result.report.notes).toBe("Private tech notes");
    expect(result.report.serviceDuration).toBe(1800000);
    expect(result.report.photos.before).toHaveLength(1);
    expect(isWellFormedReportToken(TOKEN)).toBe(true);
  });
});

describe("communications", () => {
  it("only queues service texts to the customer's phone with a bounded message", async () => {
    const { db, rows } = seed();
    const queue = handler(queueServiceText);

    await expect(
      queue(authCtx(db, MEMBER), { customer_id: "customers:1", recipient: "+1 999 000 1111", message: "hi" })
    ).rejects.toThrow(/phone number on file/);
    await expect(
      queue(authCtx(db, MEMBER), { customer_id: "customers:1", recipient: "555-123-4567", message: "x".repeat(641) })
    ).rejects.toThrow(/640 characters/);
    await expect(
      queue(authCtx(db, "stranger@else.test"), { customer_id: "customers:1", recipient: "555-123-4567", message: "hi" })
    ).rejects.toThrow(/access denied/);

    await queue(authCtx(db, MEMBER), { customer_id: "customers:1", recipient: "(555) 123-4567", message: " On our way " });
    const [queued] = rows("communications");
    expect(queued.message).toBe("On our way");
    expect(queued.recipient).toBe("+15551234567");
    expect(queued.created_by).toBe(MEMBER);
  });

  it("normalizes phone numbers for comparison", () => {
    expect(normalizePhoneForComparison("(555) 123-4567")).toBe("15551234567");
    expect(normalizePhoneForComparison("+1 555.123.4567")).toBe("15551234567");
    expect(isCustomerPhone({ phone: "+15551234567" }, "555 123 4567")).toBe(true);
    expect(isCustomerPhone({ phone: "+15551234567" }, "555 123 4568")).toBe(false);
  });

  it("applies the delivery policy to queued items", () => {
    const customer = { phone: "+15551234567", email: "pat@customer.test" };
    expect(getDeliveryPolicyError({ channel: "sms", type: "service_text", recipient: "5551234567", message: "hi" }, customer)).toBeNull();
    expect(getDeliveryPolicyError({ channel: "sms", type: "service_text", recipient: "5559999999", message: "hi" }, customer)).toMatch(/contact details/);
    expect(getDeliveryPolicyError({ channel: "sms", type: "service_text", recipient: "5551234567", message: "x".repeat(641) }, customer)).toMatch(/640/);
    expect(getDeliveryPolicyError({ channel: "email", type: "reminder", recipient: "pat@customer.test", message: "hi" }, null)).toMatch(/not found/);
  });

  it("escapes user-controlled content in email HTML", () => {
    const html = buildCommunicationEmailHtml("Invoice <b>", `<img src=x onerror="alert(1)"> Pay: javascript:alert(1)`);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("caps batch sizes", () => {
    expect(toPositiveInt(1e9, 25)).toBe(100);
    expect(toPositiveInt(undefined, 25)).toBe(25);
    expect(toPositiveInt(-5, 25)).toBe(1);
    expect(toPositiveInt(Number.NaN, 25)).toBe(25);
  });
});

describe("exportUserData action", () => {
  it("reads through an internal query and schedules deletion of the export file", async () => {
    const runQuery = vi.fn(async () => ({ data: { userEmail: OWNER }, truncated: true, totalRecords: 1 }));
    const runAfter = vi.fn(async () => undefined);
    const store = vi.fn(async () => "storage:1");
    const ctx = {
      auth: { getUserIdentity: async () => ({ email: OWNER }) },
      runQuery,
      scheduler: { runAfter },
      storage: { store, getUrl: async () => "https://files.test/export.json" },
    };

    const result = await handler(exportUserData)(ctx, {});

    expect(getFunctionName((runQuery.mock.calls[0] as any[])[0])).toBe("account:collectUserExportDataInternal");
    expect(result).toMatchObject({ type: "url", url: "https://files.test/export.json" });
    expect(runAfter).toHaveBeenCalledTimes(1);
    const [delay, ref, args] = runAfter.mock.calls[0] as any[];
    expect(delay).toBe(24 * 60 * 60 * 1000);
    expect(getFunctionName(ref)).toBe("account:deleteExportFile");
    expect(args).toEqual({ storageId: "storage:1" });
  });
});
