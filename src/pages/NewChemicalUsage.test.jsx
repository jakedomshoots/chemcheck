import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import NewChemicalUsage from './NewChemicalUsage';
import { BrowserRouter } from 'react-router-dom';

// Mock stable data
const mockUser = { email: 'test@example.com' };
const mockCustomers = [{ _id: 1, full_name: 'Alice Smith' }];
const mockCreateChemicalUsage = vi.fn();

// Mock hooks
vi.mock('@/api/convexHooks', () => ({
    useCurrentUser: () => mockUser,
    useCustomersFilter: () => mockCustomers,
    useChemicalUsageCreate: () => mockCreateChemicalUsage
}));

// Mock utils
vi.mock('@/utils', () => ({
    createPageUrl: (page) => `/page/${page}`
}));

// Mock toast
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() }
}));

vi.mock('convex/react', () => ({
    useQuery: () => ({ settings: { chemical_types: ['Liquid Chlorine'] } })
}));

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => vi.fn()
    };
});

describe('New Chemical Usage Page', () => {
    it('renders the form', () => {
        window.history.pushState({}, 'Test Page', '/?customerId=1');
        render(<BrowserRouter><NewChemicalUsage /></BrowserRouter>);
        expect(screen.getByRole('heading', { name: /Add Chemical Usage/i })).toBeInTheDocument();
        expect(screen.getAllByText(/Alice Smith/i).length).toBeGreaterThan(0);
    });
});
