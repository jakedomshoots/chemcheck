import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AquaChekStripScanner from './AquaChekStripScanner';
import { calculateLsi, formatLsi } from '@/lib/lsi';

const analysis = {
  readings: {
    totalHardness: 250,
    totalChlorine: 3,
    totalBromine: 6,
    freeChlorine: 3,
    ph: 7.4,
    totalAlkalinity: 120,
    cyanuricAcid: 50,
  },
  confidence: 'medium',
  reliable: true,
  analysisVersion: 'aquachek-select-v4',
  padConfidence: {
    totalHardness: 0.8,
    totalChlorine: 0.7,
    freeChlorine: 0.8,
    ph: 0.9,
    totalAlkalinity: 0.9,
    cyanuricAcid: 0.8,
  },
  quality: {
    backgroundLightness: 0.9,
    backgroundNeutrality: 0.95,
    lightingUniformity: 0.92,
    framing: 0.9,
  },
};

function expandScanner() {
  fireEvent.click(screen.getByRole('button', { name: /expand aquachek 7 and lsi/i }));
}

describe('AquaChekStripScanner', () => {
  it('stays compact and optional inside the daily log until requested', () => {
    render(<AquaChekStripScanner formData={{}} setFormData={vi.fn()} />);
    expect(screen.getByText('Optional')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /expand aquachek 7 and lsi/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText(/take strip photo/i)).not.toBeInTheDocument();

    expandScanner();

    expect(screen.getByRole('button', { name: /collapse aquachek 7 and lsi/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/most probable LSI/i)).toBeInTheDocument();
    expect(screen.getByText(/handle on the right/i)).toBeInTheDocument();
    expect(screen.queryByText(/countdown|step 1/i)).not.toBeInTheDocument();
  });

  it('analyzes one photo and adds probable readings to the visit', async () => {
    const setFormData = vi.fn();
    const analyzePhoto = vi.fn().mockResolvedValue(analysis);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:strip') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    render(<AquaChekStripScanner formData={{ salt: '' }} setFormData={setFormData} analyzePhoto={analyzePhoto} />);
    expandScanner();

    fireEvent.change(screen.getByLabelText(/take strip photo/i), {
      target: { files: [new File(['strip'], 'strip.jpg', { type: 'image/jpeg' })] },
    });

    expect(await screen.findByText('Most probable LSI')).toBeInTheDocument();
    expect(screen.getByText(/medium scan confidence/i)).toBeInTheDocument();
    expect(screen.getByText(/likely strip range/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /use probable readings/i }));
    expect(setFormData).toHaveBeenCalledTimes(1);
    const updater = setFormData.mock.calls[0][0];
    expect(updater({})).toMatchObject({
      ph_value: 7.4,
      ph: 'good',
      hardness_value: 250,
      chlorine_value: 3,
      chlorine: 'high',
      alkalinity: 'high',
      stabilizer: 'high',
      water_temperature: 80,
      water_temperature_source: 'assumed',
      tds_value: 1000,
      tds_source: 'assumed',
      strip_scan_confidence: 'medium',
      strip_scan_analysis_version: 'aquachek-select-v4',
      strip_scan_pad_confidence: analysis.padConfidence,
      strip_scan_quality: analysis.quality,
      lsi_calculation_version: 'aquachek-epa-v1',
    });
    await waitFor(() => expect(screen.getByText(/saved with this daily log/i)).toBeInTheDocument());
  });

  it('records entered temperature and TDS as measured inputs', async () => {
    const setFormData = vi.fn();
    const analyzePhoto = vi.fn().mockResolvedValue(analysis);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:strip') });
    render(<AquaChekStripScanner formData={{ salt: '' }} setFormData={setFormData} analyzePhoto={analyzePhoto} />);
    expandScanner();

    fireEvent.change(screen.getByLabelText(/take strip photo/i), {
      target: { files: [new File(['strip'], 'strip.jpg', { type: 'image/jpeg' })] },
    });
    await screen.findByText('Most probable LSI');
    fireEvent.click(screen.getByRole('button', { name: /improve accuracy/i }));
    fireEvent.change(screen.getByLabelText(/water temperature/i), { target: { value: '86' } });
    fireEvent.change(screen.getByLabelText(/^tds$/i), { target: { value: '1450' } });
    fireEvent.click(screen.getByRole('button', { name: /use probable readings/i }));

    const updater = setFormData.mock.calls[0][0];
    expect(updater({})).toMatchObject({
      water_temperature: '86',
      water_temperature_source: 'measured',
      tds_value: '1450',
      tds_source: 'measured',
    });
  });

  it('uses current detailed temperature and TDS in the preview instead of mount-time assumptions', async () => {
    const analyzePhoto = vi.fn().mockResolvedValue(analysis);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:strip') });
    const formData = {
      salt: '',
      water_temperature: 84,
      water_temperature_source: 'measured',
      tds_value: 1200,
      tds_source: 'measured',
    };
    const { rerender } = render(
      <AquaChekStripScanner formData={formData} setFormData={vi.fn()} analyzePhoto={analyzePhoto} />,
    );
    expandScanner();

    fireEvent.change(screen.getByLabelText(/take strip photo/i), {
      target: { files: [new File(['strip'], 'strip.jpg', { type: 'image/jpeg' })] },
    });

    expect(await screen.findByText('Most probable LSI')).toBeInTheDocument();
    expect(screen.queryByText(/80°F water/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/1,000 ppm TDS/i)).not.toBeInTheDocument();

    rerender(
      <AquaChekStripScanner
        formData={{ ...formData, water_temperature: 86, tds_value: 1450 }}
        setFormData={vi.fn()}
        analyzePhoto={analyzePhoto}
      />,
    );
    expect(screen.getByText('Most probable LSI')).toBeInTheDocument();
    expect(screen.queryByText(/80°F water/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/1,000 ppm TDS/i)).not.toBeInTheDocument();
  });

  it('returns to explicit assumptions when optional accuracy inputs are cleared', async () => {
    const setFormData = vi.fn();
    const analyzePhoto = vi.fn().mockResolvedValue(analysis);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:strip') });
    render(<AquaChekStripScanner formData={{ salt: '' }} setFormData={setFormData} analyzePhoto={analyzePhoto} />);
    expandScanner();

    fireEvent.change(screen.getByLabelText(/take strip photo/i), {
      target: { files: [new File(['strip'], 'strip.jpg', { type: 'image/jpeg' })] },
    });
    await screen.findByText('Most probable LSI');
    fireEvent.click(screen.getByRole('button', { name: /improve accuracy/i }));
    const temperatureInput = screen.getByLabelText(/water temperature/i);
    const tdsInput = screen.getByLabelText(/^tds$/i);
    fireEvent.change(temperatureInput, { target: { value: '86' } });
    fireEvent.change(tdsInput, { target: { value: '1450' } });
    fireEvent.change(temperatureInput, { target: { value: '' } });
    fireEvent.change(tdsInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /use probable readings/i }));

    const updater = setFormData.mock.calls[0][0];
    expect(updater({})).toMatchObject({
      water_temperature: 80,
      water_temperature_source: 'assumed',
      tds_value: 1000,
      tds_source: 'assumed',
    });
  });

  it('does not allow an analyzer result marked unreliable to enter the service log', async () => {
    const setFormData = vi.fn();
    const analyzePhoto = vi.fn().mockResolvedValue({ ...analysis, reliable: false, confidence: 'low' });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:strip') });
    render(<AquaChekStripScanner formData={{}} setFormData={setFormData} analyzePhoto={analyzePhoto} />);
    expandScanner();

    fireEvent.change(screen.getByLabelText(/take strip photo/i), {
      target: { files: [new File(['strip'], 'strip.jpg', { type: 'image/jpeg' })] },
    });

    expect(await screen.findByText(/could not verify every critical pad/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /use probable readings/i })).not.toBeInTheDocument();
    expect(setFormData).not.toHaveBeenCalled();
  });

  it('does not overwrite detailed LSI chemistry when a scan is added afterward', async () => {
    const setFormData = vi.fn();
    const analyzePhoto = vi.fn().mockResolvedValue(analysis);
    const detailedLog = {
      hardness_source: 'calcium',
      hardness_value: 325,
      ph_value: 7.5,
      alkalinity_value: 90,
      stabilizer_value: 40,
      water_temperature: 84,
      water_temperature_source: 'measured',
      tds_value: 1200,
      tds_source: 'measured',
      salt: '',
    };
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:strip') });
    render(<AquaChekStripScanner formData={detailedLog} setFormData={setFormData} analyzePhoto={analyzePhoto} />);
    expandScanner();

    fireEvent.change(screen.getByLabelText(/take strip photo/i), {
      target: { files: [new File(['strip'], 'strip.jpg', { type: 'image/jpeg' })] },
    });
    await screen.findByText('Most probable LSI');
    const expectedLsi = calculateLsi({
      ph: 7.5,
      totalAlkalinity: 90,
      cyanuricAcid: 40,
      hardness: 325,
      waterTemperatureF: 84,
      tds: 1200,
      hardnessSource: 'calcium',
    });
    expect(expectedLsi).not.toBeNull();
    expect(screen.getByText(formatLsi(expectedLsi.value))).toBeInTheDocument();
    expect(screen.getByText(/Calculated with calcium hardness/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /use probable readings/i }));

    const updater = setFormData.mock.calls[0][0];
    expect(updater(detailedLog)).toMatchObject({
      hardness_source: 'calcium',
      hardness_value: 325,
      ph_value: 7.5,
      alkalinity_value: 90,
      stabilizer_value: 40,
      water_temperature: 84,
      water_temperature_source: 'measured',
      tds_value: 1200,
      tds_source: 'measured',
      chlorine_value: 3,
      total_chlorine_value: 3,
      strip_scan_method: 'aquachek_select_photo',
    });
  });

  it('preserves ordinary numeric chemistry entered before a scan', async () => {
    const setFormData = vi.fn();
    const analyzePhoto = vi.fn().mockResolvedValue(analysis);
    const manualLog = {
      ph_value: 7.5,
      chlorine_value: 2.5,
      alkalinity_value: 90,
      stabilizer_value: 40,
      water_temperature: 84,
      water_temperature_source: 'measured',
      tds_value: 1200,
      tds_source: 'measured',
      salt: '',
    };
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:strip') });
    render(<AquaChekStripScanner formData={manualLog} setFormData={setFormData} analyzePhoto={analyzePhoto} />);
    expandScanner();

    fireEvent.change(screen.getByLabelText(/take strip photo/i), {
      target: { files: [new File(['strip'], 'strip.jpg', { type: 'image/jpeg' })] },
    });
    await screen.findByText('Most probable LSI');
    fireEvent.click(screen.getByRole('button', { name: /use probable readings/i }));

    const updater = setFormData.mock.calls[0][0];
    expect(updater(manualLog)).toMatchObject({
      ph_value: 7.5,
      ph: 'good',
      chlorine_value: 2.5,
      chlorine: 'good',
      alkalinity_value: 90,
      alkalinity: 'low',
      stabilizer_value: 40,
      stabilizer: 'good',
      hardness_value: 250,
      hardness_source: 'aquachek_total',
      strip_scan_method: 'aquachek_select_photo',
    });
    await waitFor(() => expect(screen.getByText(/manual readings were kept/i)).toBeInTheDocument());
  });

  it('shows a usable result instead of a blank card when the strip cannot produce an LSI', async () => {
    const analyzePhoto = vi.fn().mockResolvedValue({
      ...analysis,
      readings: { ...analysis.readings, totalHardness: 0, totalAlkalinity: 0, cyanuricAcid: 300 },
    });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:strip') });
    render(<AquaChekStripScanner formData={{}} setFormData={vi.fn()} analyzePhoto={analyzePhoto} />);
    expandScanner();

    fireEvent.change(screen.getByLabelText(/take strip photo/i), {
      target: { files: [new File(['strip'], 'strip.jpg', { type: 'image/jpeg' })] },
    });

    expect(await screen.findByText(/LSI unavailable from this strip/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /use probable readings/i })).toBeInTheDocument();
  });

  it('can collapse an analyzed result without discarding it', async () => {
    const analyzePhoto = vi.fn().mockResolvedValue(analysis);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:strip') });
    render(<AquaChekStripScanner formData={{}} setFormData={vi.fn()} analyzePhoto={analyzePhoto} />);
    expandScanner();

    fireEvent.change(screen.getByLabelText(/take strip photo/i), {
      target: { files: [new File(['strip'], 'strip.jpg', { type: 'image/jpeg' })] },
    });
    expect(await screen.findByText('Most probable LSI')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /collapse aquachek 7 and lsi/i }));
    expect(screen.queryByText('Most probable LSI')).not.toBeInTheDocument();
    expect(screen.getByText(/photo analyzed/i)).toBeInTheDocument();

    expandScanner();
    expect(screen.getByText('Most probable LSI')).toBeInTheDocument();
  });
});
