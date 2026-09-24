import { describe, expect, it } from 'vitest';
import { pull } from './sync';

function createAuthenticatedPullContext() {
  let paginateCalls = 0;
  const business = {
    _id: 'business-1',
    owner_email: 'owner@example.com',
  };
  const member = {
    business_id: business._id,
    user_email: 'owner@example.com',
    is_active: true,
  };

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ email: 'owner@example.com' }),
    },
    db: {
      get: async () => business,
      query: (table: string) => {
        const chain: any = {
          withIndex: () => chain,
          filter: () => chain,
          first: async () => table === 'team_members' ? member : null,
          collect: async () => table === 'team_members' ? [member] : [],
          paginate: async () => {
            paginateCalls += 1;
            if (paginateCalls > 1) {
              throw new Error('This query or mutation function ran multiple paginated queries.');
            }
            return { page: [], isDone: true, continueCursor: '' };
          },
        };
        return chain;
      },
    },
  };

  return {
    ctx,
    getPaginateCalls: () => paginateCalls,
  };
}

describe('sync pull pagination', () => {
  it('runs exactly one paginated database query per invocation', async () => {
    const harness = createAuthenticatedPullContext();
    const result = await (pull as any)._handler(harness.ctx, { since: 0, limit: 50 });

    expect(harness.getPaginateCalls()).toBe(1);
    expect(result.hasMore).toBe(true);
    expect(result.cursor).toEqual(expect.any(String));
  });

  it('advances through every sync table without combining paginated queries', async () => {
    const expectedTables = [
      'customers',
      'pools',
      'equipment',
      'serviceLogs',
      'chemicalUsage',
      'notes',
      'saltCellLogs',
    ];
    let cursor: string | undefined;

    for (let index = 0; index < expectedTables.length; index += 1) {
      const harness = createAuthenticatedPullContext();
      const result = await (pull as any)._handler(harness.ctx, {
        cursor,
        since: cursor ? undefined : 0,
        limit: 50,
      });

      expect(harness.getPaginateCalls()).toBe(1);
      if (index < expectedTables.length - 1) {
        expect(result.hasMore).toBe(true);
        const nextState = JSON.parse(result.cursor);
        expect(nextState.table).toBe(expectedTables[index + 1]);
        cursor = result.cursor;
      } else {
        expect(result).toMatchObject({ hasMore: false, cursor: null });
      }
    }
  });
});
