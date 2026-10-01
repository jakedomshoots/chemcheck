import 'fake-indexeddb/auto';
import { renderHook, waitFor } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/chemcheck-db';
import {
  buildStopChecklist,
  classifyEquipment,
  detectFilterKind,
  selectActivePool,
  useActivePoolEquipment,
  type EquipmentRecord,
} from './equipmentHooks';

const item = (overrides: Partial<EquipmentRecord>): EquipmentRecord => ({
  customer_id: 1,
  pool_id: 1,
  equipment_type: 'other',
  name: 'Thing',
  status: 'active',
  sync_status: 'synced',
  local_updated_at: 1,
  ...overrides,
});

describe('selectActivePool', () => {
  it('prefers active pools, then the lowest sort order', () => {
    const pools = [
      { id: 3, customer_id: 1, name: 'Spa', service_day: 'Monday', pool_type: 'Chlorine', surface_type: 'Plaster', active: false, sort_order: 0 },
      { id: 2, customer_id: 1, name: 'Lap', service_day: 'Monday', pool_type: 'Chlorine', surface_type: 'Plaster', active: true, sort_order: 2 },
      { id: 1, customer_id: 1, name: 'Main', service_day: 'Monday', pool_type: 'Salt', surface_type: 'Plaster', active: true, sort_order: 1 },
    ];
    expect(selectActivePool(pools)?.id).toBe(1);
    expect(selectActivePool([])).toBeNull();
    expect(selectActivePool(undefined)).toBeNull();
  });
});

describe('classifyEquipment', () => {
  it('finds filter, salt cell, heater and pump by type or name and skips retired items', () => {
    const classification = classifyEquipment([
      item({ id: 1, equipment_type: 'filter', name: 'Cartridge' }),
      item({ id: 2, equipment_type: 'chlorinator', name: 'Hayward AquaRite' }),
      item({ id: 3, equipment_type: 'other', name: 'Raypak Heater' }),
      item({ id: 4, equipment_type: 'pump', name: 'Pentair VS' }),
      item({ id: 5, equipment_type: 'cleaner', name: 'Polaris' }),
      item({ id: 6, equipment_type: 'heater', name: 'Old heater', status: 'retired' }),
    ]);
    expect(classification.filter?.id).toBe(1);
    expect(classification.filterKind).toBe('cartridge');
    expect(classification.saltCell?.id).toBe(2);
    expect(classification.heater?.id).toBe(3);
    expect(classification.pump?.id).toBe(4);
    expect(classification.other.map((entry) => entry.id)).toEqual([5]);
    expect(classification.hasAny).toBe(true);
  });

  it('reports no equipment for an empty list', () => {
    const classification = classifyEquipment([]);
    expect(classification.hasAny).toBe(false);
    expect(classification.filter).toBeNull();
    expect(classification.filterKind).toBeNull();
  });

  it('detects filter kinds from name, model or notes', () => {
    expect(detectFilterKind({ equipment_type: 'filter', name: 'D.E.' })).toBe('de');
    expect(detectFilterKind({ equipment_type: 'filter', name: 'Filter', model: 'Pentair Sand Dollar' })).toBe('sand');
    expect(detectFilterKind({ equipment_type: 'filter', name: 'Filter', notes: 'Clean cartridge element monthly' })).toBe('cartridge');
    expect(detectFilterKind({ equipment_type: 'filter', name: 'Filter' })).toBe('unknown');
  });
});

