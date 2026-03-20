import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { format } from 'date-fns';
import ChemicalUsage from './ChemicalUsage';
import { BrowserRouter } from 'react-router-dom';

// Mock stable data - use fixed current month date for deterministic tests
const fixedDate = format(new Date(), 'yyyy-MM-15');
const mockUser = { email: 'test@example.com' };
const mockUsage = [
    { _id: 'u1', chemical_type: 'chlorine_tabs', quantity: '2', customer_id: 1, created_date: fixedDate, notes: 'Test notes' }
];
const mockCustomers = [
    { _id: 1, full_name: 'Alice Smith', address: '123 Main St' }
];
const mockRemoveChemicalUsage = vi.fn();
const mockUpdateChemicalUsage = vi.fn();

// Mock hooks - returns mock data immediately (no loading state simulation)
vi.mock('@/api/convexHooks', () => ({
    useCurrentUser: () => mockUser,
    useChemicalUsage: () => mockUsage,
    useCustomersFilter: () => mockCustomers,
    useChemicalUsageDelete: () => mockRemoveChemicalUsage,
    useChemicalUsageUpdate: () => mockUpdateChemicalUsage
}));

// Mock utils
vi.mock('@/utils', () => ({
    createPageUrl: (page) => `/page/${page}`,
    formatServiceDate: (date) => date,
    formatServiceDateFull: (date) => date
}));

// Mock toast
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() }
}));

// Mock AddChemicalForm component
vi.mock('@/components/servicelog/AddChemicalForm', () => ({
    default: ({ onSuccess, onCancel }) => (
        <div data-testid="add-chemical-form">
            Add Chemical Form
            <button onClick={onSuccess}>Submit</button>
            <button onClick={onCancel}>Cancel</button>
        </div>
    )
}));

describe('Chemical Usage Page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the page header and usage list', () => {
        render(<BrowserRouter><ChemicalUsage /></BrowserRouter>);
        
        // Verify page header
        const headings = screen.getAllByRole('heading', { name: /Chemical Usage/i });
        expect(headings.length).toBeGreaterThan(0);
        
        // Verify subheading
        expect(screen.getByText(/Track extra chemicals for billing/i)).toBeInTheDocument();
    });

    it('displays customer name in the usage list', () => {
        render(<BrowserRouter><ChemicalUsage /></BrowserRouter>);
        
        // Customer name should be visible in the list
        expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    it('displays record count for customers with usage', () => {
        render(<BrowserRouter><ChemicalUsage /></BrowserRouter>);
        
        // Should show "1 record" for the customer
        expect(screen.getByText(/1 record/i)).toBeInTheDocument();
    });

    it('expands customer section to show chemical details when clicked', async () => {
        render(<BrowserRouter><ChemicalUsage /></BrowserRouter>);
        
        // Click on the customer name to expand
        const customerName = screen.getByText('Alice Smith');
        fireEvent.click(customerName);
        
        // After expanding, chemical type and quantity should be visible
        await waitFor(() => {
            expect(screen.getByText('chlorine_tabs')).toBeInTheDocument();
            expect(screen.getByText('2')).toBeInTheDocument();
        });
    });

    it('shows notes when customer section is expanded', async () => {
        render(<BrowserRouter><ChemicalUsage /></BrowserRouter>);
        
        // Click to expand
        const customerName = screen.getByText('Alice Smith');
        fireEvent.click(customerName);
        
        // Notes should be visible
        await waitFor(() => {
            expect(screen.getByText('Test notes')).toBeInTheDocument();
        });
    });

    it('renders Add Chemical Usage button in header', () => {
        render(<BrowserRouter><ChemicalUsage /></BrowserRouter>);
        
        // Use getAllByRole since there may be multiple buttons with this text
        const addButtons = screen.getAllByRole('button', { name: /Add Chemical Usage/i });
        expect(addButtons.length).toBeGreaterThan(0);
    });

    it('displays monthly record count', () => {
        render(<BrowserRouter><ChemicalUsage /></BrowserRouter>);
        
        // Should show the count of monthly records
        expect(screen.getByText(/Monthly Chemical Records/i)).toBeInTheDocument();
    });

    it('shows the selected month label', () => {
        render(<BrowserRouter><ChemicalUsage /></BrowserRouter>);
        
        // Should show "Selected Month" label
        expect(screen.getByText(/Selected Month/i)).toBeInTheDocument();
    });

    it('has navigation buttons for previous/next month', async () => {
        render(<BrowserRouter><ChemicalUsage /></BrowserRouter>);
        
        // Previous button should always be visible
        const previousButton = screen.getByRole('button', { name: /Previous/i });
        expect(previousButton).toBeInTheDocument();
        
        // Next button is hidden when on current month, click Previous to navigate back
        fireEvent.click(previousButton);
        
        // After navigating to previous month, Next button should appear
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Next/i })).toBeInTheDocument();
        });
    });

    it('shows download button for monthly report', () => {
        render(<BrowserRouter><ChemicalUsage /></BrowserRouter>);
        
        expect(screen.getByRole('button', { name: /Download Monthly Chemical Log/i })).toBeInTheDocument();
    });
});
