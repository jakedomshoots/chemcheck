import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Camera, Check, ChevronDown, CircleAlert, Gauge, Loader2, RotateCcw, ScanLine, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { readingsToServiceLogPatch } from '@/lib/aquachek';
import { analyzeAquaChekPhoto } from '@/lib/aquachekImageAnalysis';
import { CHEMICAL_CONFIGS, mapNumericValueToStatus } from '@/lib/chemStatus';
import { calculateAquaChekLsiEstimate, formatLsi, LSI_CALCULATION_VERSION } from '@/lib/lsi';

const RESULT_TONE = {
  aggressive: 'border-[var(--status-action-line)] bg-[var(--status-action-soft)] text-action',
  balanced: 'border-[var(--status-ok-line)] bg-[var(--status-ok-soft)] text-ok',
  'scale-forming': 'border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] text-watch',
};

const RESULT_LABEL = {
  aggressive: 'Likely aggressive',
  balanced: 'Likely balanced',
  'scale-forming': 'Likely scale-forming',
};

function ReadingChip({ label, value, unit = '' }) {
  return (
    <div className="rounded-control bg-surface-2 px-3 py-2">
      <p className="text-[0.625rem] font-bold uppercase tracking-[0.08em] text-ink-muted">{label}</p>
      <p className="mt-0.5 font-data text-sm font-semibold tabular-nums text-ink">{value}{unit}</p>
    </div>
  );
}

const CORE_CHEMISTRY_FIELDS = [
  { chemical: 'ph', valueField: 'ph_value', statusField: 'ph' },
  { chemical: 'chlorine', valueField: 'chlorine_value', statusField: 'chlorine' },
  { chemical: 'alkalinity', valueField: 'alkalinity_value', statusField: 'alkalinity' },
  { chemical: 'stabilizer', valueField: 'stabilizer_value', statusField: 'stabilizer' },
];

function hasEnteredValue(value) {
  return value !== '' && value !== undefined && value !== null;
}

function buildChemistryPatch(current, readings) {
  const patch = readingsToServiceLogPatch(readings);

  CORE_CHEMISTRY_FIELDS.forEach(({ chemical, valueField, statusField }) => {
    if (!hasEnteredValue(current[valueField])) return;
    patch[valueField] = current[valueField];
    patch[statusField] = mapNumericValueToStatus(
      current[valueField],
      CHEMICAL_CONFIGS[chemical].ranges,
    ) ?? current[statusField];
  });

  if (hasEnteredValue(current.hardness_value)) {
    patch.hardness_value = current.hardness_value;
    patch.hardness_source = hasEnteredValue(current.hardness_source)
      ? current.hardness_source
      : 'aquachek_total';
  }

  return patch;
}

