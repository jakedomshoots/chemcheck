import { describe, expect, it } from "vitest";
import { FakeDb } from "./fakeConvexDb.testing";
import { assertReadingSanity, findInvalidReadings, READING_SANITY_LIMITS } from "./lsiValidators";
import { create, update } from "./serviceLogs";

const OWNER = "owner@example.com";

function makeCtx(db: FakeDb, email: string | null = OWNER) {
  return {
    auth: { getUserIdentity: async () => (email ? { email } : null) },
    db,
  };
}

async function seedCustomer(db: FakeDb) {
  return db.insert("customers", {
    full_name: "Alice",
    address: "1 Pool Ln",
    service_day: "Monday",
    pool_type: "Salt",
    surface_type: "Plaster",
    created_by: OWNER,
    created_at: 1,
    updated_at: 1,
  });
}

const baseLog = {
  service_date: "2026-09-01",
  status: "completed",
  ph: "good",
  chlorine: "good",
  alkalinity: "good",
  stabilizer: "good",
};

describe("reading sanity helpers", () => {
  it("exposes the same hard limits as the client", () => {
    expect(READING_SANITY_LIMITS.ph_value).toMatchObject({ min: 0, max: 14 });
    expect(READING_SANITY_LIMITS.chlorine_value.max).toBe(50);
    expect(READING_SANITY_LIMITS.alkalinity_value.max).toBe(1000);
    expect(READING_SANITY_LIMITS.stabilizer_value.max).toBe(500);
    expect(READING_SANITY_LIMITS.hardness_value.max).toBe(2000);
    expect(READING_SANITY_LIMITS.salt.max).toBe(20000);
    expect(READING_SANITY_LIMITS.water_temperature).toMatchObject({ min: 32, max: 120 });
  });

  it("returns one message per invalid field and skips absent fields", () => {
    expect(findInvalidReadings({})).toEqual([]);
    expect(findInvalidReadings({ ph_value: 7.4, chlorine_value: undefined, salt: null })).toEqual([]);
    const problems = findInvalidReadings({ ph_value: 15, chlorine_value: 60, water_temperature: 20 });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toBe("pH 15 is outside the possible range (0 to 14)");
    expect(problems[2]).toBe("Water temperature 20 °F is outside the possible range (32 °F to 120 °F)");
  });

  it("rejects non-finite numbers", () => {
    expect(findInvalidReadings({ ph_value: Number.NaN })).toEqual(["pH must be a number"]);
    expect(() => assertReadingSanity({ salt: Number.POSITIVE_INFINITY })).toThrow(/Salt must be a number/);
  });

  it("accepts boundary values", () => {
    expect(() => assertReadingSanity({ ph_value: 0, chlorine_value: 50, water_temperature: 32, salt: 20000 })).not.toThrow();
  });
});

describe("serviceLogs.create reading sanity", () => {
  it("rejects hard-invalid readings before writing", async () => {
    const db = new FakeDb();
    const customer = await seedCustomer(db);
    await expect((create as any)._handler(makeCtx(db), {
      ...baseLog,
      customer_id: customer,
      chlorine_value: 51,
    })).rejects.toThrow(/Invalid readings: Free chlorine 51 ppm is outside the possible range/);
    expect(db.all("serviceLogs")).toHaveLength(0);
  });

  it("rejects out-of-range salt and water temperature", async () => {
    const db = new FakeDb();
    const customer = await seedCustomer(db);
    await expect((create as any)._handler(makeCtx(db), {
      ...baseLog,
      customer_id: customer,
      salt: 25000,
    })).rejects.toThrow(/Salt 25000 ppm/);
    await expect((create as any)._handler(makeCtx(db), {
      ...baseLog,
      customer_id: customer,
      water_temperature: 125,
      water_temperature_source: "measured",
    })).rejects.toThrow(/Water temperature 125 °F/);
  });

  it("stores a log whose readings are plausible", async () => {
    const db = new FakeDb();
    const customer = await seedCustomer(db);
    const id = await (create as any)._handler(makeCtx(db), {
      ...baseLog,
      customer_id: customer,
      ph_value: 7.6,
      chlorine_value: 3,
      alkalinity_value: 90,
      stabilizer_value: 60,
      salt: 3200,
    });
    const stored = await db.get(id);
    expect(stored).toMatchObject({ ph_value: 7.6, chlorine_value: 3, salt: 3200 });
  });
});

describe("serviceLogs.update reading sanity", () => {
  async function seedLog(db: FakeDb, customer: string) {
    return db.insert("serviceLogs", {
      ...baseLog,
      customer_id: customer,
      created_by: OWNER,
      ph_value: 7.4,
      chlorine_value: 3,
    });
  }

  it("rejects an update that sets an impossible reading", async () => {
    const db = new FakeDb();
    const customer = await seedCustomer(db);
    const log = await seedLog(db, customer);
    await expect((update as any)._handler(makeCtx(db), { id: log, stabilizer_value: 900 }))
      .rejects.toThrow(/Stabilizer \(CYA\) 900 ppm/);
    expect((await db.get(log))?.stabilizer_value).toBeUndefined();
  });

  it("only validates the readings included in the update", async () => {
    const db = new FakeDb();
    const customer = await seedCustomer(db);
    const log = await seedLog(db, customer);
    await (update as any)._handler(makeCtx(db), { id: log, notes: "Brushed walls", hardness_value: 300, hardness_source: "calcium" });
    expect(await db.get(log)).toMatchObject({ notes: "Brushed walls", hardness_value: 300 });
  });
});
