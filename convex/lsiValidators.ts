import { v } from "convex/values";

export const stripScanAnalysisVersionValidator = v.union(
  v.literal("aquachek-select-v2"),
  v.literal("aquachek-select-v3"),
  v.literal("aquachek-select-v4"),
);

export const stripScanPadConfidenceValidator = v.object({
  totalHardness: v.number(),
  totalChlorine: v.number(),
  freeChlorine: v.number(),
  ph: v.number(),
  totalAlkalinity: v.number(),
  cyanuricAcid: v.number(),
});

export const stripScanQualityValidator = v.object({
  backgroundLightness: v.number(),
  backgroundNeutrality: v.number(),
  lightingUniformity: v.number(),
  framing: v.number(),
});
