import { describe, expect, it } from 'vitest';
import { buildManualRouteStops } from './manualRoutePlan';

describe('manual route planning', () => {
  it('uses the saved service order and never invents travel estimates', () => {
    const stops = buildManualRouteStops([
      { _id: 2, full_name: 'Second Pool', address: '2 Main St', sort_order: 2, gate_code: '1234' },
      { _id: 1, full_name: 'First Pool', address: '1 Main St', sort_order: 1, gate_code: '5678' },
    ]);

    expect(stops.map((stop) => stop.customer_name)).toEqual(['First Pool', 'Second Pool']);
    expect(stops.map((stop) => stop.position)).toEqual([1, 2]);
    expect(stops.every((stop) => !('estimated_travel_time_from_previous' in stop))).toBe(true);
    expect(stops.every((stop) => !('notes' in stop))).toBe(true);
  });

  it('keeps equal saved positions deterministic without mutating the source list', () => {
    const customers = [
      { _id: 2, full_name: 'Bravo', address: '2 Main St', sort_order: 1 },
      { _id: 1, full_name: 'Alpha', address: '1 Main St', sort_order: 1 },
    ];

    expect(buildManualRouteStops(customers).map((stop) => stop.customer_name)).toEqual(['Alpha', 'Bravo']);
    expect(customers.map((customer) => customer.full_name)).toEqual(['Bravo', 'Alpha']);
  });
});
