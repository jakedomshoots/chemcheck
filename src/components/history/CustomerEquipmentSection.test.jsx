import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/chemcheck-db';
import CustomerEquipmentSection, { optionForEquipment, toEquipmentRecord } from './CustomerEquipmentSection';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const customer = { _id: 42, full_name: 'Alice', service_day: 'Tuesday', pool_type: 'Salt', surface_type: 'Plaster', pool_gallons: 15000 };

beforeEach(async () => {
  await db.equipment.clear();
  await db.pools.clear();
  window.history.replaceState({}, '', '/customerdetail?id=42');
});

afterAll(() => db.close());

describe('equipment form mapping', () => {
  it('stores filters as equipment_type filter with the kind in the name', () => {
    expect(toEquipmentRecord({ type: 'filter:de', name: '', brand: '', model: '', install_date: '', notes: '', status: 'active' }))
      .toMatchObject({ equipment_type: 'filter', name: 'D.E. filter', status: 'active' });
    expect(toEquipmentRecord({ type: 'filter:cartridge', name: 'Clean & Clear', brand: ' Pentair ', model: 'CCP420', install_date: '2025-05-01', notes: '', status: 'needs service' }))
      .toEqual({ equipment_type: 'filter', name: 'Cartridge filter (Clean & Clear)', brand: 'Pentair', model: 'CCP420', install_date: '2025-05-01', notes: undefined, status: 'needs service' });
    expect(toEquipmentRecord({ type: 'filter:sand', name: 'Sand Dollar', brand: '', model: '', install_date: '', notes: '', status: 'active' }).name).toBe('Sand Dollar');
    expect(toEquipmentRecord({ type: 'salt cell', name: '', brand: '', model: '', install_date: '', notes: '', status: 'active' }))
      .toMatchObject({ equipment_type: 'salt cell', name: 'Salt cell' });
  });

  it('maps stored equipment back to the select option', () => {
    expect(optionForEquipment({ equipment_type: 'filter', name: 'Cartridge' })).toBe('filter:cartridge');
    expect(optionForEquipment({ equipment_type: 'filter', name: 'Filter', model: 'Sand Dollar' })).toBe('filter:sand');
    expect(optionForEquipment({ equipment_type: 'heater', name: 'Raypak' })).toBe('heater');
    expect(optionForEquipment({ equipment_type: 'cleaner', name: 'Polaris' })).toBe('other');
  });
});

describe('CustomerEquipmentSection', () => {
  it('creates a default pool and adds equipment when the customer has none', async () => {
    render(<CustomerEquipmentSection customer={customer} />);
    expect(screen.getByText(/No pool on file yet · nothing recorded/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add equipment' }));
    const form = screen.getByRole('form', { name: 'Add equipment' });
    fireEvent.change(within(form).getByLabelText('Type *'), { target: { value: 'filter:cartridge' } });
    fireEvent.change(within(form).getByLabelText('Brand'), { target: { value: 'Pentair' } });
    fireEvent.change(within(form).getByLabelText('Model'), { target: { value: 'CCP420' } });
    fireEvent.change(within(form).getByLabelText('Install date'), { target: { value: '2025-05-01' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add equipment' }));

    await waitFor(async () => expect(await db.pools.count()).toBe(1));
    const pool = (await db.pools.toArray())[0];
    expect(pool).toMatchObject({ customer_id: 42, name: 'Main pool', service_day: 'Tuesday', pool_type: 'Salt', surface_type: 'Plaster', pool_gallons: 15000, active: true });
    await waitFor(async () => expect(await db.equipment.count()).toBe(1));
    expect((await db.equipment.toArray())[0]).toMatchObject({ customer_id: 42, pool_id: pool.id, equipment_type: 'filter', name: 'Cartridge filter', brand: 'Pentair', model: 'CCP420', install_date: '2025-05-01', status: 'active' });

    const list = await screen.findByRole('list', { name: 'Equipment list' });
    expect(within(list).getByText('Cartridge filter')).toBeInTheDocument();
    expect(within(list).getByText(/Filter — cartridge · Pentair CCP420 · installed 2025-05-01/)).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it('lists the active pool equipment and edits an item inline', async () => {
    const poolId = await db.pools.add({ customer_id: 42, name: 'Backyard', service_day: 'Tuesday', pool_type: 'Salt', surface_type: 'Plaster', active: true, sort_order: 0, sync_status: 'synced', local_updated_at: 1 });
    const heaterId = await db.equipment.add({ customer_id: 42, pool_id: poolId, equipment_type: 'heater', name: 'Raypak 266', brand: 'Raypak', status: 'active', sync_status: 'synced', local_updated_at: 1 });

    render(<CustomerEquipmentSection customer={customer} />);
    const list = await screen.findByRole('list', { name: 'Equipment list' });
    expect(within(list).getByText('Raypak 266')).toBeInTheDocument();
    expect(screen.getByText(/Backyard · 1 item/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Raypak 266' }));
    const form = screen.getByRole('form', { name: 'Edit equipment' });
    expect(within(form).getByLabelText('Type *')).toHaveValue('heater');
    fireEvent.change(within(form).getByLabelText('Status'), { target: { value: 'needs service' } });
    fireEvent.change(within(form).getByLabelText('Notes'), { target: { value: 'Ignition fault code' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }));

    await waitFor(async () => expect((await db.equipment.get(heaterId))?.status).toBe('needs service'));
    expect((await db.equipment.get(heaterId))?.notes).toBe('Ignition fault code');
    expect(await db.pools.count()).toBe(1);
    await waitFor(() => expect(screen.getByText('needs service')).toBeInTheDocument());
  });

  it('opens the add form and scrolls into view when deep-linked with #equipment', async () => {
    window.history.replaceState({}, '', '/customerdetail?id=42#equipment');
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<CustomerEquipmentSection customer={customer} />);
    expect(screen.getByRole('form', { name: 'Add equipment' })).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
