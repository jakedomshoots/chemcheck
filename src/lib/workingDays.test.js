import { describe, it, expect, beforeEach } from 'vitest';
import { getEffectiveWorkingDays } from './workingDays';

describe('getEffectiveWorkingDays', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns cloud working days when available', () => {
    const convexBusiness = {
      settings: {
        working_days: ['Sunday', 'Saturday', 'Monday'],
      },
    };

    expect(getEffectiveWorkingDays(convexBusiness)).toEqual(['Monday', 'Saturday', 'Sunday']);
  });

  it('falls back to local current business settings when cloud settings are missing', () => {
    localStorage.setItem(
      'chemcheck_current_business',
      JSON.stringify({
        settings: {
          workingDays: ['Saturday', 'Sunday'],
        },
      })
    );

    expect(getEffectiveWorkingDays(null)).toEqual(['Saturday', 'Sunday']);
  });

  it('falls back to weekday defaults when neither source has working days', () => {
    expect(getEffectiveWorkingDays(null)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
  });
});
