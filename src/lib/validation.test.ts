import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  validateCustomer,
  validateServiceLog,
  validateChemicalUsage,
  validateNote,
  checkRateLimit,
  sanitizeHtml,
  sanitizeString,
  checkReadingSanity
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
    const invalidCustomer: Partial<typeof validCustomer> = { ...validCustomer };
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

  it('should accept critical chemical readings from the service log form', () => {
    const criticalLog = { ...validServiceLog, chlorine: 'critical' as const };

    const result = validateServiceLog(criticalLog);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chlorine).toBe('critical');
    }
  });

  it('preserves validated LSI scan provenance fields', () => {
    const result = validateServiceLog({
      ...validServiceLog,
      ph_value: 7.4,
      alkalinity_value: 120,
      stabilizer_value: 50,
      hardness_value: 250,
      hardness_source: 'aquachek_total',
      water_temperature: 80,
      water_temperature_source: 'assumed',
      tds_value: 3700,
      tds_source: 'assumed',
      strip_scan_method: 'aquachek_select_photo',
      strip_scan_confidence: 'medium',
      strip_scan_analysis_version: 'aquachek-select-v4',
      strip_scan_pad_confidence: {
        totalHardness: 0.8,
        totalChlorine: 0.7,
        freeChlorine: 0.8,
        ph: 0.9,
        totalAlkalinity: 0.9,
        cyanuricAcid: 0.8,
      },
      strip_scan_quality: {
        backgroundLightness: 0.9,
        backgroundNeutrality: 0.95,
        lightingUniformity: 0.92,
        framing: 0.9,
      },
      lsi_calculation_version: 'aquachek-epa-v1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.water_temperature_source).toBe('assumed');
      expect(result.data.strip_scan_confidence).toBe('medium');
      expect(result.data.strip_scan_analysis_version).toBe('aquachek-select-v4');
      expect(result.data.strip_scan_pad_confidence?.ph).toBe(0.9);
      expect(result.data.strip_scan_quality?.framing).toBe(0.9);
      expect(result.data.lsi_calculation_version).toBe('aquachek-epa-v1');
    }
  });

  it('accepts standalone measured LSI data without strip metadata', () => {
    const result = validateServiceLog({
      ...validServiceLog,
      ph_value: 7.6,
      alkalinity_value: 90,
      stabilizer_value: 60,
      hardness_value: 300,
      hardness_source: 'calcium',
      water_temperature: 84,
      water_temperature_source: 'measured',
      tds_value: 1200,
      tds_source: 'measured',
      lsi_calculation_version: 'lsi-v1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.lsi_calculation_version).toBe('lsi-v1');
  });

  it('rejects lsi-v1 when required readings are incomplete or assumed', () => {
    const result = validateServiceLog({
      ...validServiceLog,
      ph_value: 7.6,
      alkalinity_value: 90,
      stabilizer_value: 60,
      hardness_value: 300,
      hardness_source: 'calcium',
      water_temperature: 84,
      water_temperature_source: 'assumed',
      lsi_calculation_version: 'lsi-v1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(' ')).toMatch(/lsi-v1.*measured.*temperature.*TDS/i);
    }
  });

  it('rejects an incomplete v2 strip scan before local storage', () => {
    const result = validateServiceLog({
      ...validServiceLog,
      strip_scan_method: 'aquachek_select_photo',
      strip_scan_confidence: 'medium',
      strip_scan_analysis_version: 'aquachek-select-v2',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a strip scan method without its complete audit package', () => {
    const result = validateServiceLog({
      ...validServiceLog,
      strip_scan_method: 'aquachek_select_photo',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(' ')).toMatch(/complete scan audit data/i);
    }
  });

  it('rejects LSI provenance without the corresponding local reading', () => {
    const result = validateServiceLog({
      ...validServiceLog,
      water_temperature_source: 'measured',
      tds_source: 'assumed',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(' ')).toMatch(/temperature.*reading|TDS.*reading/i);
    }
  });

  it('rejects LSI readings that are missing their provenance source', () => {
    const result = validateServiceLog({
      ...validServiceLog,
      hardness_value: 300,
      water_temperature: 84,
      tds_value: 1200,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(' ')).toMatch(/hardness.*source|temperature.*source|TDS.*source/i);
    }
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
    const invalidUsage: Partial<typeof validChemicalUsage> = { ...validChemicalUsage };
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

describe('Reading sanity checks', () => {
  it('accepts normal readings with no previous visit', () => {
    const result = checkReadingSanity({
      ph_value: 7.4, chlorine_value: 3, alkalinity_value: 100, stabilizer_value: 40, hardness_value: 300, salt: 3200, water_temperature: 82,
    });
    expect(result).toEqual({ errors: [], warnings: [], isValid: true });
  });

  it('rejects hard-invalid readings with field-specific messages', () => {
    const result = checkReadingSanity({
      ph_value: 14.5, chlorine_value: 51, alkalinity_value: 1001, stabilizer_value: 501, hardness_value: 2001, salt: 20001, water_temperature: 121,
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.map((issue) => issue.field)).toEqual([
      'ph_value', 'chlorine_value', 'alkalinity_value', 'stabilizer_value', 'hardness_value', 'salt', 'water_temperature',
    ]);
    expect(result.errors[0].message).toMatch(/pH 14.5 is outside the possible range \(0 to 14\)/);
    expect(result.errors[6].message).toMatch(/Water temperature 121 °F is outside/);
    expect(checkReadingSanity({ water_temperature: 31 }).isValid).toBe(false);
    expect(checkReadingSanity({ ph_value: -0.1 }).isValid).toBe(false);
  });

  it('treats boundary values as valid', () => {
    expect(checkReadingSanity({ ph_value: 14, chlorine_value: 50, water_temperature: 32, salt: 20000 }).isValid).toBe(true);
  });

  it('ignores blanks and string values that are not numbers', () => {
    const result = checkReadingSanity({ ph_value: '' as unknown as number, chlorine_value: 'abc' as unknown as number });
    expect(result.isValid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('warns about big jumps versus the previous visit without blocking', () => {
    const previous = { ph_value: 7.4, chlorine_value: 3, alkalinity_value: 100, hardness_value: 300, salt: 3200 };
    const result = checkReadingSanity(
      { ph_value: 8.5, chlorine_value: 12, alkalinity_value: 181, hardness_value: 501, salt: 1600 },
      previous,
    );
    expect(result.isValid).toBe(true);
    expect(result.warnings.map((issue) => issue.field)).toEqual(['ph_value', 'chlorine_value', 'alkalinity_value', 'hardness_value', 'salt']);
    expect(result.warnings[0].message).toMatch(/pH moved up from 7.4 last visit to 8.5/);
    expect(result.warnings[4].message).toMatch(/Salt moved down from 3200 ppm last visit to 1600 ppm/);
  });

  it('does not warn when the change is within the jump limit', () => {
    const result = checkReadingSanity(
      { ph_value: 8.4, chlorine_value: 11, alkalinity_value: 180, hardness_value: 500, salt: 4700 },
      { ph_value: 7.4, chlorine_value: 3, alkalinity_value: 100, hardness_value: 300, salt: 3200 },
    );
    expect(result.warnings).toEqual([]);
  });

  it('does not double-report a hard-invalid reading as a jump', () => {
    const result = checkReadingSanity({ ph_value: 15 }, { ph_value: 7.4 });
    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it('flags FC 0 with CYA above 100 as physically unlikely', () => {
    const result = checkReadingSanity({ chlorine_value: 0, stabilizer_value: 120 });
    expect(result.isValid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toMatch(/physically unlikely/);
    expect(checkReadingSanity({ chlorine_value: 0, stabilizer_value: 60 }).warnings).toEqual([]);
    expect(checkReadingSanity({ chlorine_value: 1, stabilizer_value: 120 }).warnings).toEqual([]);
  });

  it('keeps the service log schema aligned with the hard limits', () => {
    const base = { customer_id: 1, service_date: '2024-01-01', status: 'completed', ph: 'good', chlorine: 'good', alkalinity: 'good', stabilizer: 'good' };
    expect(validateServiceLog({ ...base, chlorine_value: 51 }).success).toBe(false);
    expect(validateServiceLog({ ...base, stabilizer_value: 501 }).success).toBe(false);
    expect(validateServiceLog({ ...base, salt: 20001 }).success).toBe(false);
    expect(validateServiceLog({ ...base, salt: 15000 }).success).toBe(true);
    expect(validateServiceLog({ ...base, water_temperature: 121, water_temperature_source: 'measured' }).success).toBe(false);
    expect(validateServiceLog({ ...base, water_temperature: 120, water_temperature_source: 'measured' }).success).toBe(true);
  });
});
