import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  queryServiceLogsByCustomerDateRange,
  filterCustomersForLocalAccount,
  filterRecordsForLocalAccount,
  filterNotesForLocalAccount,
  isNoteVisibleToAccount,
  useCustomerCreate,
  useCurrentUser,
  useNoteCreate,
} from './dexieHooks';

const mockCustomersToArray = vi.hoisted(() => vi.fn());
const mockCustomersAdd = vi.hoisted(() => vi.fn());
const mockCustomersGet = vi.hoisted(() => vi.fn());
const mockNotesAdd = vi.hoisted(() => vi.fn());
const mockValidateCustomer = vi.hoisted(() => vi.fn());
const mockValidateNote = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockServiceLogsWhere = vi.hoisted(() => vi.fn());
const mockServiceLogsBetween = vi.hoisted(() => vi.fn());
const mockServiceLogsReverse = vi.hoisted(() => vi.fn());
const mockServiceLogsLimit = vi.hoisted(() => vi.fn());
const mockServiceLogsToArray = vi.hoisted(() => vi.fn());

vi.mock('@/db/chemcheck-db', () => ({
  db: {
    customers: {
      toArray: mockCustomersToArray,
      add: mockCustomersAdd,
      get: mockCustomersGet,
    },
    serviceLogs: {
      where: mockServiceLogsWhere,
    },
    notes: {
      add: mockNotesAdd,
    },
  },
  getTimestamp: vi.fn(() => '2026-03-24T09:00:00.000Z'),
  DEFAULT_USER: 'local',
  getTodayDate: vi.fn(() => '2026-03-24'),
}));

vi.mock('@/lib/validation', () => ({
  validateCustomer: mockValidateCustomer,
  validateServiceLog: vi.fn(() => ({ success: false, errors: ['not mocked'] })),
  validateChemicalUsage: vi.fn(() => ({ success: false, errors: ['not mocked'] })),
  validateNote: mockValidateNote,
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock('@/lib/monitoring', () => ({
  measureDatabaseOperation: (_name: string, fn: () => unknown) => fn(),
  reportError: vi.fn(),
}));

describe('useCustomerCreate', () => {
  const baseCustomer = {
    full_name: 'Alice Smith',
    address: '123 Apple St',
    service_day: 'Monday',
    pool_type: 'Salt',
    surface_type: 'Tile',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mockCheckRateLimit.mockReturnValue({ allowed: true });
    mockValidateCustomer.mockImplementation((data) => ({ success: true, data }));
    mockServiceLogsWhere.mockReturnValue({ between: mockServiceLogsBetween });
    mockServiceLogsBetween.mockReturnValue({ reverse: mockServiceLogsReverse });
    mockServiceLogsReverse.mockReturnValue({ limit: mockServiceLogsLimit });
    mockServiceLogsLimit.mockReturnValue({ toArray: mockServiceLogsToArray });
  });

  it('uses the authenticated account email for new customer ownership', async () => {
    localStorage.setItem('chemcheck_current_user', JSON.stringify({
      email: 'Owner@Example.com',
      name: 'Pool Owner',
    }));
    mockCustomersToArray.mockResolvedValue([
      { id: 1, created_by: 'owner@example.com', service_day: 'Monday' },
      { id: 2, created_by: 'local', service_day: 'Monday' },
      { id: 3, created_by: 'other@example.com', service_day: 'Monday' },
    ]);
    mockCustomersAdd.mockResolvedValue(18);

    const { result } = renderHook(() => useCustomerCreate());
    await act(async () => {
      await result.current(baseCustomer);
    });

    expect(mockCustomersAdd).toHaveBeenCalledWith(expect.objectContaining({
      created_by: 'owner@example.com',
      sort_order: 2,
    }));
  });

  it('assigns a default sort_order when omitted, based on the current service day count', async () => {
    mockCustomersToArray.mockResolvedValue([
      { id: 1, created_by: 'local', service_day: 'Monday', sort_order: 0 },
      { id: 2, created_by: 'local', service_day: 'Tuesday', sort_order: 0 },
      { id: 3, created_by: 'other', service_day: 'Monday', sort_order: 0 },
    ]);
    mockCustomersAdd.mockResolvedValue(15);

    const { result } = renderHook(() => useCustomerCreate());

    await act(async () => {
      const createdId = await result.current(baseCustomer);
      expect(createdId).toBe(15);
    });

    expect(mockCustomersAdd).toHaveBeenCalledTimes(1);
    expect(mockCustomersAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        ...baseCustomer,
        sort_order: 1,
        created_by: 'local',
        createdAt: '2026-03-24T09:00:00.000Z',
        updatedAt: '2026-03-24T09:00:00.000Z',
        sync_status: 'pending',
      })
    );
  });

  it('assigns the next position for subsequent customers on the same service day', async () => {
    mockCustomersToArray.mockResolvedValue([
      { id: 1, created_by: 'local', service_day: 'Monday', sort_order: 0 },
      { id: 2, created_by: 'local', service_day: 'Monday', sort_order: 2 },
      { id: 3, created_by: 'other', service_day: 'Monday', sort_order: 5 },
      { id: 4, created_by: 'local', service_day: 'Tuesday', sort_order: 0 },
    ]);
    mockCustomersAdd.mockResolvedValue(16);

    const { result } = renderHook(() => useCustomerCreate());

    await act(async () => {
      await result.current({
        ...baseCustomer,
        service_day: 'Monday',
      });
    });

    expect(mockCustomersAdd).toHaveBeenCalledTimes(1);
    expect(mockCustomersAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        sort_order: 2,
      })
    );
  });

  it('preserves caller-provided sort_order for new customers', async () => {
    mockCustomersToArray.mockResolvedValue([]);
    mockCustomersAdd.mockResolvedValue(17);

    const { result } = renderHook(() => useCustomerCreate());

    await act(async () => {
      await result.current({
        ...baseCustomer,
        service_day: 'Tuesday',
        sort_order: 7,
      });
    });

    expect(mockCustomersAdd).toHaveBeenCalledTimes(1);
    expect(mockCustomersAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        sort_order: 7,
      })
    );
  });
});

