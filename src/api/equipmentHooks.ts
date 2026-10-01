/**
 * Equipment-aware stop.
 *
 * Composes the normalized pool/equipment hooks into one read for the service
 * log, plus pure helpers that classify equipment and build the stop checklist.
 */

import { useMemo } from 'react';
import { useEquipmentByPool, usePoolsByCustomer } from '@/api/normalizedHooks';
import type { Equipment, Pool } from '@/db/chemcheck-db';

export type PoolRecord = Pool & { _id?: number };
export type EquipmentRecord = Equipment & { _id?: number };

export type FilterKind = 'cartridge' | 'de' | 'sand' | 'unknown';

export interface EquipmentClassification {
  filter: EquipmentRecord | null;
  filterKind: FilterKind | null;
  saltCell: EquipmentRecord | null;
  heater: EquipmentRecord | null;
  pump: EquipmentRecord | null;
  other: EquipmentRecord[];
  hasAny: boolean;
}

export interface StopTask {
  id: string;
  label: string;
  detail?: string;
  /** Which piece of equipment produced this task, when any. */
  source: 'filter' | 'salt-cell' | 'heater' | 'pump' | 'generic';
}

export interface ActivePoolEquipment {
  pool: PoolRecord | null;
  pools: PoolRecord[];
  equipment: EquipmentRecord[];
  classification: EquipmentClassification;
}

/** Default cartridge-cleaning cadence used by the checklist copy. */
export const CARTRIDGE_CLEAN_WEEKS = 4;

function text(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function isRetired(item: EquipmentRecord): boolean {
  const status = text(item.status);
  return status === 'retired' || status === 'removed' || status === 'inactive';
}

/**
 * Picks the pool the service log should act on: active pools first, then
 * the lowest sort order, then the oldest record.
 */
export function selectActivePool<T extends Pick<Pool, 'id' | 'active' | 'sort_order'>>(pools: T[] | undefined | null): T | null {
  if (!pools || pools.length === 0) return null;
  const sorted = [...pools].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    const orderA = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return (a.id ?? 0) - (b.id ?? 0);
  });
  return sorted[0];
}

export function detectFilterKind(item: Pick<Equipment, 'name' | 'model' | 'notes' | 'equipment_type'>): FilterKind {
  const haystack = `${text(item.name)} ${text(item.model)} ${text(item.notes)} ${text(item.equipment_type)}`;
  if (/cartridge|cart\b|element/.test(haystack)) return 'cartridge';
  if (/\bd\.?e\.?\b|diatom|grid/.test(haystack)) return 'de';
  if (/sand|glass media/.test(haystack)) return 'sand';
  return 'unknown';
}

function matches(item: EquipmentRecord, typePattern: RegExp, namePattern: RegExp = typePattern): boolean {
  return typePattern.test(text(item.equipment_type)) || namePattern.test(text(item.name));
}

export function classifyEquipment(equipment: EquipmentRecord[] | undefined | null): EquipmentClassification {
  const active = (equipment || []).filter((item) => !isRetired(item));
  const used = new Set<EquipmentRecord>();
  const pick = (typePattern: RegExp, namePattern?: RegExp) => {
    const found = active.find((item) => !used.has(item) && matches(item, typePattern, namePattern));
    if (found) used.add(found);
    return found ?? null;
  };

  const filter = pick(/filter/, /filter/);
  const saltCell = pick(/salt|swg|chlorinator|cell/, /salt cell|salt system|swg|chlorinator|cell/);
  const heater = pick(/heat/, /heater|heat pump/);
  const pump = pick(/pump/, /\bpump\b/);
  const other = active.filter((item) => !used.has(item));

  return {
    filter,
    filterKind: filter ? detectFilterKind(filter) : null,
    saltCell,
    heater,
    pump,
    other,
    hasAny: active.length > 0,
  };
}

export interface BuildStopChecklistInput {
  classification: EquipmentClassification;
  poolType?: string | null;
  cartridgeCleanWeeks?: number;
}

