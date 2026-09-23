import { describe, expect, it } from 'vitest';
import {
  AQUACHEK_ANALYSIS_VERSION,
  AQUACHEK_COLOR_REFERENCES,
  AquaChekPhotoError,
  type AquaChekPadKey,
  analyzeAquaChekPixels,
  matchReferenceColor,
  rgbToLab,
} from './aquachekImageAnalysis';
import { AQUACHEK_READING_LEVELS } from './aquachek';

type Rgb = [number, number, number];

function createStripFrame(options: {
  cast?: Rgb;
  brightness?: number;
  overridePad?: { index: number; color: Rgb };
  glarePadIndex?: number;
  unevenLighting?: boolean;
  reversed?: boolean;
} = {}) {
  const width = 1200;
  const height = 600;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const cast = options.cast ?? [1, 1, 1];
  const brightness = options.brightness ?? 1;
  const paint = (left: number, top: number, right: number, bottom: number, color: Rgb) => {
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const shade = options.unevenLighting && x < width / 2 ? 0.55 : 1;
        const offset = ((y * width) + x) * 4;
        pixels[offset] = Math.min(255, Math.round(color[0] * cast[0] * brightness * shade));
        pixels[offset + 1] = Math.min(255, Math.round(color[1] * cast[1] * brightness * shade));
        pixels[offset + 2] = Math.min(255, Math.round(color[2] * cast[2] * brightness * shade));
        pixels[offset + 3] = 255;
      }
    }
  };

  paint(0, 0, width, height, [238, 243, 241]);
  paint(170, 245, 1030, 355, [253, 252, 244]);
  const keys: AquaChekPadKey[] = ['totalHardness', 'totalChlorine', 'freeChlorine', 'ph', 'totalAlkalinity', 'cyanuricAcid'];
  const referenceIndexes = [2, 3, 3, 2, 3, 1];
  const centers = [264, 384, 504, 624, 744, 864];
  keys.forEach((key, index) => {
    const sourceIndex = options.reversed ? keys.length - 1 - index : index;
    const color = options.overridePad?.index === sourceIndex
      ? options.overridePad.color
      : AQUACHEK_COLOR_REFERENCES[keys[sourceIndex]][referenceIndexes[sourceIndex]].color;
    paint(centers[index] - 33, 267, centers[index] + 33, 333, color);
    if (options.glarePadIndex === index) {
      paint(centers[index] + 5, 285, centers[index] + 24, 304, [255, 255, 255]);
    }
  });
  return { pixels, width, height };
}

function capturePhotoError(run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AquaChekPhotoError);
    return (error as AquaChekPhotoError).code;
  }
  throw new Error('Expected AquaChek photo analysis to fail');
}

