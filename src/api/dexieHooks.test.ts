import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { useCustomerCreate, useServiceLogs } from './dexieHooks';
import { clearActiveTenantScope, setActiveTenantScope } from '@/lib/tenantScope';

const mockCustomersToArray = vi.hoisted(() => vi.fn());
const mockCustomersAdd = vi.hoisted(() => vi.fn());
const mockValidateCustomer = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockServiceLogsSortBy = vi.hoisted(() => vi.fn());
const mockServiceLogsFilter = vi.hoisted(() => vi.fn());
const mockServiceLogsWhere = vi.hoisted(() => vi.fn());
const mockServiceLogsEquals = vi.hoisted(() => vi.fn());

vi.mock('dexie-react-hooks', async () => {
  const React = await vi.importActual('react');
  return {
    useLiveQuery: (query, dependencies, defaultValue) => {
      const [value, setValue] = React.useState(defaultValue);
      React.useEffect(() => {
        void query().then(setValue);
      }, dependencies);
      return value;
    },
  };
});

vi.mock('@/db/chemcheck-db', () => ({
  db: {
    customers: {
      toArray: mockCustomersToArray,
      add: mockCustomersAdd,
    },
    serviceLogs: {
      where: mockServiceLogsWhere,
    },
  },
  getTimestamp: vi.fn(() => '2026-03-24T09:00:00.000Z'),
  getTodayDate: vi.fn(() => '2026-03-24'),
}));

vi.mock('@/lib/validation', () => ({
  validateCustomer: mockValidateCustomer,
  validateServiceLog: vi.fn(() => ({ success: false, errors: ['not mocked'] })),
  validateChemicalUsage: vi.fn(() => ({ success: false, errors: ['not mocked'] })),
  validateNote: vi.fn(() => ({ success: false, errors: ['not mocked'] })),
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock('@/lib/monitoring', () => ({
  measureDatabaseOperation: (name, fn) => fn(),
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
    setActiveTenantScope({ userEmail: 'owner@chemcheck.test', businessId: 'business_test' });
    mockCheckRateLimit.mockReturnValue({ allowed: true });
    mockValidateCustomer.mockImplementation((data) => ({ success: true, data }));
  });

  afterEach(() => clearActiveTenantScope());

  it('assigns a default sort_order when omitted, based on the current service day count', async () => {
    mockCustomersToArray.mockResolvedValue([
      { id: 1, tenant_id: 'business_test:owner@chemcheck.test', created_by: 'owner@chemcheck.test', service_day: 'Monday', sort_order: 0 },
      { id: 2, tenant_id: 'business_test:owner@chemcheck.test', created_by: 'owner@chemcheck.test', service_day: 'Tuesday', sort_order: 0 },
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
        tenant_id: 'business_test:owner@chemcheck.test',
        created_by: 'owner@chemcheck.test',
        createdAt: '2026-03-24T09:00:00.000Z',
        updatedAt: '2026-03-24T09:00:00.000Z',
        sync_status: 'pending',
      })
    );
  });

  it('assigns the next position for subsequent customers on the same service day', async () => {
    mockCustomersToArray.mockResolvedValue([
      { id: 1, tenant_id: 'business_test:owner@chemcheck.test', created_by: 'owner@chemcheck.test', service_day: 'Monday', sort_order: 0 },
      { id: 2, tenant_id: 'business_test:owner@chemcheck.test', created_by: 'owner@chemcheck.test', service_day: 'Monday', sort_order: 2 },
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

describe('useServiceLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActiveTenantScope({ userEmail: 'owner@chemcheck.test', businessId: 'business_test' });
    mockServiceLogsWhere.mockReturnValue({ equals: mockServiceLogsEquals });
    mockServiceLogsEquals.mockReturnValue({ filter: mockServiceLogsFilter });
    mockServiceLogsFilter.mockReturnValue({ sortBy: mockServiceLogsSortBy });
  });

  afterEach(() => clearActiveTenantScope());

  it('awaits Dexie sorting before reversing and limiting service history', async () => {
    mockServiceLogsSortBy.mockResolvedValue([
      { id: 1, service_date: '2026-01-01' },
      { id: 2, service_date: '2026-01-02' },
      { id: 3, service_date: '2026-01-03' },
    ]);

    const { result } = renderHook(() => useServiceLogs('-service_date', 2));

    await waitFor(() => expect(result.current.map((log) => log.id)).toEqual([3, 2]));
    expect(mockServiceLogsSortBy).toHaveBeenCalledWith('service_date');
  });
});
