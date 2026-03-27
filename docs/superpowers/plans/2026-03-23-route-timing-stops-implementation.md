# Route Timing and Daily Stops Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify Home and Route Planner timing calculations under a shared service-only estimator, with no UI/style changes.

**Architecture:** Add a pure timing estimator in `src/lib` and have both `Home` and `RouteOptimizer` consume it for totals/time-per-pool/capacity. Keep existing route ordering logic intact, but remove travel/wait from displayed totals. Preserve current component structure and visual design.

**Tech Stack:** React, Vite, Vitest, existing app utilities in `src/lib`.

---

## File Structure

- Create: `src/lib/routeTimingEstimator.ts`
  - Pure functions for duration resolution, service-only totals, and day capacity.
- Create: `src/lib/routeTimingEstimator.test.ts`
  - Unit tests for precedence, fallback, aggregation, and hours parsing/capacity.
- Modify: `src/pages/Home.jsx`
  - Replace flat `customers.length * 25` estimate with shared estimator output.
- Modify: `src/pages/RouteOptimizer.jsx`
  - Reuse shared estimator outputs for displayed totals and remove travel/wait totals from UI data payload.
- Modify: `src/pages/Home.test.jsx`
  - Update expectations for ops brief timing behavior.
- Modify: `src/lib/routeOptimizer.test.ts` (only if needed)
  - Keep ordering/time internals valid; ensure no regression pressure from UI-level total changes.

### Task 1: Build Shared Estimator (TDD)

**Files:**
- Create: `src/lib/routeTimingEstimator.test.ts`
- Create: `src/lib/routeTimingEstimator.ts`

- [ ] **Step 1: Write failing estimator tests**

```ts
import { describe, expect, it } from "vitest";
import {
  resolveServiceDurationMinutes,
  buildDurationProfile,
  calculateServiceTimingSummary,
  parseWorkingHoursCapacity,
} from "./routeTimingEstimator";

describe("routeTimingEstimator", () => {
  it("prefers explicit duration over history and fallback", () => {
    const result = resolveServiceDurationMinutes(
      { estimatedDuration: 22 },
      { customerMedian: 18, fallback: 15 }
    );
    expect(result).toBe(22);
  });

  it("uses customer historical median when explicit missing", () => {
    const result = resolveServiceDurationMinutes({}, { customerMedian: 17, fallback: 15 });
    expect(result).toBe(17);
  });

  it("uses fallback 15 when no explicit or history", () => {
    const result = resolveServiceDurationMinutes({}, { customerMedian: null, fallback: 15 });
    expect(result).toBe(15);
  });

  it("calculates service-only totals and time per pool", () => {
    const summary = calculateServiceTimingSummary([
      { estimatedDuration: 20 },
      { estimatedDuration: 10 },
    ], { fallback: 15 });
    expect(summary.stopsAssigned).toBe(2);
    expect(summary.totalServiceMinutes).toBe(30);
    expect(summary.timePerPoolMinutes).toBe(15);
  });

  it("returns null capacity for invalid working hours", () => {
    expect(parseWorkingHoursCapacity("17:00", "08:00", 15)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/routeTimingEstimator.test.ts`
Expected: FAIL with module/function missing errors.

- [ ] **Step 3: Implement minimal estimator module**

```ts
export function resolveServiceDurationMinutes(customer, ctx) {
  // explicit -> customer median -> fallback(15)
}

export function buildDurationProfile(serviceLogs) {
  // customer median map from valid duration_ms entries
}

export function calculateServiceTimingSummary(customers, options) {
  // returns stopsAssigned, totalServiceMinutes, timePerPoolMinutes
}

export function parseWorkingHoursCapacity(start, end, timePerPoolMinutes) {
  // returns floor(available/timePerPool) or null
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/routeTimingEstimator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/routeTimingEstimator.ts src/lib/routeTimingEstimator.test.ts
git commit -m "feat: add shared service-only route timing estimator"
```

### Task 2: Integrate Home Ops Brief

