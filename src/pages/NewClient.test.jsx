import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import NewClient from './NewClient';
import { BrowserRouter } from 'react-router-dom';

// Mock stable data
const mockUser = { email: 'test@example.com' };
const mockCreateCustomer = vi.fn();
const mockNavigate = vi.fn();

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
        useNavigate: () => mockNavigate
    };
});

describe('New Client Page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateCustomer.mockResolvedValue({ _id: 123 });
        window.history.replaceState({}, 'Home', '/home');
        window.history.pushState({}, 'New Client', '/newclient');
    });

    it('renders the new client form', () => {
        render(<BrowserRouter><NewClient /></BrowserRouter>);
        expect(screen.getByRole('heading', { name: /Basic Information/i })).toBeInTheDocument();
        expect(screen.getByText(/Full Name/i)).toBeInTheDocument();
        expect(screen.getByText(/Service Address/i)).toBeInTheDocument();
    });

    it('labels custom select controls for service and pool details', () => {
        render(<BrowserRouter><NewClient /></BrowserRouter>);

        expect(screen.getByRole('combobox', { name: 'Service Day' })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Pool Type' })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Surface Type' })).toBeInTheDocument();
    });

    it('navigates to the clients list after saving so the new client can be confirmed', async () => {
        const user = userEvent.setup();

        render(<BrowserRouter><NewClient /></BrowserRouter>);

        await user.type(screen.getByLabelText(/Full Name/i), 'E2E Pool');
        await user.type(screen.getByLabelText(/Service Address/i), '123 Test Lane');
        await user.click(screen.getByRole('button', { name: /Save Client/i }));

        expect(mockCreateCustomer).toHaveBeenCalledWith(expect.objectContaining({
            full_name: 'E2E Pool',
            address: '123 Test Lane',
        }));
        expect(mockNavigate).toHaveBeenCalledWith('/page/Clients');
    });
});
