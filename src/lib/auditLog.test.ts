import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, logCreate, logLogin } from './auditLog';
import { clearActiveTenantScope, setActiveTenantScope } from './tenantScope';

describe('audit log privacy boundary', () => {
  beforeEach(() => {
    localStorage.clear();
    clearActiveTenantScope();
  });

  afterEach(() => {
    auditLog.clearLog();
    clearActiveTenantScope();
    localStorage.clear();
  });

  it('does not persist an audit record until an authenticated tenant is active', () => {
    expect(logLogin(true)).toBe('');
    expect(Object.keys(localStorage).filter((key) => key.startsWith('chemcheck_audit_log'))).toEqual([]);
  });

  it('separates tenant audit records and redacts sensitive details', () => {
    setActiveTenantScope({ userEmail: 'owner-a@chemcheck.test', businessId: 'business-a' });
    auditLog.clearLog();
    logCreate('CUSTOMER', 'customer-1', {
      customerEmail: 'customer@example.test',
      gateCode: '1234',
      count: 2,
    });

    const ownerAEntries = auditLog.getEntries();
    expect(ownerAEntries).toHaveLength(1);
    expect(ownerAEntries[0]).not.toHaveProperty('userEmail');
    expect(ownerAEntries[0].userId).not.toContain('owner-a@chemcheck.test');
    expect(ownerAEntries[0].details).toEqual({
      customerEmail: '[redacted]',
      gateCode: '[redacted]',
      count: 2,
    });

    setActiveTenantScope({ userEmail: 'owner-b@chemcheck.test', businessId: 'business-b' });
    expect(auditLog.getEntries()).toEqual([]);
    logLogin(true);
    expect(auditLog.getEntries()).toHaveLength(1);

    setActiveTenantScope({ userEmail: 'owner-a@chemcheck.test', businessId: 'business-a' });
    expect(auditLog.getEntries()).toHaveLength(1);
    expect(localStorage.getItem('chemcheck_audit_log')).toBeNull();
  });
});