/**
 * Builds the stop checklist from the recorded equipment. With no equipment on
 * file it returns a generic list so the technician still has a routine.
 */
export function buildStopChecklist(input: BuildStopChecklistInput): StopTask[] {
  const { classification, poolType } = input;
  const weeks = input.cartridgeCleanWeeks ?? CARTRIDGE_CLEAN_WEEKS;
  const saltPool = typeof poolType === 'string' && poolType.trim().toLowerCase() === 'salt';
  const tasks: StopTask[] = [
    { id: 'skim', label: 'Skim surface and empty baskets', source: 'generic' },
    { id: 'brush', label: 'Brush walls, steps and tile line', source: 'generic' },
    { id: 'test', label: 'Test water and log readings', source: 'generic' },
  ];

  if (!classification.hasAny) {
    tasks.push({ id: 'filter-generic', label: 'Check filter pressure; clean or backwash if 8–10 psi over clean', source: 'generic' });
    if (saltPool) {
      tasks.push({ id: 'salt-cell-generic', label: 'Inspect salt cell for scale and check the salt reading', source: 'generic' });
    }
    tasks.push({ id: 'equipment-generic', label: 'Look over pump, heater and plumbing for leaks or noise', source: 'generic' });
    return tasks;
  }

  if (classification.filter) {
    switch (classification.filterKind) {
      case 'cartridge':
        tasks.push({
          id: 'filter-cartridge',
          label: `Clean cartridge (every ${weeks} weeks)`,
          detail: 'Hose the pleats top to bottom; replace when pleats stay flattened or pressure climbs right after cleaning.',
          source: 'filter',
        });
        break;
      case 'de':
        tasks.push({
          id: 'filter-de',
          label: 'Backwash D.E. filter and recharge with fresh D.E.',
          detail: 'Backwash when pressure is 8–10 psi over clean; add D.E. through the skimmer with the pump running.',
          source: 'filter',
        });
        break;
      case 'sand':
        tasks.push({
          id: 'filter-sand',
          label: 'Backwash sand filter',
          detail: 'Backwash until the sight glass runs clear, then rinse 30 seconds before returning to filter.',
          source: 'filter',
        });
        break;
      default:
        tasks.push({
          id: 'filter-unknown',
          label: 'Check filter pressure; clean or backwash if 8–10 psi over clean',
          detail: 'Record the filter type on the equipment card to get type-specific steps.',
          source: 'filter',
        });
    }
  } else {
    tasks.push({ id: 'filter-generic', label: 'Check filter pressure; clean or backwash if 8–10 psi over clean', source: 'generic' });
  }

  if (classification.saltCell || saltPool) {
    tasks.push({
      id: 'salt-cell',
      label: 'Inspect salt cell and log the salt reading',
      detail: 'Look for scale on the plates; acid-wash only if scale is visible. Confirm the cell is generating.',
      source: classification.saltCell ? 'salt-cell' : 'generic',
    });
  }

  if (classification.heater) {
    tasks.push({
      id: 'heater',
      label: 'Check heater',
      detail: 'Confirm it fires, listen for ignition faults, and check the bypass and pressure switch.',
      source: 'heater',
    });
  }

  if (classification.pump) {
    tasks.push({
      id: 'pump',
      label: 'Check pump and lid o-ring',
      detail: 'Prime, listen for cavitation, and look for drips at the lid and shaft seal.',
      source: 'pump',
    });
  }

  return tasks;
}

/**
 * Pool + equipment for the customer's active pool. Reads the normalized Dexie
 * tables live, so the strip updates as soon as equipment is added.
 */
export function useActivePoolEquipment(customerId?: number | null): ActivePoolEquipment {
  const pools = usePoolsByCustomer(customerId || undefined) as PoolRecord[];
  const pool = useMemo(() => selectActivePool(pools), [pools]);
  const equipment = useEquipmentByPool(pool?.id) as EquipmentRecord[];
  const classification = useMemo(() => classifyEquipment(equipment), [equipment]);
  return useMemo(() => ({ pool, pools, equipment, classification }), [pool, pools, equipment, classification]);
}
