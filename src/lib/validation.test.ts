import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  validateCustomer,
  validateServiceLog,
  validateChemicalUsage,
  validateNote,
  checkRateLimit,
  sanitizeHtml,
  sanitizeString
} from './validation';

describe('Input Sanitization', () => {
  describe('sanitizeHtml', () => {
    it('should escape HTML characters', () => {
      const maliciousInput = '<script>alert("xss")</script>';
      const sanitized = sanitizeHtml(maliciousInput);
      expect(sanitized).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
    });

    it('should handle empty strings', () => {
      expect(sanitizeHtml('')).toBe('');
    });

    it('should handle normal text', () => {
      expect(sanitizeHtml('Hello World')).toBe('Hello World');
    });
  });

  describe('sanitizeString', () => {
    it('should trim and sanitize', () => {
      const input = '  <script>alert("test")</script>  ';
      const result = sanitizeString(input);
      expect(result).toBe('&lt;script&gt;alert(&quot;test&quot;)&lt;&#x2F;script&gt;');
    });
  });
});

describe('Customer Validation', () => {
  const validCustomer = {
    full_name: 'John Smith',
    address: '123 Main St, Anytown, CA 90210',
    phone: '555-555-0123',
    email: 'john@example.com',
    gate_code: '1234',
    service_day: 'Monday' as const,
    pool_gallons: 20000,
    pool_type: 'Chlorine' as const,
    surface_type: 'Plaster' as const,
    sort_order: 1
  };

  it('should validate a correct customer', () => {
    const result = validateCustomer(validCustomer);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.full_name).toBe('John Smith');
      expect(result.data.email).toBe('john@example.com');
    }
  });

  it('should reject missing required fields', () => {
    const invalidCustomer = { ...validCustomer };
    delete invalidCustomer.full_name;
    
    const result = validateCustomer(invalidCustomer);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some(err => err.includes('full_name'))).toBe(true);
    }
  });

  it('should reject invalid email format', () => {
    const invalidCustomer = { ...validCustomer, email: 'invalid-email' };
    
    const result = validateCustomer(invalidCustomer);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some(err => err.includes('Invalid email format'))).toBe(true);
    }
  });

  it('should reject invalid phone format', () => {
    const invalidCustomer = { ...validCustomer, phone: 'abc' };
    
    const result = validateCustomer(invalidCustomer);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some(err => err.includes('Invalid phone number format'))).toBe(true);
    }
  });

  it('should reject invalid service day', () => {
    const invalidCustomer = { ...validCustomer, service_day: 'InvalidDay' as any };
    
    const result = validateCustomer(invalidCustomer);
    expect(result.success).toBe(false);
  });

  it('should sanitize HTML in text fields', () => {
    const customerWithHtml = {
      ...validCustomer,
      full_name: '<script>alert("xss")</script>John',
      address: '<img src=x onerror=alert(1)>123 Main St'
    };
    
    const result = validateCustomer(customerWithHtml);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.full_name).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;John');
      expect(result.data.address).toBe('&lt;img src=x onerror=alert(1)&gt;123 Main St');
    }
  });

  it('should handle optional fields correctly', () => {
    const minimalCustomer = {
      full_name: 'Jane Doe',
      address: '456 Oak Ave',
      service_day: 'Tuesday' as const,
      pool_type: 'Salt' as const,
      surface_type: 'Vinyl' as const
    };
    
    const result = validateCustomer(minimalCustomer);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBeUndefined();
      expect(result.data.email).toBeUndefined();
    }
  });
});

describe('Service Log Validation', () => {
  const validServiceLog = {
    customer_id: 1,
    service_date: '2024-12-13',
    status: 'completed' as const,
    notes: 'Pool cleaned and chemicals balanced',
    ph: 'good' as const,
    chlorine: 'good' as const,
    alkalinity: 'good' as const,
    stabilizer: 'good' as const,
    salt: 3200
  };

  it('should validate a correct service log', () => {
    const result = validateServiceLog(validServiceLog);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customer_id).toBe(1);
      expect(result.data.service_date).toBe('2024-12-13');
    }
  });

  it('should reject invalid date format', () => {
    const invalidLog = { ...validServiceLog, service_date: '12/13/2024' };
    
    const result = validateServiceLog(invalidLog);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some(err => err.includes('YYYY-MM-DD format'))).toBe(true);
    }
  });

  it('should reject future dates', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1);
    const invalidLog = { 
      ...validServiceLog, 
      service_date: futureDate.toISOString().split('T')[0] 
    };
    
    const result = validateServiceLog(invalidLog);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some(err => err.includes('future service date'))).toBe(true);
    }
  });

  it('should reject invalid chemical readings', () => {
    const invalidLog = { ...validServiceLog, ph: 'invalid' as any };
    
    const result = validateServiceLog(invalidLog);
    expect(result.success).toBe(false);
  });

  it('should sanitize notes', () => {
    const logWithHtml = {
      ...validServiceLog,
      notes: '<script>alert("xss")</script>Pool cleaned'
    };
    
    const result = validateServiceLog(logWithHtml);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;Pool cleaned');
    }
  });
});