describe('useCurrentUser', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('returns the normalized authenticated email from local state', () => {
    localStorage.setItem('chemcheck_current_user', JSON.stringify({
      email: 'Owner@Example.com ',
      name: 'Pool Owner',
    }));

    const { result } = renderHook(() => useCurrentUser());

    expect(result.current).toEqual({ email: 'owner@example.com', name: 'Pool Owner' });
  });

  it('keeps legacy local mode when no authenticated user is stored', () => {
    const { result } = renderHook(() => useCurrentUser());

    expect(result.current).toEqual({ email: 'local', name: 'Local User' });
  });
});

describe('customer account visibility', () => {
  it('shows synced owner records and legacy local records without leaking another account', () => {
    const customers = [
      { id: 1, created_by: 'owner@example.com', full_name: 'Synced Customer' },
      { id: 2, created_by: 'local', full_name: 'Legacy Customer' },
      { id: 3, created_by: 'other@example.com', full_name: 'Other Account' },
    ] as any[];

    const visibleCustomers = filterCustomersForLocalAccount(customers, 'OWNER@EXAMPLE.COM');

    expect(visibleCustomers.map((customer) => customer.full_name)).toEqual([
      'Synced Customer',
      'Legacy Customer',
    ]);
  });
});

describe('child record account visibility', () => {
  it('only exposes service logs, usage and notes that belong to the account\'s customers', () => {
    const owned = new Set([1, 2]);
    const logs = [
      { id: 10, customer_id: 1 },
      { id: 11, customer_id: 3 },
      { id: 12, customer_id: 2 },
    ];
    expect(filterRecordsForLocalAccount(logs, owned).map((log) => log.id)).toEqual([10, 12]);
  });

  it('hides customer-less records unless explicitly allowed (general notes)', () => {
    const owned = new Set([1]);
    const notes = [
      { id: 1, customer_id: 1 },
      { id: 2 },
      { id: 3, customer_id: 9 },
    ];
    expect(filterRecordsForLocalAccount(notes, owned).map((note) => note.id)).toEqual([1]);
    expect(filterRecordsForLocalAccount(notes, owned, { allowUnassigned: true }).map((note) => note.id)).toEqual([1, 2]);
  });
});

