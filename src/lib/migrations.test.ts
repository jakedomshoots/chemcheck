import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookState = vi.hoisted(() => ({ suppressed: 0 }));
const updates = vi.hoisted(() => [] as Array<{ table: string; id: number; suppressed: boolean }>);

function mockTable(name: string, rows: any[]) {
  return {
    toArray: vi.fn(async () => rows),
    update: vi.fn(async (id: number) => {
      updates.push({ table: name, id, suppressed: hookState.suppressed > 0 });
      return 1;
    }),
    where: vi.fn(() => ({ above: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
  };
}

vi.mock('@/db/chemcheck-db', () => ({
  db: {
    customers: mockTable('customers', [{ id: 1 }, { id: 2, createdAt: 'already' }]),
    serviceLogs: mockTable('serviceLogs', [{ id: 10, customer_id: 1 }]),
    chemicalUsage: mockTable('chemicalUsage', [{ id: 20, customer_id: 1 }]),
    notes: mockTable('notes', [{ id: 30 }]),
    withoutSyncHooks: vi.fn(async (operation: () => Promise<unknown>) => {
      hookState.suppressed += 1;
      try {
        return await operation();
      } finally {
        hookState.suppressed -= 1;
      }
    }),
  },
}));

vi.mock('@/lib/monitoring', () => ({
  monitoring: { recordMetric: vi.fn(), reportError: vi.fn() },
}));

describe('migrations', () => {
  beforeEach(() => {
    localStorage.clear();
    updates.splice(0);
  });

  it('runs the timestamp backfill with sync hooks suppressed so rows are not re-queued', async () => {
    const { migrationManager } = await import('./migrations');
    const { db } = await import('@/db/chemcheck-db');

    const result = await migrationManager.runMigrations();

    expect(result.success).toBe(true);
    expect(result.appliedMigrations).toContain(2);
    expect(db.withoutSyncHooks).toHaveBeenCalled();
    expect(updates.map((entry) => `${entry.table}:${entry.id}`).sort()).toEqual([
      'chemicalUsage:20', 'customers:1', 'notes:30', 'serviceLogs:10',
    ]);
    expect(updates.every((entry) => entry.suppressed)).toBe(true);
  });
});
