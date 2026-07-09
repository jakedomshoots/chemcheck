type RouteCustomer = {
  _id?: string | number;
  id?: string | number;
  full_name?: string;
  address?: string;
  sort_order?: number;
  [key: string]: unknown;
};

/**
 * Builds a transparent, deterministic route plan from the order the business
 * has already saved. ChemCheck does not claim road distance or ETA until it
 * has a validated routing provider and real geocodes.
 */
export function buildManualRouteStops(customers: RouteCustomer[]) {
  return [...customers]
    .sort((a, b) => {
      const leftOrder = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : Number.MAX_SAFE_INTEGER;
      const rightOrder = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return String(a.full_name || '').localeCompare(String(b.full_name || ''));
    })
    .map((customer, index) => ({
      position: index + 1,
      customer_name: String(customer.full_name || 'Unnamed customer'),
      customer_address: String(customer.address || 'No address on file'),
      customer,
    }));
}
