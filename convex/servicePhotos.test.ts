import { beforeEach, describe, expect, it, vi } from "vitest";

const serverMocks = vi.hoisted(() => ({
  query: (config: any) => config,
  mutation: (config: any) => config,
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

function createRecordQuery(records: any[]) {
  let current = [...records];

  return {
    withIndex(_indexName: string, build?: (q: any) => any) {
      if (build) {
        const filters: Array<{ field: string; value: unknown }> = [];
        const q = {
          eq(fieldOrName: string | { __field: string }, value: unknown) {
            filters.push({
              field: typeof fieldOrName === "string" ? fieldOrName : fieldOrName.__field,
              value,
            });
            return q;
          },
          field(name: string) {
            return { __field: name };
          },
        };
        build(q);
        current = current.filter((record) =>
          filters.every((filter) => record?.[filter.field] === filter.value),
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
    async collect() {
      return [...current];
    },
    async first() {
      return current[0] ?? null;
    },
  };
}

function createPhotoCtx({
  identityEmail,
  tables,
  storageDocs,
}: {
  identityEmail?: string | null;
  tables?: Record<string, any[]>;
  storageDocs?: any[];
}) {
  const data = tables ?? {};
  const storage = storageDocs ?? [];

  return {
    auth: {
      getUserIdentity: vi.fn(async () =>
        identityEmail ? { email: identityEmail, name: identityEmail.split("@")[0] } : null,
      ),
    },
    db: {
      query(table: string) {
        return createRecordQuery(data[table] ?? []);
      },
      system: {
        query(table: string) {
          if (table !== "_storage") throw new Error(`Unexpected system table ${table}`);
          return createRecordQuery(storage);
        },
        async get(id: string) {
          return storage.find((record) => String(record._id) === String(id)) ?? null;
        },
      },
      async get(id: string) {
        for (const records of Object.values(data)) {
          const match = records.find((record) => String(record._id) === String(id));
          if (match) return match;
        }
        return null;
      },
      delete: vi.fn(async () => {}),
      patch: vi.fn(async () => {}),
    },
    storage: {
      generateUploadUrl: vi.fn(async () => "https://upload.example.test"),
      delete: vi.fn(async () => {}),
      getUrl: vi.fn(async (storageId: string) =>
        storage.some((record) => String(record._id) === String(storageId))
          ? `https://files.example.test/${storageId}`
          : null,
      ),
    },
  };
}

describe("servicePhotos hardening", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.CHEMCHECK_ALLOW_UNAUTH_PHOTO_UPLOAD;
    delete process.env.CONVEX_DEPLOYMENT_ENV;
    delete process.env.NODE_ENV;
    delete process.env.VERCEL_ENV;
  });

  it("rejects unauthenticated upload URLs unless explicitly enabled", async () => {
    process.env.NODE_ENV = "development";

    const servicePhotos = await import("./servicePhotos");
    const generateUploadUrlHandler = (servicePhotos.generateUploadUrl as any).handler;
    const ctx = createPhotoCtx({ identityEmail: null });

    await expect(generateUploadUrlHandler(ctx as any, {})).rejects.toThrow(
      "Not authenticated",
    );
  });

  it("allows unauthenticated upload URLs only when CHEMCHECK_ALLOW_UNAUTH_PHOTO_UPLOAD=true", async () => {
    process.env.CHEMCHECK_ALLOW_UNAUTH_PHOTO_UPLOAD = "true";

    const servicePhotos = await import("./servicePhotos");
    const generateUploadUrlHandler = (servicePhotos.generateUploadUrl as any).handler;
    const ctx = createPhotoCtx({ identityEmail: null });

    await expect(generateUploadUrlHandler(ctx as any, {})).resolves.toBe(
      "https://upload.example.test",
    );
  });

  it("cleans up orphaned photo metadata and unreferenced storage objects", async () => {
    const now = Date.now();
    const servicePhotos = await import("./servicePhotos");
    const cleanupHandler = (servicePhotos.cleanupOrphanedUploads as any).handler;
    const ctx = createPhotoCtx({
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
          { _id: "customer_1", created_by: "owner@example.com", business_id: "biz_1" },
        ],
        serviceLogs: [
          { _id: "log_1", customer_id: "customer_1", created_by: "owner@example.com" },
        ],
        servicePhotos: [
          {
            _id: "photo_1",
            service_log_id: "log_1",
            customer_id: "customer_1",
            storage_id: "storage_kept",
            category: "before",
            timestamp: "2026-03-27T12:00:00.000Z",
            created_at: now - 10_000,
          },
          {
            _id: "photo_2",
            service_log_id: "log_1",
            customer_id: "customer_1",
            storage_id: "storage_missing",
            category: "after",
            timestamp: "2026-03-27T12:05:00.000Z",
            created_at: now - 10_000,
          },
        ],
      },
      storageDocs: [
        { _id: "storage_kept", creationTime: now - 10_000 },
        { _id: "storage_orphan", creationTime: now - 10_000 },
        { _id: "storage_recent", creationTime: now - 500 },
      ],
    });

    await expect(
      cleanupHandler(ctx as any, {
        min_age_ms: 1_000,
      }),
    ).resolves.toMatchObject({
      deleted_photo_records: 1,
      deleted_storage_objects: 1,
    });

    expect(ctx.db.delete).toHaveBeenCalledWith("photo_2");
    expect(ctx.storage.delete).toHaveBeenCalledWith("storage_orphan");
  });
});