describe('buildStopChecklist', () => {
  it('gives cartridge filters a cleaning cadence instead of a backwash', () => {
    const tasks = buildStopChecklist({
      classification: classifyEquipment([item({ equipment_type: 'filter', name: 'Cartridge' })]),
      poolType: 'Chlorine',
    });
    const labels = tasks.map((task) => task.label);
    expect(labels).toContain('Clean cartridge (every 4 weeks)');
    expect(labels.some((label) => /backwash/i.test(label))).toBe(false);
    expect(labels.some((label) => /salt cell/i.test(label))).toBe(false);
    expect(labels.some((label) => /heater/i.test(label))).toBe(false);
  });

  it('respects a custom cartridge cadence', () => {
    const tasks = buildStopChecklist({
      classification: classifyEquipment([item({ equipment_type: 'filter', name: 'Cartridge' })]),
      cartridgeCleanWeeks: 6,
    });
    expect(tasks.map((task) => task.label)).toContain('Clean cartridge (every 6 weeks)');
  });

  it('tells D.E. and sand filters to backwash', () => {
    const de = buildStopChecklist({ classification: classifyEquipment([item({ equipment_type: 'filter', name: 'D.E.' })]) });
    expect(de.find((task) => task.source === 'filter')?.label).toMatch(/Backwash D\.E\./);
    const sand = buildStopChecklist({ classification: classifyEquipment([item({ equipment_type: 'filter', name: 'Sand' })]) });
    expect(sand.find((task) => task.source === 'filter')?.label).toBe('Backwash sand filter');
  });

  it('adds salt cell, heater and pump tasks from the equipment on file', () => {
    const tasks = buildStopChecklist({
      classification: classifyEquipment([
        item({ equipment_type: 'salt cell', name: 'AquaRite' }),
        item({ equipment_type: 'heater', name: 'Raypak' }),
        item({ equipment_type: 'pump', name: 'VS pump' }),
      ]),
      poolType: 'Salt',
    });
    expect(tasks.map((task) => task.id)).toEqual(['skim', 'brush', 'test', 'filter-generic', 'salt-cell', 'heater', 'pump']);
    expect(tasks.find((task) => task.id === 'salt-cell')?.source).toBe('salt-cell');
  });

  it('falls back to a generic checklist when nothing is recorded', () => {
    const chlorine = buildStopChecklist({ classification: classifyEquipment([]), poolType: 'Chlorine' });
    expect(chlorine.every((task) => task.source === 'generic')).toBe(true);
    expect(chlorine.map((task) => task.id)).toEqual(['skim', 'brush', 'test', 'filter-generic', 'equipment-generic']);

    const salt = buildStopChecklist({ classification: classifyEquipment([]), poolType: 'Salt' });
    expect(salt.map((task) => task.id)).toContain('salt-cell-generic');
  });
});

describe('useActivePoolEquipment', () => {
  beforeEach(async () => {
    await db.equipment.clear();
    await db.pools.clear();
  });

  afterAll(() => {
    db.close();
  });

  it('returns the active pool and its equipment for the customer', async () => {
    const inactive = await db.pools.add({
      customer_id: 7, name: 'Spa', service_day: 'Monday', pool_type: 'Chlorine', surface_type: 'Plaster',
      active: false, sort_order: 0, sync_status: 'synced', local_updated_at: 1,
    });
    const active = await db.pools.add({
      customer_id: 7, name: 'Main', service_day: 'Monday', pool_type: 'Salt', surface_type: 'Plaster',
      active: true, sort_order: 1, sync_status: 'synced', local_updated_at: 1,
    });
    await db.equipment.add({
      customer_id: 7, pool_id: active as number, equipment_type: 'filter', name: 'Cartridge', status: 'active',
      sync_status: 'synced', local_updated_at: 1,
    });
    await db.equipment.add({
      customer_id: 7, pool_id: inactive as number, equipment_type: 'heater', name: 'Spa heater', status: 'active',
      sync_status: 'synced', local_updated_at: 1,
    });

    const { result } = renderHook(() => useActivePoolEquipment(7));
    await waitFor(() => expect(result.current.pool?.id).toBe(active));
    await waitFor(() => expect(result.current.equipment).toHaveLength(1));
    expect(result.current.pools).toHaveLength(2);
    expect(result.current.equipment[0]).toMatchObject({ name: 'Cartridge', _id: expect.any(Number) });
    expect(result.current.classification.filterKind).toBe('cartridge');
    expect(result.current.classification.heater).toBeNull();
  });

  it('returns empty data without a customer id', async () => {
    const { result } = renderHook(() => useActivePoolEquipment(undefined));
    await waitFor(() => expect(result.current.pools).toEqual([]));
    expect(result.current.pool).toBeNull();
    expect(result.current.equipment).toEqual([]);
    expect(result.current.classification.hasAny).toBe(false);
  });
});