**Files:**
- Modify: `src/pages/Home.jsx`
- Test: `src/pages/Home.test.jsx`

- [ ] **Step 1: Write/update failing Home test**

```jsx
it("uses shared service-only timing for ops brief", () => {
  // assert ops brief no longer assumes customerCount * 25
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/Home.test.jsx`
Expected: FAIL on old estimate assumption.

- [ ] **Step 3: Replace Home estimate logic with shared estimator**

```jsx
import { calculateServiceTimingSummary } from "@/lib/routeTimingEstimator";

const opsBrief = useMemo(() => {
  const summary = calculateServiceTimingSummary(customersForSelectedDay, { fallback: 15 });
  return {
    pendingStops: summary.stopsAssigned,
    estimatedRouteMinutes: summary.totalServiceMinutes,
  };
}, [customersForSelectedDay]);
```

- [ ] **Step 4: Run Home tests**

Run: `npx vitest run src/pages/Home.test.jsx src/pages/Home.offDayFlow.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Home.jsx src/pages/Home.test.jsx
git commit -m "refactor: use shared service-only timing in home ops brief"
```

### Task 3: Integrate Route Planner Service-Only Totals

**Files:**
- Modify: `src/pages/RouteOptimizer.jsx`
- Test: `src/lib/routeOptimizer.test.ts` (if expectation drift)

- [ ] **Step 1: Add/update failing assertion around displayed totals source**

```ts
it("exposes service-only totals for route summary", async () => {
  // ensure UI-facing totals derive from estimator, not travel/wait aggregation
});
```

- [ ] **Step 2: Run target tests to confirm fail**

Run: `npx vitest run src/lib/routeOptimizer.test.ts`
Expected: FAIL only if current assertions encode old behavior.

- [ ] **Step 3: Wire shared estimator into RouteOptimizer summary payload**

```jsx
import {
  buildDurationProfile,
  calculateServiceTimingSummary,
  parseWorkingHoursCapacity,
} from "@/lib/routeTimingEstimator";

// use summary.totalServiceMinutes for displayed total_estimated_minutes
// stop populating/displaying travel/wait totals in UI payload
```

- [ ] **Step 4: Run Route Planner related tests**

Run: `npx vitest run src/lib/routeOptimizer.test.ts src/pages/ProtectedAppRoutes.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/RouteOptimizer.jsx src/lib/routeOptimizer.test.ts
git commit -m "refactor: align route planner totals to service-only timing"
```

### Task 4: Verification + Documentation Touchups

**Files:**
- Modify (if needed): `docs/superpowers/specs/2026-03-23-route-timing-stops-design.md`

- [ ] **Step 1: Run focused regression suite**

Run: `npx vitest run src/lib/routeTimingEstimator.test.ts src/pages/Home.test.jsx src/lib/routeOptimizer.test.ts`
Expected: PASS.

- [ ] **Step 2: Run broader smoke tests for impacted routes**

Run: `npx vitest run src/pages/RouteOptimizer.jsx src/pages/Home.offDayFlow.test.jsx`
Expected: No new failures in affected flows.

- [ ] **Step 3: Validate no unintended UI/style changes**

Run: `git diff -- src/pages/Home.jsx src/pages/RouteOptimizer.jsx`
Expected: Logic changes only; no className/layout redesign.

- [ ] **Step 4: Final commit for any plan-follow-up adjustments**

```bash
git add -A
git commit -m "test: verify shared service-only timing integration"
```

## Implementation Notes

- Keep changes DRY by removing duplicated duration fallback logic where possible.
- Keep YAGNI guardrails: no new settings toggles, no new screen elements.
- Follow @test-driven-development and @verification-before-completion patterns during execution.

## Done Criteria

- Home and Route Planner show consistent service-only timing totals.
- `time per pool` uses explicit -> history median -> fallback(15) precedence.
- Daily capacity is derived from working-hours and service-only timing.
- No visual redesign and no additional configuration parameters introduced.
