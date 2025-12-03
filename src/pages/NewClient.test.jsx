import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import NewClient from './NewClient';
import { BrowserRouter } from 'react-router-dom';

// Mock stable data
const mockUser = { email: 'test@example.com' };
const mockCreateCustomer = vi.fn();

// Mock hooks
vi.mock('@/api/convexHooks', () => ({
    useCurrentUser: () => mockUser,
    useCustomerCreate: () => mockCreateCustomer
}));

// Mock utils
vi.mock('@/utils', () => ({
    createPageUrl: (page) => `/page/${page}`
}));

// Mock toast
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() }
}));

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => vi.fn()
    };
});

describe('New Client Page', () => {
    it('renders the new client form', () => {
        render(<BrowserRouter><NewClient /></BrowserRouter>);
        expect(screen.getByRole('heading', { name: /New Client/i })).toBeInTheDocument();
        expect(screen.getByText(/Full Name/i)).toBeInTheDocument();
        expect(screen.getByText(/Service Address/i)).toBeInTheDocument();
    });
});
