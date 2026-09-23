import type { AquaChekReadings } from './aquachek';

type Rgb = [number, number, number];
type Reference = { value: number; color: Rgb };
export type AquaChekPadKey = 'totalHardness' | 'totalChlorine' | 'freeChlorine' | 'ph' | 'totalAlkalinity' | 'cyanuricAcid';

export type StripAnalysisConfidence = 'low' | 'medium' | 'high';
export type AquaChekPhotoErrorCode =
  | 'invalid-file'
  | 'bad-framing'
  | 'bad-background'
  | 'uneven-lighting'
  | 'uncertain-pad';

export const AQUACHEK_ANALYSIS_VERSION = 'aquachek-select-v4';

export interface AquaChekImageQuality {
  backgroundLightness: number;
  backgroundNeutrality: number;
  lightingUniformity: number;
  framing: number;
}

export class AquaChekPhotoError extends Error {
  code: AquaChekPhotoErrorCode;

  constructor(code: AquaChekPhotoErrorCode, message: string) {
    super(message);
    this.name = 'AquaChekPhotoError';
    this.code = code;
  }
}

export interface AquaChekPhotoAnalysis {
  readings: AquaChekReadings;
  confidence: StripAnalysisConfidence;
  reliable: boolean;
  analysisVersion: typeof AQUACHEK_ANALYSIS_VERSION;
  padConfidence: Record<AquaChekPadKey, number>;
  quality: AquaChekImageQuality;
}

// Reference colors are digitized from the AquaChek Select comparator. They are
// deliberately treated as likelihood anchors, not laboratory calibration data.
export const AQUACHEK_COLOR_REFERENCES: Record<AquaChekPadKey, Reference[]> = {
  totalHardness: [
    { value: 0, color: [112, 95, 139] }, { value: 100, color: [143, 101, 162] },
    { value: 250, color: [171, 91, 160] }, { value: 500, color: [207, 91, 145] },
    { value: 1000, color: [224, 103, 137] },
  ],
  totalChlorine: [
    { value: 0, color: [246, 239, 78] }, { value: 0.5, color: [244, 239, 105] },
    { value: 1, color: [238, 234, 124] }, { value: 3, color: [220, 227, 129] },
    { value: 5, color: [183, 219, 135] }, { value: 10, color: [139, 205, 132] },
  ],
  freeChlorine: [
    { value: 0, color: [249, 238, 94] }, { value: 0.5, color: [248, 241, 141] },
    { value: 1, color: [241, 224, 181] }, { value: 3, color: [220, 139, 178] },
    { value: 5, color: [201, 80, 151] }, { value: 10, color: [159, 45, 127] },
  ],
  ph: [
    { value: 6.2, color: [241, 148, 27] }, { value: 6.8, color: [239, 91, 24] },
    { value: 7.2, color: [233, 48, 39] }, { value: 7.8, color: [214, 35, 41] },
    { value: 8.4, color: [189, 35, 48] },
  ],
  totalAlkalinity: [
    { value: 0, color: [221, 143, 27] }, { value: 40, color: [187, 151, 29] },
    { value: 80, color: [139, 148, 43] }, { value: 120, color: [91, 120, 71] },
    { value: 180, color: [41, 101, 77] }, { value: 240, color: [32, 83, 93] },
  ],
  cyanuricAcid: [
    { value: 0, color: [215, 132, 22] }, { value: 50, color: [193, 63, 24] },
    { value: 100, color: [171, 43, 35] }, { value: 150, color: [143, 40, 60] },
    { value: 300, color: [116, 38, 100] },
  ],
};

function srgbToLinear(channel: number) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function rgbToLab([red, green, blue]: Rgb): Rgb {
  const r = srgbToLinear(red);
  const g = srgbToLinear(green);
  const b = srgbToLinear(blue);
  let x = ((r * 0.4124) + (g * 0.3576) + (b * 0.1805)) / 0.95047;
  let y = (r * 0.2126) + (g * 0.7152) + (b * 0.0722);
  let z = ((r * 0.0193) + (g * 0.1192) + (b * 0.9505)) / 1.08883;
  const transform = (value: number) => value > 0.008856 ? value ** (1 / 3) : (7.787 * value) + (16 / 116);
  x = transform(x); y = transform(y); z = transform(z);
  return [(116 * y) - 16, 500 * (x - y), 200 * (y - z)];
}

