import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCustomerCreate } from './dexieHooks';

const mockCustomersToArray = vi.hoisted(() => vi.fn());
const mockCustomersAdd = vi.hoisted(() => vi.fn());
const mockValidateCustomer = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock('@/db/chemcheck-db', () => ({
  db: {
    customers: {
      toArray: mockCustomersToArray,
      add: mockCustomersAdd,
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
    mockCheckRateLimit.mockReturnValue({ allowed: true });
    mockValidateCustomer.mockImplementation((data) => ({ success: true, data }));
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
