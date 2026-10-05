import 'fake-indexeddb/auto';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import { db } from '@/db/chemcheck-db';
import { useCustomerCreate, useCustomerUpdate } from '@/api/dexieHooks';
import Clients from './Clients';

vi.mock('convex/react', () => ({ useQuery: () => undefined }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const base = (name, day = 'Monday') => ({
  full_name: name,
  address: `${name} St`,
  service_day: day,
  pool_type: 'Chlorine',
  surface_type: 'Plaster',
});

async function createCustomer(data) {
  const { result } = renderHook(() => useCustomerCreate());
  let id;
  await act(async () => { id = await result.current(data); });
  return id;
}

async function updateCustomer(data) {
  const { result } = renderHook(() => useCustomerUpdate());
  await act(async () => { await result.current(data); });
}

async function dayOrder(day) {
  const rows = await db.customers.where('service_day').equals(day).toArray();
  return rows
    .sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity))
    .map((row) => `${row.full_name}:${row.sort_order}`);
}

async function waitForRows(expected) {
  await waitFor(() => {
    const names = screen.getAllByTestId(/client-list-item-/).map((row) => row.textContent);
    expected.forEach((name, index) => expect(names[index]).toContain(name));
    expect(names).toHaveLength(expected.length);
  });
}

describe('customer ordering against a real local database', () => {
  beforeEach(async () => {
    localStorage.clear();
    await db.withoutSyncHooks(async () => {
      await Promise.all([db.customers.clear(), db.pools.clear()]);
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('adding a client never moves the clients that are already ordered', async () => {
    await createCustomer(base('Alice'));
    await createCustomer(base('Bob'));
    await createCustomer(base('Cora'));

    render(<BrowserRouter><Clients /></BrowserRouter>);
    await waitForRows(['Alice', 'Bob', 'Cora']);

    fireEvent.click(screen.getByRole('button', { name: /Reorder/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Cora up' }));
    await waitForRows(['Alice', 'Cora', 'Bob']);
    await waitFor(async () => expect(await dayOrder('Monday')).toEqual(['Alice:0', 'Cora:1', 'Bob:2']));
    fireEvent.click(screen.getByRole('button', { name: 'Move Cora up' }));
    await waitForRows(['Cora', 'Alice', 'Bob']);
    await waitFor(async () => expect(await dayOrder('Monday')).toEqual(['Cora:0', 'Alice:1', 'Bob:2']));

    await createCustomer(base('Dana'));
    await waitForRows(['Cora', 'Alice', 'Bob', 'Dana']);
    await waitFor(async () => expect(await dayOrder('Monday')).toEqual(['Cora:0', 'Alice:1', 'Bob:2', 'Dana:3']));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Move Dana up' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Move Dana up' }));
    await waitForRows(['Cora', 'Alice', 'Dana', 'Bob']);
    await waitFor(async () => expect(await dayOrder('Monday')).toEqual(['Cora:0', 'Alice:1', 'Dana:2', 'Bob:3']));
  });

  it('adding a client after a gap in sort orders appends it to the end', async () => {
    const alice = await createCustomer(base('Alice'));
    const bob = await createCustomer(base('Bob'));
    await createCustomer(base('Cora'));
    // Simulate a day whose orders have a gap and a stale duplicate (as left by
    // older builds or a deleted neighbour): Alice 0, Bob 5, Cora 5.
    await updateCustomer({ id: bob, sort_order: 5 });
    const cora = (await db.customers.toArray()).find((row) => row.full_name === 'Cora');
    await updateCustomer({ id: cora.id, sort_order: 5 });
    expect(alice).toBeTruthy();

    render(<BrowserRouter><Clients /></BrowserRouter>);
    await waitForRows(['Alice', 'Bob', 'Cora']);

    await createCustomer(base('Dana'));
    await waitForRows(['Alice', 'Bob', 'Cora', 'Dana']);
  });

  it('moving a client to another day appends it there and closes the gap it left', async () => {
    await createCustomer(base('Alice'));
    const bob = await createCustomer(base('Bob'));
    await createCustomer(base('Cora'));
    await createCustomer(base('Tue One', 'Tuesday'));
    await createCustomer(base('Tue Two', 'Tuesday'));

    await updateCustomer({ id: bob, service_day: 'Tuesday' });

    await waitFor(async () => expect(await dayOrder('Tuesday')).toEqual(['Tue One:0', 'Tue Two:1', 'Bob:2']));

    render(<BrowserRouter><Clients /></BrowserRouter>);
    await waitForRows(['Alice', 'Cora']);
    await waitFor(async () => expect(await dayOrder('Monday')).toEqual(['Alice:0', 'Cora:1']));
  });
});
