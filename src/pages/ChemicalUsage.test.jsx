import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ChemicalUsage from './ChemicalUsage';
import { BrowserRouter } from 'react-router-dom';

// Mock stable data
const mockUser = { email: 'test@example.com' };
const mockUsage = [
    { _id: 'u1', chemical_type: 'chlorine_tabs', amount: '2', customer_id: 'c1', created_at: '2023-01-01' }
];
const mockCustomers = [
    { _id: 'c1', full_name: 'Alice Smith' }
];
const mockRemoveChemicalUsage = vi.fn();

// Mock hooks
vi.mock('@/api/convexHooks', () => ({
    useCurrentUser: () => mockUser,
    useChemicalUsage: () => mockUsage,
    useCustomersFilter: () => mockCustomers,
    useChemicalUsageDelete: () => mockRemoveChemicalUsage
}));

// Mock utils
vi.mock('@/utils', () => ({
    createPageUrl: (page) => `/page/${page}`
}));

// Mock toast
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() }
}));

// Mock child components
vi.mock('../components/chemical/ChemicalUsageCard', () => ({
    default: ({ usage, customerName }) => (
        <div>
            {usage.chemical_type}
            <span>{customerName}</span>
        </div>
    )
}));

describe('Chemical Usage Page', () => {
    it('renders usage list', () => {
        render(<BrowserRouter><ChemicalUsage /></BrowserRouter>);
        expect(screen.getByRole('heading', { name: /Chemical Usage/i })).toBeInTheDocument();
        expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
});
