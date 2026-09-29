import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import PoolAnalysisPanel, { toAnalysisLog } from './PoolAnalysisPanel';
import { analyzePool } from '@/lib/ai-summarizer';

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  }
});

describe('toAnalysisLog', () => {
  it('leaves untested chemicals undefined instead of defaulting to good', () => {
    const log = toAnalysisLog({ _id: 'a', service_date: '2026-09-01', ph: 'high' });
    expect(log.ph).toBe('high');
    expect(log.chlorine).toBeUndefined();
    expect(log.alkalinity).toBeUndefined();
    expect(log.stabilizer).toBeUndefined();
  });

  it('derives status from a numeric value and passes the value through', () => {
    const log = toAnalysisLog({ _id: 'a', service_date: '2026-09-01', chlorine_value: 15 });
    expect(log.chlorine).toBe('critical');
    expect(log.chlorine_value).toBe(15);
  });
});

describe('health score with missing readings', () => {
  it('missing readings do not inflate the score', () => {
    const raw = [
      { _id: '1', service_date: '2026-09-01', ph: 'critical', ph_value: 8.8 },
      { _id: '2', service_date: '2026-08-25', ph: 'critical', ph_value: 8.7 },
      { _id: '3', service_date: '2026-08-18', ph: 'critical', ph_value: 8.6 },
    ];
    const result = analyzePool({
      customerId: 'c',
      customerName: 'Test Owner',
      poolGallons: 15000,
      serviceLogs: raw.map((l) => toAnalysisLog(l)),
      includeWeather: false,
    });
    expect(result.healthScore.breakdown.map((b) => b.chemical)).toEqual(['ph']);
    expect(result.healthScore.score).toBeLessThan(30);
    expect(result.chemicalTrends.map((t) => t.chemical)).toEqual(['ph']);
    expect(result.weatherImpact).toBeNull();
    const phRec = result.recommendations.immediate.find((r) => r.chemical === 'ph');
    expect(phRec.dosage).toMatch(/muriatic acid/);
  });
});

describe('PoolAnalysisPanel', () => {
  it('shows "Not tested" for untested chemicals and uses non-AI wording', async () => {
    render(
      <PoolAnalysisPanel
        customer={{ _id: 'cust-not-tested', full_name: 'Test Owner', pool_gallons: 15000 }}
        serviceLogs={[
          { _id: '1', service_date: '2026-09-01', ph: 'good', ph_value: 7.4 },
          { _id: '2', service_date: '2026-08-25', ph: 'good', ph_value: 7.5 },
        ]}
        onClose={vi.fn()}
      />
    );
    expect(await screen.findByText(/Automated, rule-based analysis/)).toBeInTheDocument();
    expect(screen.getAllByText('Not tested')).toHaveLength(3);
    expect(screen.queryByText(/\bAI\b/)).not.toBeInTheDocument();
  });
});
