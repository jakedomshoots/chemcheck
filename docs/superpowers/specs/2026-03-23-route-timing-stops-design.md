# Route Timing and Daily Stops Logic Redesign (Logic-Only)

Date: 2026-03-23
Status: Approved (Design)
Scope: Logic-only changes. No UI layout/style changes.

## 1. Problem Statement
Current timing estimates are inconsistent across the app:
- Home uses a flat estimate (`customerCount * 25`)
- Route Planner uses richer calculations that include service, travel, and wait

This creates drift in perceived "time per pool" and daily stop planning.

## 2. Goals
- Use one shared source of truth for timing logic.
- Define "time per pool" as service-only minutes.
- Keep current design/style and page structure unchanged.
- Use all assigned stops for day totals (completed + skipped + pending).
- Remove travel/wait from displayed route time totals.

## 3. Non-Goals
- No visual redesign.
- No new UI controls.
- No hard max-stops/day parameter.
- No changes to route map/order presentation beyond timing calculations.

## 4. Decisions Captured
1. Time-per-pool definition: service-only.
2. Daily capacity model: based on working-hours and service-only timing; no extra hard stop cap.
3. No-history fallback service duration: 15 minutes.
4. Day totals basis: all assigned stops for selected day.
5. Source of truth: shared estimator used by Home and Route Planner.
6. Route Planner displayed totals: service-only (no travel/wait totals).

## 5. Proposed Architecture
Introduce one shared pure logic module for timing estimation. This module will:
- Accept customer/day inputs and optional duration history context.
- Resolve effective per-customer service duration.
- Return canonical service-only metrics consumed by both Home and Route Planner.

Home and Route Planner keep existing component structure and style. They only swap their calculation source to this shared module.

## 6. Data Inputs and Resolution Order
Inputs:
- Selected day customers (all assigned for that day)
- Explicit customer duration fields (if present)
- Historical service durations (`duration_ms`) grouped by customer
- Working-hours start/end settings
- Default fallback duration (15 minutes)

Duration resolution per customer (in order):
1. Explicit duration (if valid)
2. Historical median for customer (if valid)
3. Global fallback (15)

Validation/normalization:
- Reject invalid/non-finite duration values.
- Reject duration <= 0.
- Clamp unrealistic outliers to configured bounds used by current logic.

## 7. Canonical Outputs
Shared estimator returns:
- `stopsAssigned`
- `totalServiceMinutes`
- `timePerPoolMinutes`
- `stopsPerDayCapacity` (from working-hours / time-per-pool)

Behavior:
- If no stops assigned, totals are zero.
- If working-hours invalid, capacity is `null`.

## 8. Integration Plan (Logic Only)
### 8.1 Home
Replace current ops brief estimate calculation with shared estimator output.
- Remove flat `customers.length * 25` dependency.
- Keep existing ops brief UI unchanged.

### 8.2 Route Planner
Keep route ordering logic as-is.
Replace displayed timing totals to service-only metrics from shared estimator.
- Do not display travel/wait as route total components.

## 9. Error Handling and Guardrails
- Missing or invalid explicit durations: fall through to next source.
- Missing history: fallback 15.
- Invalid working-hours config (parse failure or end <= start): capacity `null`, no crash.
- Empty day: deterministic zero totals.

## 10. Test Strategy
Add/update tests for shared estimator:
- Explicit duration precedence over history/fallback.
- Historical median use when explicit absent.
- Fallback 15 when no explicit/history.
- Correct service-only total aggregation.
- Capacity computation from working-hours.
- Invalid-hours safe behavior.

Update page-level expectations:
- Home no longer uses hard-coded `* 25` estimator.
- Route Planner displayed totals no longer include travel/wait totals.

## 11. Risks and Mitigations
Risk: Existing assumptions in Route Planner tests may rely on travel/wait totals.
Mitigation: Update expectations only where totals are displayed; preserve ordering behavior tests.

Risk: Partial migration could reintroduce mismatch.
Mitigation: Use a single shared estimator and remove duplicate timing computations in page components.

## 12. Rollout Notes
- This change is internal logic only and should be safe for progressive rollout.
- No migration needed for stored customer records.