export function colorDistance(first: Rgb, second: Rgb) {
  const a = rgbToLab(first);
  const b = rgbToLab(second);
  return Math.sqrt(((a[0] - b[0]) ** 2) + ((a[1] - b[1]) ** 2) + ((a[2] - b[2]) ** 2));
}

export function matchReferenceColor(color: Rgb, references: Reference[]) {
  const ranked = references
    .map((reference) => ({ ...reference, distance: colorDistance(color, reference.color) }))
    .sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  const runnerUp = ranked[1];
  const separation = runnerUp ? Math.max(0, runnerUp.distance - best.distance) : 0;
  const relativeSeparation = runnerUp ? separation / Math.max(runnerUp.distance, 1) : 0;
  const distanceQuality = 1 - Math.min(best.distance, 55) / 75;
  // Closely spaced comparator colors can have a small absolute gap even when
  // the photographed pad is nearly identical to one reference. Relative
  // separation preserves that strong match while still collapsing at the
  // midpoint between two references.
  const confidence = clamp(Math.max(separation / 22, relativeSeparation * 0.75) * distanceQuality);
  return { value: best.value, confidence, distance: best.distance };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function roundMetric(value: number) {
  return Number(clamp(value).toFixed(3));
}

function luminance([red, green, blue]: Rgb) {
  return (red * 0.2126) + (green * 0.7152) + (blue * 0.0722);
}

function samplePad(data: Uint8ClampedArray, width: number, height: number, centerX: number, centerY: number): Rgb {
  const radius = Math.max(3, Math.round(Math.min(width, height) * 0.012));
  const reds: number[] = []; const greens: number[] = []; const blues: number[] = [];
  for (let y = Math.max(0, centerY - radius); y <= Math.min(height - 1, centerY + radius); y += 1) {
    for (let x = Math.max(0, centerX - radius); x <= Math.min(width - 1, centerX + radius); x += 1) {
      const index = ((y * width) + x) * 4;
      reds.push(data[index]); greens.push(data[index + 1]); blues.push(data[index + 2]);
    }
  }
  return [median(reds), median(greens), median(blues)];
}

function normalizeAgainstStripReference(color: Rgb, stripReference: Rgb): Rgb {
  // Map the photographed strip substrate back to its known warm-white color.
  // A per-channel target preserves camera cast correction without forcing the
  // slightly warm strip material to an artificial neutral gray.
  const targetStrip: Rgb = [253, 252, 244];
  return color.map((channel, index) => {
    const reference = Math.max(1, stripReference[index]);
    return Math.round(clamp(channel * (targetStrip[index] / reference), 0, 255));
  }) as Rgb;
}

const PAD_KEYS: readonly AquaChekPadKey[] = ['totalHardness', 'totalChlorine', 'freeChlorine', 'ph', 'totalAlkalinity', 'cyanuricAcid'];
const PAD_POSITIONS = [0.22, 0.32, 0.42, 0.52, 0.62, 0.72] as const;
const PAD_LABELS: Record<(typeof PAD_KEYS)[number], string> = {
  totalHardness: 'hardness',
  totalChlorine: 'total chlorine',
  freeChlorine: 'free chlorine',
  ph: 'pH',
  totalAlkalinity: 'alkalinity',
  cyanuricAcid: 'CYA',
};
const ALL_PAD_REFERENCES = Object.values(AQUACHEK_COLOR_REFERENCES).flat();

function inspectStripReference(data: Uint8ClampedArray, width: number, height: number) {
  // Color-correct against the strip's own pale substrate, not the surface it
  // happens to be lying on. Field techs may photograph on concrete, truck
  // beds, equipment lids, or coping; those surroundings should not decide
  // whether otherwise clear pads are readable.
  // Probe exposed backing in the horizontal gaps between pads. These points
  // stay on even a thin strip; probes above or below the pads can accidentally
  // land on the field surface when the strip appears small in the frame.
  const gapPositions = PAD_POSITIONS.slice(0, -1).map((position, index) => (
    (position + PAD_POSITIONS[index + 1]) / 2
  ));
  const points = [PAD_POSITIONS[0] - 0.055, ...gapPositions, PAD_POSITIONS.at(-1)! + 0.055]
    .map((x) => [width * x, height / 2]);
  const samples = points.map(([x, y]) => samplePad(
    data,
    width,
    height,
    Math.round(x),
    Math.round(y),
  ));
  const stripReference: Rgb = [
    median(samples.map((sample) => sample[0])),
    median(samples.map((sample) => sample[1])),
    median(samples.map((sample) => sample[2])),
  ];
  const lightness = luminance(stripReference) / 255;
  const channelSpread = Math.max(...stripReference) - Math.min(...stripReference);
  const luminances = samples.map(luminance);
  const lightingSpread = Math.max(...luminances) - Math.min(...luminances);
  const clippedChannels = samples.flat().filter((channel) => channel >= 254).length;
  return {
    stripReference,
    lightness,
    neutrality: clamp(1 - (channelSpread / 90)),
    uniformity: clamp(1 - (lightingSpread / 80)),
    clipping: clippedChannels / (samples.length * 3),
  };
}

function locatePad(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  expectedX: number,
  stripReference: Rgb,
) {
  const xWindow = Math.max(4, Math.round(width * 0.025));
  const yWindow = Math.max(4, Math.round(Math.min(width, height) * 0.055));
  const step = Math.max(2, Math.round(Math.min(width, height) * 0.008));
  const baseX = Math.round(width * expectedX);
  const baseY = Math.round(height * 0.5);
  let best = { x: baseX, y: baseY, score: Number.NEGATIVE_INFINITY, rank: Number.NEGATIVE_INFINITY, proximity: Number.POSITIVE_INFINITY };

  for (let y = baseY - yWindow; y <= baseY + yWindow; y += step) {
    for (let x = baseX - xWindow; x <= baseX + xWindow; x += step) {
      const sampled = samplePad(data, width, height, x, y);
      const normalized = normalizeAgainstStripReference(sampled, stripReference);
      const nearestPadDistance = Math.min(...ALL_PAD_REFERENCES.map((reference) => (
        colorDistance(normalized, reference.color)
      )));
      const score = 60 - nearestPadDistance;
      const proximity = Math.hypot(x - baseX, y - baseY);
      // JPEG ringing and antialiased corners can be marginally darker than the
      // pad center. Without a proximity cost those edge pixels win the search,
      // then correctly fail the glare/uniformity gate. Prefer the expected pad
      // center unless a displaced candidate is materially more pad-like.
      const rank = score - ((proximity / Math.max(xWindow, yWindow)) * 2);
      if (rank > best.rank + 0.01 || (Math.abs(rank - best.rank) <= 0.01 && proximity < best.proximity)) {
        best = { x, y, score, rank, proximity };
      }
    }
  }
  return best;
}

function inspectPadUniformity(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  stripReference: Rgb,
) {
  const offset = Math.max(5, Math.round(Math.min(width, height) * 0.02));
  const samples = [
    [0, 0], [-offset, 0], [offset, 0], [0, -offset], [0, offset],
    [-offset, -offset], [offset, -offset], [-offset, offset], [offset, offset],
  ].map(([x, y]) => normalizeAgainstStripReference(
    samplePad(data, width, height, centerX + x, centerY + y),
    stripReference,
  ));
  const center = samples[0];
  const maxDistance = Math.max(...samples.slice(1).map((sample) => colorDistance(center, sample)));
  return { maxDistance, score: clamp(1 - (maxDistance / 30)) };
}

export function analyzeAquaChekPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): AquaChekPhotoAnalysis {
  if (width < 320 || height < 160 || data.length < width * height * 4) {
    throw new AquaChekPhotoError('bad-framing', 'Keep the strip horizontal inside the guide and fill most of its width.');
  }

  const stripReference = inspectStripReference(data, width, height);
  if (stripReference.lightness < 0.52 || stripReference.neutrality < 0.22 || stripReference.clipping > 0.8) {
    throw new AquaChekPhotoError('bad-background', 'Keep the full strip inside the guide so ChemCheck can use its pale backing for color correction.');
  }
  if (stripReference.uniformity < 0.5) {
    throw new AquaChekPhotoError('uneven-lighting', 'Move out of shadows or glare and retake in even light.');
  }

  const detectedPads = PAD_POSITIONS.map((position) => locatePad(data, width, height, position, stripReference.stripReference));
  const meanOffset = detectedPads.reduce((sum, pad, index) => {
    const expectedX = width * PAD_POSITIONS[index];
    const expectedY = height * 0.5;
    return sum + (Math.hypot(pad.x - expectedX, pad.y - expectedY) / Math.min(width, height));
  }, 0) / detectedPads.length;
  const framing = clamp(1 - (meanOffset / 0.075));
  if (framing < 0.35) {
    throw new AquaChekPhotoError('bad-framing', 'Center the strip in the guide with the handle on the right.');
  }

  const colors = detectedPads.map(({ x, y }) => normalizeAgainstStripReference(
    samplePad(data, width, height, x, y),
    stripReference.stripReference,
  ));
  const padUniformity = detectedPads.map(({ x, y }) => inspectPadUniformity(
    data,
    width,
    height,
    x,
    y,
    stripReference.stripReference,
  ));
  const forwardResults = PAD_KEYS.map((key, index) => matchReferenceColor(colors[index], AQUACHEK_COLOR_REFERENCES[key]));
  const reversedResults = PAD_KEYS.map((key, index) => matchReferenceColor(colors[colors.length - 1 - index], AQUACHEK_COLOR_REFERENCES[key]));
  const averageDistance = (matches: ReturnType<typeof matchReferenceColor>[]) => (
    matches.reduce((sum, match) => sum + match.distance, 0) / matches.length
  );
  const forwardDistance = averageDistance(forwardResults);
  const reversedDistance = averageDistance(reversedResults);
  const orientationMargin = Math.abs(forwardDistance - reversedDistance);
  if (Math.min(forwardDistance, reversedDistance) < 28 && orientationMargin < 4) {
    throw new AquaChekPhotoError('bad-framing', 'The strip direction was ambiguous. Retake with the handle clearly visible on the right.');
  }
  const reversed = reversedDistance < forwardDistance;
  const results = reversed ? reversedResults : forwardResults;
  const orderedUniformity = reversed ? [...padUniformity].reverse() : padUniformity;
  const uncertainIndex = results.findIndex((result, index) => (
    result.distance > 28 || result.confidence < 0.22 || orderedUniformity[index].maxDistance > 18
  ));
  if (uncertainIndex >= 0) {
    const key = PAD_KEYS[uncertainIndex];
    throw new AquaChekPhotoError(
      'uncertain-pad',
      `The ${PAD_LABELS[key]} pad was not clear enough to trust. Retake in even light without glare.`,
    );
  }

  const effectiveConfidence = results.map((result, index) => result.confidence * orderedUniformity[index].score);
  const padConfidence = Object.fromEntries(
    PAD_KEYS.map((key, index) => [key, roundMetric(effectiveConfidence[index])]),
  ) as Record<AquaChekPadKey, number>;
  const averageConfidence = effectiveConfidence.reduce((sum, confidenceValue) => sum + confidenceValue, 0) / effectiveConfidence.length;
  if (averageConfidence < 0.4) {
    throw new AquaChekPhotoError('uncertain-pad', 'The strip colors were too close to call confidently. Retake in brighter, even light.');
  }
  const confidence: StripAnalysisConfidence = averageConfidence >= 0.7 ? 'high' : averageConfidence >= 0.4 ? 'medium' : 'low';

  return {
    readings: {
      totalHardness: results[0].value,
      totalChlorine: results[1].value,
      totalBromine: results[1].value * 2,
      freeChlorine: results[2].value,
      ph: results[3].value,
      totalAlkalinity: results[4].value,
      cyanuricAcid: results[5].value,
    },
    confidence,
    reliable: true,
    analysisVersion: AQUACHEK_ANALYSIS_VERSION,
    padConfidence,
    quality: {
      // Backward-compatible audit field names. In analyzer v4 these describe
      // the strip substrate rather than the surrounding surface.
      backgroundLightness: roundMetric(stripReference.lightness),
      backgroundNeutrality: roundMetric(stripReference.neutrality),
      lightingUniformity: roundMetric(stripReference.uniformity),
      framing: roundMetric(framing),
    },
  };
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function analyzeAquaChekPhoto(file: File): Promise<AquaChekPhotoAnalysis> {
  if (!file.type.startsWith('image/') || file.size > 15 * 1024 * 1024) {
    throw new AquaChekPhotoError('invalid-file', 'Choose a photo smaller than 15 MB.');
  }
  let image: HTMLImageElement;
  try {
    image = await loadImage(file);
  } catch {
    throw new AquaChekPhotoError('invalid-file', 'This photo could not be decoded. Retake it with the device camera.');
  }
  if (image.naturalWidth === 0 || image.naturalHeight === 0) {
    throw new AquaChekPhotoError('invalid-file', 'This photo has no readable image data. Retake it with the device camera.');
  }
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 720 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Photo analysis is unavailable on this device.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  return analyzeAquaChekPixels(pixels, canvas.width, canvas.height);
}