describe('general note account visibility', () => {
  const owned = new Set([1]);

  it('scopes customer-linked notes through the customer and general notes through created_by', () => {
    const notes = [
      { id: 1, customer_id: 1, created_by: 'other@example.com', title: 'owned customer' },
      { id: 2, customer_id: 9, created_by: 'me@example.com', title: 'foreign customer' },
      { id: 3, created_by: 'ME@Example.com', title: 'my general' },
      { id: 4, created_by: 'other@example.com', title: 'their general' },
      { id: 5, created_by: 'local', title: 'legacy local' },
      { id: 6, title: 'legacy ownerless' },
    ] as any[];

    expect(filterNotesForLocalAccount(notes, 'me@example.com', owned).map((note) => note.id)).toEqual([1, 3, 5, 6]);
    expect(isNoteVisibleToAccount(notes[3], 'me@example.com', owned)).toBe(false);
    expect(isNoteVisibleToAccount(notes[3], 'other@example.com', owned)).toBe(true);
  });

  it('shows legacy local notes to the legacy local account too', () => {
    const notes = [
      { id: 1, created_by: 'local' },
      { id: 2, created_by: 'someone@example.com' },
    ] as any[];
    expect(filterNotesForLocalAccount(notes, '', owned).map((note) => note.id)).toEqual([1]);
  });
});

describe('useNoteCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mockCheckRateLimit.mockReturnValue({ allowed: true });
    mockValidateNote.mockImplementation((data: any) => ({ success: true, data }));
    mockNotesAdd.mockResolvedValue(77);
  });

  it('stamps created_by with the signed-in account', async () => {
    localStorage.setItem('chemcheck_current_user', JSON.stringify({ email: 'Tech@Example.com' }));
    const { result } = renderHook(() => useNoteCreate());

    let id: number | undefined;
    await act(async () => {
      id = await result.current({ title: 'Gate code', content: '1234', category: 'General', priority: 'low' });
    });

    expect(id).toBe(77);
    expect(mockNotesAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Gate code',
      created_by: 'tech@example.com',
      completed: false,
      created_date: '2026-03-24',
      sync_status: 'pending',
    }));
  });

  it('falls back to the legacy local owner when nobody is signed in', async () => {
    const { result } = renderHook(() => useNoteCreate());
    await act(async () => {
      await result.current({ title: 'x', content: 'y', category: 'General', priority: 'low' });
    });
    expect(mockNotesAdd).toHaveBeenCalledWith(expect.objectContaining({ created_by: 'local' }));
  });

  it('refuses to link a note to a customer that belongs to another account', async () => {
    localStorage.setItem('chemcheck_current_user', JSON.stringify({ email: 'tech@example.com' }));
    mockCustomersGet.mockResolvedValue({ id: 5, created_by: 'other@example.com' });
    const { result } = renderHook(() => useNoteCreate());

    await expect(result.current({ title: 'x', content: 'y', category: 'Customer', priority: 'low', customer_id: 5 }))
      .rejects.toThrow('Customer not found for this account');
    expect(mockNotesAdd).not.toHaveBeenCalled();

    mockCustomersGet.mockResolvedValue({ id: 5, created_by: 'tech@example.com' });
    await act(async () => {
      await result.current({ title: 'x', content: 'y', category: 'Customer', priority: 'low', customer_id: 5 });
    });
    expect(mockNotesAdd).toHaveBeenCalledWith(expect.objectContaining({ customer_id: 5, created_by: 'tech@example.com' }));
  });
});

describe('useServiceLogsByCustomerDateRange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServiceLogsWhere.mockReturnValue({ between: mockServiceLogsBetween });
    mockServiceLogsBetween.mockReturnValue({ reverse: mockServiceLogsReverse });
    mockServiceLogsReverse.mockReturnValue({ limit: mockServiceLogsLimit });
    mockServiceLogsLimit.mockReturnValue({ toArray: mockServiceLogsToArray });
    mockServiceLogsToArray.mockResolvedValue([
      { id: 41, customer_id: 7, service_date: '2026-07-20', ph: 'good' },
    ]);
  });

  it('uses the compound date index and limits the result before reading', async () => {
    await queryServiceLogsByCustomerDateRange(7, '2026-07-20', '2026-07-26', 1);

    expect(mockServiceLogsWhere).toHaveBeenCalledWith('[customer_id+service_date]');
    expect(mockServiceLogsBetween).toHaveBeenCalledWith(
      [7, '2026-07-20'],
      [7, '2026-07-26'],
      true,
      true
    );
    expect(mockServiceLogsReverse).toHaveBeenCalledTimes(1);
    expect(mockServiceLogsLimit).toHaveBeenCalledWith(1);
    expect(mockServiceLogsToArray).toHaveBeenCalledTimes(1);
  });
});
