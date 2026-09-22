export const CALIBRATION_MANIFEST_COLUMNS = [
  'sample_id',
  'image',
  'device',
  'strip_lot',
  'seconds_after_dip',
  'lighting',
  'cohort',
  'truth_method',
  'truth_instrument',
  'total_hardness',
  'total_chlorine',
  'free_chlorine',
  'ph',
  'total_alkalinity',
  'cyanuric_acid',
];

const TRUTH_COLUMNS = {
  total_hardness: 'totalHardness',
  total_chlorine: 'totalChlorine',
  free_chlorine: 'freeChlorine',
  ph: 'ph',
  total_alkalinity: 'totalAlkalinity',
  cyanuric_acid: 'cyanuricAcid',
};

const TRUTH_RANGES = {
  total_hardness: [0, 1000],
  total_chlorine: [0, 10],
  free_chlorine: [0, 10],
  ph: [6.2, 8.4],
  total_alkalinity: [0, 240],
  cyanuric_acid: [0, 300],
};

const INDEPENDENT_TRUTH_METHODS = new Set(['drop-test', 'photometer', 'laboratory', 'mixed']);
const COHORTS = new Set(['calibration', 'validation']);

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field.trim());
      field = '';
    } else if (character === '\n') {
      row.push(field.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else if (character !== '\r') {
      field += character;
    }
  }

  if (quoted) throw new Error('Manifest contains an unterminated quoted field.');
  row.push(field.trim());
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

function requiredValue(record, key, lineNumber) {
  const value = record[key]?.trim();
  if (!value) throw new Error(`Line ${lineNumber}: ${key} is required.`);
  return value;
}

function numericValue(raw, key, lineNumber, required = false) {
  if (raw === undefined || raw.trim() === '') {
    if (required) throw new Error(`Line ${lineNumber}: ${key} must be a number.`);
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Line ${lineNumber}: ${key} must be a number.`);
  return value;
}

export function parseCalibrationManifest(text) {
  const rows = parseCsvRows(text);
  if (rows.length === 0) throw new Error('Manifest is empty.');
  const header = rows[0].map((column) => column.toLowerCase());
  for (const column of CALIBRATION_MANIFEST_COLUMNS) {
    if (!header.includes(column)) throw new Error(`Manifest is missing required column: ${column}.`);
  }

  const seenIds = new Set();
  return rows.slice(1).map((values, rowIndex) => {
    const lineNumber = rowIndex + 2;
    const record = Object.fromEntries(header.map((column, index) => [column, values[index] ?? '']));
    const sampleId = requiredValue(record, 'sample_id', lineNumber);
    if (seenIds.has(sampleId)) throw new Error(`Line ${lineNumber}: duplicate sample_id "${sampleId}".`);
    seenIds.add(sampleId);

    const truth = {};
    for (const [column, key] of Object.entries(TRUTH_COLUMNS)) {
      const value = numericValue(record[column], column, lineNumber);
      if (value !== undefined) {
        const [min, max] = TRUTH_RANGES[column];
        if (value < min || value > max) {
          throw new Error(`Line ${lineNumber}: ${column} must be between ${min} and ${max}.`);
        }
        truth[key] = value;
      }
    }
    if (Object.keys(truth).length === 0) {
      throw new Error(`Line ${lineNumber}: provide at least one numeric truth reading.`);
    }

    const secondsAfterDip = numericValue(record.seconds_after_dip, 'seconds_after_dip', lineNumber, true);
    if (secondsAfterDip < 0 || secondsAfterDip > 300) {
      throw new Error(`Line ${lineNumber}: seconds_after_dip must be between 0 and 300.`);
    }
    const cohort = requiredValue(record, 'cohort', lineNumber).toLowerCase();
    if (!COHORTS.has(cohort)) {
      throw new Error(`Line ${lineNumber}: cohort must be calibration or validation.`);
    }
    const truthMethod = requiredValue(record, 'truth_method', lineNumber).toLowerCase();
    if (!INDEPENDENT_TRUTH_METHODS.has(truthMethod)) {
      throw new Error(`Line ${lineNumber}: truth_method must be drop-test, photometer, laboratory, or mixed.`);
    }

    return {
      sampleId,
      image: requiredValue(record, 'image', lineNumber),
      device: requiredValue(record, 'device', lineNumber),
      stripLot: requiredValue(record, 'strip_lot', lineNumber),
      secondsAfterDip,
      lighting: requiredValue(record, 'lighting', lineNumber),
      cohort,
      truthMethod,
      truthInstrument: requiredValue(record, 'truth_instrument', lineNumber),
      truth,
    };
  });
}

const percent = (value) => value === null ? '—' : `${(value * 100).toFixed(1)}%`;
const number = (value) => value === null ? '—' : Number(value.toFixed(3)).toString();

export function renderCalibrationMarkdown(result) {
  const { generatedAt, analyzerVersion, report } = result;
  const lines = [
    '# AquaChek calibration report',
    '',
    `Generated: ${generatedAt}`,
    `Analyzer: ${analyzerVersion}`,
    `Decision: **${report.readiness.status}**`,
    '',
    '## Corpus coverage',
    '',
    `- Photos: ${report.summary.totalPhotos} total, ${report.summary.acceptedPhotos} accepted, ${report.summary.rejectedPhotos} rejected`,
    `- Accepted calibration photos: ${report.summary.acceptedCalibrationPhotos}`,
    `- Accepted held-out validation photos: ${report.summary.acceptedValidationPhotos}`,
    `- Held-out validation acceptance rate: ${percent(report.summary.acceptanceRate)}`,
    `- Accepted validation devices: ${report.summary.deviceCount}`,
    `- Accepted validation strip lots: ${report.summary.stripLotCount}`,
    `- Accepted validation lighting conditions: ${report.summary.lightingConditionCount}`,
    `- Photos taken in the ${report.policy.targetSecondsAfterDip.min}–${report.policy.targetSecondsAfterDip.max} second window: ${percent(report.summary.timingComplianceRate)}`,
    '',
    '## Held-out validation accuracy by pad',
    '',
    '| Pad | Truth pairs | Exact level | Within one level | Mean absolute error |',
    '| --- | ---: | ---: | ---: | ---: |',
  ];

  for (const [analyte, metrics] of Object.entries(report.analytes)) {
    lines.push(`| ${analyte} | ${metrics.truthCount} | ${percent(metrics.exactLevelRate)} | ${percent(metrics.withinOneLevelRate)} | ${number(metrics.meanAbsoluteError)} |`);
  }

  lines.push('', '## Decision details', '');
  if (report.readiness.reasons.length === 0) {
    lines.push('- All corpus coverage and accuracy gates passed.');
  } else {
    report.readiness.reasons.forEach((reason) => lines.push(`- ${reason}`));
  }

  lines.push('', '## Rejected photos', '');
  const rejections = Object.entries(report.rejections);
  if (rejections.length === 0) {
    lines.push('- None');
  } else {
    rejections.forEach(([code, count]) => lines.push(`- ${code}: ${count}`));
  }

  lines.push(
    '',
    '> A ready result validates this photo corpus against AquaChek comparator levels. It does not turn strip chemistry into laboratory-grade measurement.',
    '',
  );
  return lines.join('\n');
}
