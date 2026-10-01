import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getFunctionName } from 'convex/server';
import { ChemicalPricingSettings } from './ChemicalPricingSettings';

const { mockUseQuery, mocks } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mocks: { upsert: vi.fn(), remove: vi.fn(), seedDefaults: vi.fn() },
}));
vi.mock('convex/react', () => ({
  useQuery: (...args) => mockUseQuery(...args),
  useMutation: (ref) => mocks[getFunctionName(ref).split(':')[1]],
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const prices = [
  { _id: 'p1', chemical_type: 'liquid_chlorine', label: 'Liquid Chlorine', unit: 'gal', unit_price: 4.5 },
  { _id: 'p2', chemical_type: 'salt', label: 'Pool Salt', unit: 'bags', unit_price: 12, package_size: 40 },
];

describe('ChemicalPricingSettings', () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
    Object.values(mocks).forEach((fn) => fn.mockReset().mockResolvedValue({ inserted: 2, skipped: 0 }));
  });

  it('lists prices and lets managers seed defaults', async () => {
    mockUseQuery.mockReturnValue({ prices, can_manage: true, catalog: [] });
    render(<ChemicalPricingSettings />);
    const list = screen.getByRole('list', { name: 'Chemical prices' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('$4.50 per gal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Add common chemicals/ }));
    await waitFor(() => expect(mocks.seedDefaults).toHaveBeenCalledWith({}));
  });

  it('saves an edited row with parsed numbers', async () => {
    mockUseQuery.mockReturnValue({ prices, can_manage: true, catalog: [] });
    render(<ChemicalPricingSettings />);
    expect(screen.queryByRole('button', { name: 'Save Liquid Chlorine' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Price (USD)', { selector: '#price-p1-price' }), { target: { value: '5.25' } });
    fireEvent.change(screen.getByLabelText('Package size', { selector: '#price-p1-pkg-size' }), { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Liquid Chlorine' }));
    await waitFor(() => expect(mocks.upsert).toHaveBeenCalledWith({ chemical_type: 'Liquid Chlorine', unit: 'gal', unit_price: 5.25, package_size: 2.5, package_price: undefined }));
  });

  it('adds a new chemical with a family-inferred unit and removes rows', async () => {
    mockUseQuery.mockReturnValue({ prices, can_manage: true, catalog: [] });
    render(<ChemicalPricingSettings />);
    fireEvent.change(screen.getByLabelText('Chemical'), { target: { value: 'Chlorine Tablets' } });
    expect(screen.getByLabelText('Unit', { selector: '#new-price-unit' })).toHaveValue('tabs');
    fireEvent.change(screen.getByLabelText('Price (USD)', { selector: '#new-price-price' }), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(mocks.upsert).toHaveBeenCalledWith({ chemical_type: 'Chlorine Tablets', unit: 'tabs', unit_price: 3, package_size: undefined, package_price: undefined }));

    fireEvent.click(screen.getByRole('button', { name: 'Remove Pool Salt' }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ id: 'p2' }));
  });

  it('is read-only for non-managers and shows an empty state', () => {
    mockUseQuery.mockReturnValue({ prices: [], can_manage: false, catalog: [] });
    render(<ChemicalPricingSettings />);
    expect(screen.queryByRole('button', { name: /Add common chemicals/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByText(/Ask the account owner/)).toBeInTheDocument();
  });
});
