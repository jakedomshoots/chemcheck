# AquaChek field calibration runbook

This workflow measures the current photo decoder against independent chemistry results. It does not automatically replace production color anchors. A new anchor set should only be promoted after the corpus passes coverage and accuracy gates and a held-out validation set confirms the improvement.

## Start a corpus

From the release checkout:

```bash
npm run calibrate:aquachek -- --init calibration/aquachek-field
```

This creates `manifest.csv` and a `photos/` directory. Keep this field corpus out of Git. Use opaque sample IDs; do not put customer names, addresses, phone numbers, or other customer data in filenames or the manifest.

## Collect each sample

1. Take a clean water sample before adding chemicals.
2. Dip a fresh AquaChek Select 7-in-1 strip according to its package directions.
3. Photograph the full strip on a plain white or light-gray surface, with the handle on the right, in even light without glare.
4. Record the actual number of seconds between removing the strip and taking the photo. AquaChek's product insert says to hold the strip level, pad side up, for 15 seconds and then compare immediately. The calibration gate allows 14–16 seconds for human capture variance; the app does not impose a countdown.
5. Immediately test the same water using the best independent method available. A well-performed drop test is the practical route baseline. Use a calibrated photometer or laboratory result when available.
6. Record the camera model, strip lot printed on the container, and lighting condition.
7. Assign the photo to `calibration` while fitting anchors or `validation` before tuning begins. Never move a calibration photo into validation later.

Do not copy the strip bottle's color-comparator reading into the truth columns. The truth values must come from an independent test.

## Manifest columns

| Column | Meaning |
| --- | --- |
| `sample_id` | Opaque unique ID such as `route-2026-09-22-001` |
| `image` | Photo path relative to the corpus directory |
| `device` | Camera/device model |
| `strip_lot` | Lot code from the strip container |
| `seconds_after_dip` | Measured photo timing |
| `lighting` | Consistent label such as `outdoor-shade`, `indoor-led`, or `garage-open-door` |
| `cohort` | `calibration` for anchor fitting or `validation` for untouched final evaluation |
| `truth_method` | `drop-test`, `photometer`, `laboratory`, or `mixed` |
| `truth_instrument` | Specific kit, meter, or laboratory name and model |
| `total_hardness` | Independent total-hardness result in ppm as CaCO3 |
| `total_chlorine` | Independent result in ppm |
| `free_chlorine` | Independent result in ppm |
| `ph` | Independent pH result |
| `total_alkalinity` | Independent result in ppm |
| `cyanuric_acid` | Independent result in ppm |

Truth readings may be blank when a trustworthy independent result was not collected. Never estimate a missing truth value.

The Select hardness pad measures total hardness from calcium and magnesium. Do not enter an ordinary calcium-hardness-only drop test in `total_hardness`; use a genuine total-hardness method or leave that field blank. Calcium hardness remains the correct detailed input for LSI, but it is not interchangeable with the strip's total-hardness calibration truth.

Total chlorine and total bromine share one physical pad and use different scales. This calibration scores that pad on its total-chlorine scale; bromine remains a derived display value rather than a separate color measurement.

## Score the corpus

```bash
npm run calibrate:aquachek -- calibration/aquachek-field
```

The command accepts JPEG, PNG, and WebP photos, runs every image through the exact Chromium/browser-side decoder used by the app, and writes:

- `reports/latest.md` — readable coverage, accuracy, rejections, and decision
- `reports/latest.json` — complete audit data for anchor fitting and comparison

Use `--require-ready` in a release gate when a non-ready result should return a failing exit status.

## Current promotion gates

- At least 40 accepted calibration photos for later anchor fitting
- At least 20 accepted calibration truth pairs for every pad, so anchor fitting never starts from an empty pad
- At least 10 accepted, untouched validation photos
- At least 10 accepted validation truth pairs for every pad
- At least 2 camera devices, 2 strip lots, and 3 lighting conditions among accepted validation photos
- At least 85% photo acceptance
- At least 90% of photos captured in the 14–16 second window around AquaChek's specified 15-second read
- At least 65% exact comparator-level accuracy for every pad
- At least 90% within-one-comparator-level accuracy for every pad

Use a separate held-out set for the final check. Do not tune anchors and validate them on the same photos.

## Suggested collection design

Aim for 60–80 calibration photos so rejected images and missing truth values do not leave the fitting set short. Deliberately include low, normal, and high chemistry, rather than taking dozens of nearly identical balanced pools. Capture at least 10 additional validation photos that are labeled before tuning and never used while fitting anchors.

Use consistent device, lot, and lighting labels. Readiness diversity is counted only across accepted validation photos. The runner rejects repeated image paths and byte-identical photos so one photo cannot inflate the corpus.

If an iPhone supplies HEIC/HEIF, export or capture a JPEG before adding it to this desktop corpus. Chromium does not reliably decode HEIC, so the runner intentionally does not advertise it as supported.

Manufacturer references: [AquaChek Select Connect product page](https://www.aquachek.com/product/aquachek-select-connect-kit/) and its linked Select product insert.