describe('AquaChek photo color matching', () => {
  it('maps an exact reference color to its chart value', () => {
    const reference = AQUACHEK_COLOR_REFERENCES.ph[2];
    const match = matchReferenceColor(reference.color, AQUACHEK_COLOR_REFERENCES.ph);
    expect(match.value).toBe(7.2);
    expect(match.distance).toBe(0);
  });

  it('keeps recognition references aligned with the logged comparator levels', () => {
    const keys = ['totalHardness', 'totalChlorine', 'freeChlorine', 'ph', 'totalAlkalinity', 'cyanuricAcid'] as const;
    keys.forEach((key) => {
      expect(AQUACHEK_COLOR_REFERENCES[key].map(({ value }) => value)).toEqual([...AQUACHEK_READING_LEVELS[key]]);
    });
  });

  it('keeps perceptually similar colors close in Lab space', () => {
    const first = rgbToLab([200, 80, 140]);
    const second = rgbToLab([202, 82, 141]);
    const delta = Math.sqrt(first.reduce((sum, value, index) => sum + ((value - second[index]) ** 2), 0));
    expect(delta).toBeLessThan(2);
  });

  it('returns an auditable result for a clean, correctly framed strip', () => {
    const frame = createStripFrame();
    const result = analyzeAquaChekPixels(frame.pixels, frame.width, frame.height);

    expect(result.readings).toMatchObject({
      totalHardness: 250,
      totalChlorine: 3,
      freeChlorine: 3,
      ph: 7.2,
      totalAlkalinity: 120,
      cyanuricAcid: 50,
    });
    expect(result.reliable).toBe(true);
    expect(result.analysisVersion).toBe(AQUACHEK_ANALYSIS_VERSION);
    expect(Object.keys(result.padConfidence)).toHaveLength(6);
    expect(result.quality.backgroundNeutrality).toBeGreaterThan(0.8);
  });

  it('normalizes a moderate camera color cast before matching pads', () => {
    const frame = createStripFrame({ cast: [0.9, 1, 1.05] });
    const result = analyzeAquaChekPixels(frame.pixels, frame.width, frame.height);

    expect(result.readings.ph).toBe(7.2);
    expect(result.readings.totalAlkalinity).toBe(120);
    expect(result.reliable).toBe(true);
  });

  it('normalizes ordinary underexposure before matching pads', () => {
    const frame = createStripFrame({ brightness: 0.78 });
    const result = analyzeAquaChekPixels(frame.pixels, frame.width, frame.height);

    expect(result.readings).toMatchObject({
      totalHardness: 250,
      totalChlorine: 3,
      freeChlorine: 3,
      ph: 7.2,
      totalAlkalinity: 120,
      cyanuricAcid: 50,
    });
  });

  it('recognizes every exact comparator level instead of overfitting the happy-path colors', () => {
    const keys = ['totalHardness', 'totalChlorine', 'freeChlorine', 'ph', 'totalAlkalinity', 'cyanuricAcid'] as const;

    keys.forEach((key, padIndex) => {
      AQUACHEK_COLOR_REFERENCES[key].forEach((reference) => {
        const frame = createStripFrame({ overridePad: { index: padIndex, color: reference.color } });
        const result = analyzeAquaChekPixels(frame.pixels, frame.width, frame.height);
        expect(result.readings[key], `${key} should recognize ${reference.value}`).toBe(reference.value);
      });
    });
  });

  it('identifies a reversed strip from the pad sequence instead of returning plausible wrong readings', () => {
    const frame = createStripFrame({ reversed: true });
    const result = analyzeAquaChekPixels(frame.pixels, frame.width, frame.height);

    expect(result.readings).toMatchObject({
      totalHardness: 250,
      totalChlorine: 3,
      freeChlorine: 3,
      ph: 7.2,
      totalAlkalinity: 120,
      cyanuricAcid: 50,
    });
  });

  it('fails closed when one LSI-critical pad cannot be matched', () => {
    const frame = createStripFrame({ overridePad: { index: 3, color: [20, 220, 220] } });

    expect(capturePhotoError(() => analyzeAquaChekPixels(frame.pixels, frame.width, frame.height)))
      .toBe('uncertain-pad');
  });

  it('fails closed when a pad sits ambiguously between comparator colors', () => {
    const lower = AQUACHEK_COLOR_REFERENCES.ph[1].color;
    const upper = AQUACHEK_COLOR_REFERENCES.ph[2].color;
    const midpoint = lower.map((channel, index) => Math.round((channel + upper[index]) / 2)) as Rgb;
    const frame = createStripFrame({ overridePad: { index: 3, color: midpoint } });

    expect(capturePhotoError(() => analyzeAquaChekPixels(frame.pixels, frame.width, frame.height)))
      .toBe('uncertain-pad');
  });

  it('fails closed under strongly uneven lighting', () => {
    const frame = createStripFrame({ unevenLighting: true });

    expect(capturePhotoError(() => analyzeAquaChekPixels(frame.pixels, frame.width, frame.height)))
      .toBe('uneven-lighting');
  });

  it('fails closed when glare makes a pad internally inconsistent', () => {
    const frame = createStripFrame({ glarePadIndex: 3 });

    expect(capturePhotoError(() => analyzeAquaChekPixels(frame.pixels, frame.width, frame.height)))
      .toBe('uncertain-pad');
  });

  it('meets the synthetic field-condition performance gate', () => {
    const expected = {
      totalHardness: 250,
      totalChlorine: 3,
      freeChlorine: 3,
      ph: 7.2,
      totalAlkalinity: 120,
      cyanuricAcid: 50,
    };
    const validCases = [
      { name: 'baseline', options: {} },
      { name: '72% exposure', options: { brightness: 0.72 } },
      { name: '80% exposure', options: { brightness: 0.8 } },
      { name: '90% exposure', options: { brightness: 0.9 } },
      { name: 'cool cast', options: { cast: [0.9, 1, 1.05] as Rgb } },
      { name: 'warm cast', options: { cast: [1.04, 0.96, 1] as Rgb } },
      { name: 'dim cool cast', options: { brightness: 0.82, cast: [0.94, 1, 1.04] as Rgb } },
      { name: 'dim warm cast', options: { brightness: 0.9, cast: [1.03, 0.97, 1] as Rgb } },
    ];
    const invalidCases = [
      { brightness: 0.45 },
      { brightness: 1.2 },
      { unevenLighting: true },
      { glarePadIndex: 3 },
    ];

    const failedValidCases = validCases.map(({ name, options }) => {
      try {
        const frame = createStripFrame(options);
        const result = analyzeAquaChekPixels(frame.pixels, frame.width, frame.height);
        return (Object.keys(expected) as (keyof typeof expected)[]).every((key) => result.readings[key] === expected[key])
          ? null
          : `${name}: ${JSON.stringify(result.readings)}`;
      } catch (error) {
        return `${name}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }).filter(Boolean);
    const rejectedCorrectly = invalidCases.filter((options) => {
      try {
        const frame = createStripFrame(options);
        analyzeAquaChekPixels(frame.pixels, frame.width, frame.height);
        return false;
      } catch (error) {
        return error instanceof AquaChekPhotoError;
      }
    }).length;

    expect(failedValidCases).toEqual([]);
    expect(rejectedCorrectly).toBe(invalidCases.length);
  });
});