export default function AquaChekStripScanner({ formData, setFormData, sanitizer = 'chlorine', analyzePhoto = analyzeAquaChekPhoto }) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState('idle');
  const [previewUrl, setPreviewUrl] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState('');
  const [showAccuracy, setShowAccuracy] = useState(false);
  const [temperatureOverride, setTemperatureOverride] = useState(null);
  const [tdsOverride, setTdsOverride] = useState(null);
  const inputRef = useRef(null);
  const panelId = useId();

  const temperatureValue = temperatureOverride ?? (formData.water_temperature ?? '');
  const tdsValue = tdsOverride ?? (formData.tds_value ?? '');

  useEffect(() => () => {
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const probableLsi = useMemo(() => {
    if (!analysis) return null;
    const readings = analysis.readings;
    const salt = Number(formData.salt) || 0;
    const temperature = temperatureValue === '' ? 80 : Number(temperatureValue);
    const tds = tdsValue === '' ? (salt > 0 ? salt + 500 : 1000) : Number(tdsValue);
    const temperatureIsAssumed = temperatureValue === ''
      || (temperatureOverride === null && formData.water_temperature_source !== 'measured');
    const tdsIsAssumed = tdsValue === ''
      || (tdsOverride === null && formData.tds_source !== 'measured');
    const ph = hasEnteredValue(formData.ph_value) ? Number(formData.ph_value) : readings.ph;
    const totalAlkalinity = hasEnteredValue(formData.alkalinity_value) ? Number(formData.alkalinity_value) : readings.totalAlkalinity;
    const cyanuricAcid = hasEnteredValue(formData.stabilizer_value) ? Number(formData.stabilizer_value) : readings.cyanuricAcid;
    const hardness = hasEnteredValue(formData.hardness_value) ? Number(formData.hardness_value) : readings.totalHardness;
    const hardnessSource = hasEnteredValue(formData.hardness_value)
      ? (formData.hardness_source || 'aquachek_total')
      : 'aquachek_total';
    const estimate = calculateAquaChekLsiEstimate({
      ph,
      totalAlkalinity,
      cyanuricAcid,
      hardness,
      waterTemperatureF: temperature,
      tds,
      hardnessSource,
      temperatureEstimated: temperatureIsAssumed,
      tdsEstimated: tdsIsAssumed,
    });
    return estimate
      ? {
          ...estimate,
          assumedTemperature: temperatureIsAssumed,
          assumedTds: tdsIsAssumed,
          temperature,
          tds,
          hardnessSource,
          tdsFromSalt: tdsValue === '' && salt > 0,
        }
      : null;
  }, [analysis, formData.alkalinity_value, formData.hardness_source, formData.hardness_value, formData.ph_value, formData.salt, formData.stabilizer_value, formData.tds_source, formData.water_temperature_source, tdsOverride, tdsValue, temperatureOverride, temperatureValue]);

  const reset = () => {
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setAnalysis(null);
    setError('');
    setShowAccuracy(false);
    setTemperatureOverride(null);
    setTdsOverride(null);
    setState('idle');
    if (inputRef.current) inputRef.current.value = '';
  };

  const handlePhoto = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setError('');
    setAnalysis(null);
    setState('analyzing');
    try {
      const result = await analyzePhoto(file);
      if (!result.reliable) {
        setError('ChemCheck could not verify every critical pad. Retake the photo before using these readings.');
        setState('error');
        return;
      }
      setAnalysis(result);
      setState('result');
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : 'ChemCheck could not read this strip photo.');
      setState('error');
    }
  };

  const useReadings = () => {
    if (!analysis?.reliable) return;
    setFormData((current) => {
      const currentHasTemperature = hasEnteredValue(current.water_temperature);
      const currentHasTds = hasEnteredValue(current.tds_value);
      const salt = Number(current.salt) || 0;
      const temperatureCandidate = temperatureOverride ?? (currentHasTemperature ? current.water_temperature : '');
      const tdsCandidate = tdsOverride ?? (currentHasTds ? current.tds_value : '');
      const effectiveTemperature = hasEnteredValue(temperatureCandidate) ? temperatureCandidate : 80;
      const effectiveTds = hasEnteredValue(tdsCandidate) ? tdsCandidate : (salt > 0 ? salt + 500 : 1000);

      const chemistryPatch = buildChemistryPatch(current, analysis.readings);

      return {
        ...current,
        ...chemistryPatch,
        water_temperature: effectiveTemperature,
        water_temperature_source: temperatureOverride !== null && hasEnteredValue(temperatureCandidate)
          ? 'measured'
          : (hasEnteredValue(temperatureCandidate) ? (current.water_temperature_source || 'assumed') : 'assumed'),
        tds_value: effectiveTds,
        tds_source: tdsOverride !== null && hasEnteredValue(tdsCandidate)
          ? 'measured'
          : (hasEnteredValue(tdsCandidate) ? (current.tds_source || 'assumed') : 'assumed'),
        strip_scan_confidence: analysis.confidence,
        strip_scan_analysis_version: analysis.analysisVersion,
        strip_scan_pad_confidence: analysis.padConfidence,
        strip_scan_quality: analysis.quality,
        lsi_calculation_version: LSI_CALCULATION_VERSION,
      };
    });
    setState('saved');
  };

  let panelContent;

  if (state === 'idle') {
    panelContent = (
      <section className="m-3 rounded-raised border border-brand/20 bg-gradient-to-br from-brand-softer via-surface-1 to-surface-1 p-4" aria-labelledby="strip-scan-title">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-brand text-white shadow-sm">
            <ScanLine className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h4 id="strip-scan-title" className="text-sm font-semibold text-ink">AquaChek 7 strip scan</h4>
              <span className="rounded-full bg-surface-1 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.08em] text-ink-muted">Optional</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">Take a photo to estimate today’s chemistry and most probable LSI.</p>
          </div>
        </div>
        <div className="mt-3 rounded-control bg-surface-2 px-3 py-2 text-[0.6875rem] leading-4 text-ink-muted">
          Dip and remove immediately. Hold level, pads up, for 15 seconds—do not shake—then photograph immediately. Lay the strip flat on any reasonably uncluttered surface, fill the guide horizontally, and keep the handle on the right. A perfect white background is not required; avoid flash, glare, and heavy shadows across the strip itself.
        </div>
        <Input ref={inputRef} id="aquachek-photo" type="file" accept="image/*" capture="environment" onChange={handlePhoto} className="peer sr-only" />
        <Label htmlFor="aquachek-photo" className="mt-3 flex h-11 cursor-pointer items-center justify-center rounded-card bg-brand text-sm font-semibold text-white shadow-sm transition-[background-color,transform] hover:bg-brand-strong active:scale-[0.98] peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2">
          <Camera className="mr-2 h-4 w-4" aria-hidden="true" /> Take strip photo
        </Label>
      </section>
    );
  } else if (state === 'saved') {
    panelContent = (
      <section className="m-3 rounded-raised border border-[var(--status-ok-line)] bg-[var(--status-ok-soft)] p-4" aria-live="polite">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ok text-white"><Check className="h-4 w-4" /></span>
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-ink">Probable readings added</h4>
            <p className="mt-0.5 text-xs leading-5 text-ink-secondary">They’ll be saved with this daily log when you complete service. Existing manual readings were kept.</p>
          </div>
        </div>
        <Button type="button" variant="outline" onClick={reset} className="mt-3 h-11 w-full rounded-control border-line bg-surface-1">
          <RotateCcw className="mr-2 h-4 w-4" /> Retake photo
        </Button>
      </section>
    );
  } else {
    panelContent = (
    <section className="m-3 overflow-hidden rounded-raised border border-line bg-surface-1" aria-labelledby="strip-result-title">
      <div className="relative aspect-[16/7] bg-surface-2">
        {previewUrl && <img src={previewUrl} alt="AquaChek 7 strip being analyzed" className="h-full w-full object-cover" />}
        {state === 'analyzing' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-ink/70 text-white backdrop-blur-sm" role="status">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="mt-2 text-sm font-semibold">Reading AquaChek colors…</p>
          </div>
        )}
      </div>

      {state === 'error' && (
        <div className="p-4">
          <div className="flex items-start gap-2 text-sm text-action"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><p>{error}</p></div>
          <p className="mt-2 text-xs leading-5 text-ink-muted">Retake closer, keep the strip horizontal, and use even light without glare.</p>
          <Button type="button" variant="outline" onClick={reset} className="mt-3 h-11 w-full rounded-control border-line"><RotateCcw className="mr-2 h-4 w-4" /> Retake photo</Button>
        </div>
      )}

      {state === 'result' && analysis && (
        <div className="p-4">
          {probableLsi ? (
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-brand-ink">Most probable LSI</p>
                <h4 id="strip-result-title" className="mt-1 font-data text-3xl font-semibold tabular-nums tracking-[-0.04em] text-ink">{formatLsi(probableLsi.result.value)}</h4>
                <p className="mt-1 text-xs font-semibold text-ink-secondary">{RESULT_LABEL[probableLsi.result.status]} · {analysis.confidence} scan confidence</p>
                <p className="mt-1 text-[0.6875rem] text-ink-muted">
                  Likely strip range {formatLsi(probableLsi.range.min)} to {formatLsi(probableLsi.range.max)}
                  {probableLsi.range.crossesBalanceBoundary ? ' · crosses a balance boundary' : ''}
                  {probableLsi.range.includesInvalidChemistry ? ' · nearby values may not produce a valid LSI' : ''}
                </p>
              </div>
              <span className={`flex h-10 w-10 items-center justify-center rounded-full border ${RESULT_TONE[probableLsi.result.status]}`}><Gauge className="h-5 w-5" /></span>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-control border border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] p-3 text-watch">
              <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <h4 id="strip-result-title" className="text-sm font-semibold">LSI unavailable from this strip</h4>
                <p className="mt-1 text-xs leading-5">The readings were captured, but they do not produce a valid balance calculation. You can still add them to the log and enter detailed readings.</p>
              </div>
            </div>
          )}

          <div className="mt-4 grid grid-cols-3 gap-2">
            <ReadingChip label="pH" value={analysis.readings.ph} />
            <ReadingChip label="Alkalinity" value={analysis.readings.totalAlkalinity} unit=" ppm" />
            <ReadingChip label="CYA" value={analysis.readings.cyanuricAcid} unit=" ppm" />
            <ReadingChip label="Hardness" value={analysis.readings.totalHardness} unit=" ppm" />
            <ReadingChip label="Free chlorine" value={analysis.readings.freeChlorine} unit=" ppm" />
            <ReadingChip label={sanitizer === 'bromine' ? 'Total bromine' : 'Total chlorine'} value={sanitizer === 'bromine' ? analysis.readings.totalBromine : analysis.readings.totalChlorine} unit=" ppm" />
          </div>

          {probableLsi && (
            <div className="mt-3 rounded-control bg-surface-2 px-3 py-2 text-[0.6875rem] leading-4 text-ink-muted">
              {probableLsi.hardnessSource === 'calcium' ? 'Calculated with calcium hardness' : 'Estimated with total hardness'}{probableLsi.assumedTemperature ? ', ' + probableLsi.temperature + '°F water' : ''}{probableLsi.assumedTds ? ' and ' + (probableLsi.tdsFromSalt ? 'salt-based' : probableLsi.tds.toLocaleString() + ' ppm') + ' TDS' : ''}.
            </div>
          )}
          <div className="mt-2 flex items-start gap-2 rounded-control border border-[var(--status-ok-line)] bg-[var(--status-ok-soft)] px-3 py-2 text-xs text-ok">
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Photo quality verified. All six pads passed framing, lighting, glare, and color-confidence checks.</p>
          </div>

          <button type="button" onClick={() => setShowAccuracy((current) => !current)} className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-control text-xs font-semibold text-brand-ink hover:bg-brand-softer" aria-expanded={showAccuracy}>
            <SlidersHorizontal className="h-4 w-4" /> Improve accuracy
          </button>
          {showAccuracy && (
            <div className="mt-2 grid grid-cols-2 gap-3 rounded-control bg-surface-2 p-3">
              <div><Label htmlFor="scan-temp" className="text-xs font-semibold text-ink-secondary">Water temperature</Label><Input id="scan-temp" type="number" value={temperatureValue} onChange={(event) => setTemperatureOverride(event.target.value)} placeholder="80" className="mt-1 h-11 bg-surface-1" /></div>
              <div><Label htmlFor="scan-tds" className="text-xs font-semibold text-ink-secondary">TDS</Label><Input id="scan-tds" type="number" value={tdsValue} onChange={(event) => setTdsOverride(event.target.value)} placeholder="1000" className="mt-1 h-11 bg-surface-1" /></div>
            </div>
          )}

          <Button type="button" onClick={useReadings} className="mt-3 h-11 w-full rounded-card bg-brand text-sm font-semibold text-white hover:bg-brand-strong"><Check className="mr-2 h-4 w-4" /> Use probable readings</Button>
          <Button type="button" variant="ghost" onClick={reset} className="mt-1 h-11 w-full rounded-control text-ink-muted">Retake photo</Button>
        </div>
      )}
    </section>
    );
  }

  const hasAttachedReadings = state === 'saved' || formData.strip_scan_method === 'aquachek_select_photo';
  const summary = state === 'analyzing'
    ? 'Reading strip photo…'
    : state === 'result'
      ? 'Photo analyzed — review result'
      : state === 'error'
        ? 'Photo needs a retake'
        : hasAttachedReadings
          ? 'Strip readings added to this visit'
          : 'Photo scan and estimated water balance';

  return (
    <section className="mb-4 overflow-hidden rounded-raised border border-line bg-surface-1 shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} AquaChek 7 and LSI`}
        className="flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-brand-softer"
      >
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-card ${hasAttachedReadings ? 'bg-ok text-white' : 'bg-brand-soft text-brand-ink'}`}>
          {hasAttachedReadings ? <Check className="h-4 w-4" aria-hidden="true" /> : <ScanLine className="h-4 w-4" aria-hidden="true" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink">AquaChek 7 + LSI</span>
            <span className={`rounded-full px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.08em] ${hasAttachedReadings ? 'bg-[var(--status-ok-soft)] text-ok' : 'bg-surface-2 text-ink-muted'}`}>
              {hasAttachedReadings ? 'Added' : 'Optional'}
            </span>
          </span>
          <span className={`mt-0.5 block truncate text-xs ${state === 'error' ? 'text-action' : 'text-ink-muted'}`}>{summary}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-ink-muted transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {expanded && (
        <div id={panelId} className="border-t border-line bg-surface-2/40">
          {panelContent}
        </div>
      )}
    </section>
  );
}
