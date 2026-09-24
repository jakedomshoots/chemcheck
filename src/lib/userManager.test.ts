import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./monitoring', () => ({
  monitoring: { recordMetric: vi.fn() },
}));

describe('userManager cloud reconciliation', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('rebinds a same-email orphan profile to the authenticated Convex business', async () => {
    localStorage.setItem('chemcheck_users', JSON.stringify([{
      id: 'user-local',
      email: 'Owner@Example.com',
      name: 'Pool Owner',
      role: 'owner',
      businessId: 'local-orphan',
      isActive: true,
      createdAt: '2026-09-23T00:00:00.000Z',
      preferences: {},
    }]));
    localStorage.setItem('chemcheck_businesses', JSON.stringify([{
      id: 'local-orphan',
      name: 'Mistaken Local Setup',
      ownerId: 'user-local',
      settings: {},
      createdAt: '2026-09-23T00:00:00.000Z',
    }]));

    const { userManager } = await import('./userManager');
    const { user, business } = await userManager.bootstrapFromConvex({
      _id: 'business-existing',
      name: 'Existing Business',
      created_at: Date.parse('2026-01-01T00:00:00.000Z'),
    }, 'owner@example.com');

    expect(user.businessId).toBe('business-existing');
    expect(business.id).toBe('business-existing');
    expect(JSON.parse(localStorage.getItem('chemcheck_current_user') || '{}').businessId)
      .toBe('business-existing');
    expect(JSON.parse(localStorage.getItem('chemcheck_users') || '[]')).toHaveLength(1);
  });
});
