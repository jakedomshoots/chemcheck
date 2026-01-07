import React from 'react';
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// ============================================
// Test Utilities for ChemCheck
// ============================================

/**
 * Custom render function that includes common providers
 */
export function renderWithProviders(ui, options = {}) {
  const {
    initialEntries = ['/'],
    ...renderOptions
  } = options;

  function Wrapper({ children }) {
    return (
      <BrowserRouter>
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </BrowserRouter>
    );
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

/**
 * Mock database data for testing
 */
export const mockCustomers = [
  {
    id: 1,
    _id: 1,
    full_name: 'John Smith',
    address: '123 Main St, Anytown, CA 90210',
    phone: '555-0123',
    email: 'john@example.com',
    gate_code: '1234',
    service_day: 'Monday',
    pool_gallons: 20000,
    pool_type: 'Chlorine',
    surface_type: 'Plaster',
    sort_order: 1,
    created_by: 'local',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  },
  {
    id: 2,
    _id: 2,
    full_name: 'Jane Doe',
    address: '456 Oak Ave, Somewhere, CA 90211',
    phone: '555-0456',
    email: 'jane@example.com',
    service_day: 'Tuesday',
    pool_gallons: 15000,
    pool_type: 'Salt',
    surface_type: 'Vinyl',
    sort_order: 2,
    created_by: 'local',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  }
];

export const mockServiceLogs = [
  {
    id: 1,
    _id: 1,
    customer_id: 1,
    service_date: '2024-12-13',
    status: 'completed',
    notes: 'Pool cleaned and chemicals balanced',
    ph: 'good',
    chlorine: 'good',
    alkalinity: 'good',
    stabilizer: 'good',
    createdAt: '2024-12-13T10:00:00.000Z',
    updatedAt: '2024-12-13T10:00:00.000Z'
  }
];

export const mockChemicalUsage = [
  {
    id: 1,
    _id: 1,
    customer_id: 1,
    chemical_type: 'Chlorine Tablets',
    quantity: '2 lbs',
    notes: 'Added to skimmer basket',
    created_date: '2024-12-13',
    createdAt: '2024-12-13T10:00:00.000Z',
    updatedAt: '2024-12-13T10:00:00.000Z'
  }
];

export const mockNotes = [
  {
    id: 1,
    _id: 1,
    title: 'Equipment Check',
    content: 'Pool pump making unusual noise - needs inspection',
    category: 'Equipment',
    customer_id: 1,
    priority: 'high',
    completed: false,
    created_date: '2024-12-13',
    createdAt: '2024-12-13T10:00:00.000Z',
    updatedAt: '2024-12-13T10:00:00.000Z'
  }
];

/**
 * Mock API hooks for testing
 */
export const createMockHooks = (data = {}) => {
  const {
    customers = mockCustomers,
    serviceLogs = mockServiceLogs,
    chemicalUsage = mockChemicalUsage,
    notes = mockNotes
  } = data;

  return {
    // Customer hooks
    useCustomers: () => customers,
    useCustomer: (id) => customers.find(c => c.id === id || c._id === id),
    useCustomerCreate: () => jest.fn().mockResolvedValue(customers.length + 1),
    useCustomerUpdate: () => jest.fn().mockResolvedValue(true),
    useCustomerDelete: () => jest.fn().mockResolvedValue(true),

    // Service log hooks
    useServiceLogs: () => serviceLogs,
    useServiceLogsByCustomer: (customerId) => 
      serviceLogs.filter(log => log.customer_id === customerId),
    useServiceLogCreate: () => jest.fn().mockResolvedValue(serviceLogs.length + 1),
    useServiceLogUpdate: () => jest.fn().mockResolvedValue(true),
    useServiceLogDelete: () => jest.fn().mockResolvedValue(true),

    // Chemical usage hooks
    useChemicalUsage: () => chemicalUsage,
    useChemicalUsageCreate: () => jest.fn().mockResolvedValue(chemicalUsage.length + 1),
    useChemicalUsageUpdate: () => jest.fn().mockResolvedValue(true),
    useChemicalUsageDelete: () => jest.fn().mockResolvedValue(true),

    // Note hooks
    useNotes: () => notes,
    useNoteCreate: () => jest.fn().mockResolvedValue(notes.length + 1),
    useNoteUpdate: () => jest.fn().mockResolvedValue(true),
    useNoteDelete: () => jest.fn().mockResolvedValue(true),

    // Auth hook
    useCurrentUser: () => ({ email: 'local', name: 'Local User' })
  };
};

/**
 * Test validation functions
 */
export const testValidation = {
  isValidCustomer: (customer) => {
    return customer.full_name && 
           customer.address && 
           customer.service_day && 
           customer.pool_type && 
           customer.surface_type;
  },

  isValidServiceLog: (log) => {
    return log.customer_id && 
           log.service_date && 
           log.status && 
           log.ph && 
           log.chlorine && 
           log.alkalinity && 
           log.stabilizer;
  },

  isValidChemicalUsage: (usage) => {
    return usage.customer_id && 
           usage.chemical_type && 
           usage.quantity;
  },

  isValidNote: (note) => {
    return note.title && 
           note.content && 
           note.category && 
           note.priority;
  }
};

/**
 * Performance testing utilities
 */
export const performanceTest = {
  measureRenderTime: async (renderFn) => {
    const start = performance.now();
    const result = await renderFn();
    const end = performance.now();
    return {
      result,
      duration: end - start
    };
  },

  expectFastRender: (duration, maxMs = 100) => {
    expect(duration).toBeLessThan(maxMs);
  }
};

/**
 * Database testing utilities
 */
export const dbTest = {
  clearTestData: async () => {
    // Clear localStorage for tests
    localStorage.clear();
  },

  seedTestData: async () => {
    // This would seed the test database with mock data
    // For now, we'll just store in localStorage
    localStorage.setItem('test_customers', JSON.stringify(mockCustomers));
    localStorage.setItem('test_serviceLogs', JSON.stringify(mockServiceLogs));
    localStorage.setItem('test_chemicalUsage', JSON.stringify(mockChemicalUsage));
    localStorage.setItem('test_notes', JSON.stringify(mockNotes));
  }
};

/**
 * Error testing utilities
 */
export const errorTest = {
  expectErrorBoundary: (renderFn) => {
    // Mock console.error to avoid noise in tests
    const originalError = console.error;
    console.error = jest.fn();

    try {
      const result = renderFn();
      return result;
    } finally {
      console.error = originalError;
    }
  },

  simulateError: (component, errorMessage = 'Test error') => {
    const ThrowError = () => {
      throw new Error(errorMessage);
    };
    return <ThrowError />;
  }
};

/**
 * Accessibility testing utilities
 */
export const a11yTest = {
  expectAriaLabel: (element, expectedLabel) => {
    expect(element).toHaveAttribute('aria-label', expectedLabel);
  },

  expectKeyboardNavigation: (element) => {
    expect(element).toHaveAttribute('tabIndex');
  },

  expectSemanticHTML: (container, tagName) => {
    expect(container.querySelector(tagName)).toBeInTheDocument();
  }
};

// Re-export everything from testing-library
export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';