/**
 * Minimal in-memory stand-in for Convex's `ctx.db` used by unit tests of the
 * backend helper functions. Supports the subset of the query builder the
 * helpers use: get / insert / patch / delete, and
 * query(table).withIndex(name, q => q.eq(...)).filter(q => ...).order().first()/collect()/take(n).
 *
 * Not a test file itself (no `.test.` in the name) so vitest does not run it.
 */

export type FakeRow = Record<string, any> & { _id: string; _creationTime: number };

type Predicate = (row: FakeRow) => boolean;

function resolveOperand(value: any, row: FakeRow): any {
  if (value && typeof value === "object" && "__field" in value) {
    return row[value.__field];
  }
  return value;
}

class FakeQuery {
  private predicates: Predicate[] = [];

  constructor(private readonly rowsFn: () => FakeRow[]) {}

  withIndex(_name: string, cb?: (q: any) => any): FakeQuery {
    if (cb) {
      const constraints: Predicate[] = [];
      const q: any = {
        eq: (field: string, value: any) => {
          constraints.push((row) => row[field] === value);
          return q;
        },
        lt: (field: string, value: any) => {
          constraints.push((row) => row[field] < value);
          return q;
        },
        lte: (field: string, value: any) => {
          constraints.push((row) => row[field] <= value);
          return q;
        },
        gt: (field: string, value: any) => {
          constraints.push((row) => row[field] > value);
          return q;
        },
        gte: (field: string, value: any) => {
          constraints.push((row) => row[field] >= value);
          return q;
        },
      };
      cb(q);
      this.predicates.push((row) => constraints.every((c) => c(row)));
    }
    return this;
  }

  filter(cb: (q: any) => Predicate): FakeQuery {
    const q = {
      field: (name: string) => ({ __field: name }),
      eq: (a: any, b: any): Predicate => (row) => resolveOperand(a, row) === resolveOperand(b, row),
      neq: (a: any, b: any): Predicate => (row) => resolveOperand(a, row) !== resolveOperand(b, row),
      lt: (a: any, b: any): Predicate => (row) => resolveOperand(a, row) < resolveOperand(b, row),
      gt: (a: any, b: any): Predicate => (row) => resolveOperand(a, row) > resolveOperand(b, row),
      and: (...preds: Predicate[]): Predicate => (row) => preds.every((p) => p(row)),
      or: (...preds: Predicate[]): Predicate => (row) => preds.some((p) => p(row)),
    };
    this.predicates.push(cb(q));
    return this;
  }

  order(_direction?: "asc" | "desc"): FakeQuery {
    return this;
  }

  private run(): FakeRow[] {
    return this.rowsFn().filter((row) => this.predicates.every((p) => p(row)));
  }

  async first(): Promise<FakeRow | null> {
    return this.run()[0] ?? null;
  }

  async collect(): Promise<FakeRow[]> {
    return this.run();
  }

  async take(n: number): Promise<FakeRow[]> {
    return this.run().slice(0, n);
  }

  async paginate(opts: { cursor: string | null; numItems: number }) {
    const rows = this.run();
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const page = rows.slice(start, start + opts.numItems);
    const end = start + page.length;
    return { page, continueCursor: String(end), isDone: end >= rows.length };
  }
}

export class FakeDb {
  private tables = new Map<string, FakeRow[]>();
  private idToTable = new Map<string, string>();
  private seq = 0;

  private rows(table: string): FakeRow[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  async get(id: string): Promise<FakeRow | null> {
    const table = this.idToTable.get(id);
    if (!table) return null;
    const row = this.rows(table).find((r) => r._id === id);
    return row ? { ...row } : null;
  }

  async insert(table: string, doc: Record<string, any>): Promise<string> {
    const id = `${table}:${++this.seq}`;
    const row: FakeRow = { ...doc, _id: id, _creationTime: this.seq };
    for (const key of Object.keys(row)) {
      if (row[key] === undefined) delete row[key];
    }
    this.rows(table).push(row);
    this.idToTable.set(id, table);
    return id;
  }

  async patch(id: string, fields: Record<string, any>): Promise<void> {
    const table = this.idToTable.get(id);
    if (!table) throw new Error(`No document with id ${id}`);
    const row = this.rows(table).find((r) => r._id === id)!;
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) delete row[key];
      else row[key] = value;
    }
  }

  async delete(id: string): Promise<void> {
    const table = this.idToTable.get(id);
    if (!table) throw new Error(`No document with id ${id}`);
    this.tables.set(table, this.rows(table).filter((r) => r._id !== id));
    this.idToTable.delete(id);
  }

  query(table: string): FakeQuery {
    return new FakeQuery(() => this.rows(table));
  }

  /** Test-only inspection helper. */
  all(table: string): FakeRow[] {
    return this.rows(table).map((r) => ({ ...r }));
  }
}

export function makeCtx(db: FakeDb = new FakeDb()): { db: any; __db: FakeDb } {
  return { db, __db: db };
}

const DEFAULT_SETTINGS = {
  working_days: ["Monday"],
  working_hours_start: "08:00",
  working_hours_end: "17:00",
  service_types: [],
  chemical_types: [],
  route_optimization: false,
  require_photos: false,
  require_signatures: false,
};

export async function seedBusiness(db: FakeDb, ownerEmail: string, name = "Business"): Promise<string> {
  const now = Date.now();
  const id = await db.insert("businesses", {
    name,
    owner_email: ownerEmail,
    settings: DEFAULT_SETTINGS,
    created_at: now,
    updated_at: now,
  });
  await db.insert("team_members", {
    business_id: id,
    user_email: ownerEmail,
    name: "Owner",
    role: "owner",
    is_active: true,
    invited_at: now,
    joined_at: now,
  });
  return id;
}

export async function seedMember(
  db: FakeDb,
  businessId: string,
  email: string,
  overrides: Record<string, any> = {}
): Promise<string> {
  const now = Date.now();
  return await db.insert("team_members", {
    business_id: businessId,
    user_email: email,
    name: "Member",
    role: "technician",
    is_active: true,
    invited_at: now,
    joined_at: now,
    ...overrides,
  });
}

export async function seedCustomer(
  db: FakeDb,
  createdBy: string,
  overrides: Record<string, any> = {}
): Promise<string> {
  return await db.insert("customers", {
    full_name: "Customer",
    address: "1 Main St",
    service_day: "Monday",
    pool_type: "Chlorine",
    surface_type: "Plaster",
    created_by: createdBy,
    ...overrides,
  });
}