describe('Chemical Usage Validation', () => {
  const validChemicalUsage = {
    customer_id: 1,
    chemical_type: 'Chlorine Tablets',
    quantity: '2 lbs',
    notes: 'Added to skimmer basket'
  };

  it('should validate correct chemical usage', () => {
    const result = validateChemicalUsage(validChemicalUsage);
    expect(result.success).toBe(true);
  });

  it('should reject missing required fields', () => {
    const invalidUsage = { ...validChemicalUsage };
    delete invalidUsage.chemical_type;
    
    const result = validateChemicalUsage(invalidUsage);
    expect(result.success).toBe(false);
  });

  it('should sanitize text fields', () => {
    const usageWithHtml = {
      ...validChemicalUsage,
      chemical_type: '<script>Chlorine</script>',
      quantity: '<img src=x>2 lbs'
    };
    
    const result = validateChemicalUsage(usageWithHtml);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chemical_type).toBe('&lt;script&gt;Chlorine&lt;&#x2F;script&gt;');
      expect(result.data.quantity).toBe('&lt;img src=x&gt;2 lbs');
    }
  });
});

describe('Note Validation', () => {
  const validNote = {
    title: 'Equipment Check',
    content: 'Pool pump making unusual noise',
    category: 'Equipment' as const,
    customer_id: 1,
    priority: 'high' as const
  };

  it('should validate correct note', () => {
    const result = validateNote(validNote);
    expect(result.success).toBe(true);
  });

  it('should reject invalid category', () => {
    const invalidNote = { ...validNote, category: 'InvalidCategory' as any };
    
    const result = validateNote(invalidNote);
    expect(result.success).toBe(false);
  });

  it('should reject invalid priority', () => {
    const invalidNote = { ...validNote, priority: 'urgent' as any };
    
    const result = validateNote(invalidNote);
    expect(result.success).toBe(false);
  });

  it('should sanitize content', () => {
    const noteWithHtml = {
      ...validNote,
      title: '<script>alert(1)</script>Title',
      content: '<img src=x onerror=alert(1)>Content'
    };
    
    const result = validateNote(noteWithHtml);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('&lt;script&gt;alert(1)&lt;&#x2F;script&gt;Title');
      expect(result.data.content).toBe('&lt;img src=x onerror=alert(1)&gt;Content');
    }
  });
});

describe('Rate Limiting', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should allow operations within limits', () => {
    const result = checkRateLimit('customers');
    expect(result.allowed).toBe(true);
  });

  it('should track operations correctly', () => {
    // Make several operations
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit('customers');
      expect(result.allowed).toBe(true);
    }
    
    // Check that counter was updated
    const totalKey = 'rateLimit_customers_total';
    const total = parseInt(localStorage.getItem(totalKey) || '0');
    expect(total).toBe(5);
  });

  it('should reject when hourly limit exceeded', () => {
    // Mock localStorage to simulate many recent operations
    const recentKey = 'rateLimit_customers_recent';
    const now = Date.now();
    const recentOperations = Array.from({ length: 51 }, (_, i) => now - i * 1000);
    localStorage.setItem(recentKey, JSON.stringify(recentOperations));
    
    const result = checkRateLimit('customers');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Rate limit exceeded');
  });

  it('should reject when total limit exceeded', () => {
    // Mock localStorage to simulate total limit exceeded
    const totalKey = 'rateLimit_customers_total';
    localStorage.setItem(totalKey, '1001');
    
    const result = checkRateLimit('customers');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Storage limit exceeded');
  });

  it('should clean old entries', () => {
    const recentKey = 'rateLimit_customers_recent';
    const now = Date.now();
    const oldOperations = [
      now - (2 * 60 * 60 * 1000), // 2 hours ago
      now - (1 * 60 * 60 * 1000), // 1 hour ago
      now - (30 * 60 * 1000)      // 30 minutes ago
    ];
    localStorage.setItem(recentKey, JSON.stringify(oldOperations));
    
    checkRateLimit('customers');
    
    const updated = JSON.parse(localStorage.getItem(recentKey) || '[]');
    expect(updated.length).toBe(2); // Should remove the 2-hour-old entry
  });

  it('should handle localStorage errors gracefully', () => {
    // Mock localStorage to throw error
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = vi.fn(() => {
      throw new Error('Storage full');
    });
    
    const result = checkRateLimit('customers');
    expect(result.allowed).toBe(true); // Should fail open
    
    // Restore original
    localStorage.setItem = originalSetItem;
  });
});