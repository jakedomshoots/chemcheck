# Design QA: Route Resolution and Service-Day Rail

## Scope

- Home route card: make a resolved/skipped stop read as a successful outcome without changing its truthful `Skipped` status or recovery actions.
- Clients service-day selector: replace the visually uneven tabs and nested count bubble with a clean, connected five-day rail.
- Preserve the existing ChemCheck visual system, navigation, typography, icons, and surrounding page structure.

## Visual truth and implementation captures

| Surface | Reference | Final implementation |
| --- | --- | --- |
| Home | `/Users/jakedom/.codex/visualizations/2026/07/27/019fa125-6439-7753-a55d-7fb3dd27dcfd/home-clients-refine/home-before.png` | `/Users/jakedom/.codex/visualizations/2026/07/27/019fa125-6439-7753-a55d-7fb3dd27dcfd/home-clients-refine/home-after.png` |
| Clients | `/Users/jakedom/.codex/visualizations/2026/07/27/019fa125-6439-7753-a55d-7fb3dd27dcfd/home-clients-refine/clients-before.png` | `/Users/jakedom/.codex/visualizations/2026/07/27/019fa125-6439-7753-a55d-7fb3dd27dcfd/home-clients-refine/clients-after.png` |

- Reference and implementation captures were compared together at the same 528 x 987 CSS-pixel viewport and 1x capture density.
- Home state: Monday, July 27, 2026; `john snow` is skipped/resolved.
- Clients state: Monday selected; one scheduled client.
- Separate target crops were unnecessary because both annotated regions are large and legible at native full-view size; their geometry and computed styles were also inspected directly.

## Fidelity review

- Typography: existing typefaces, weights, labels, and hierarchy preserved.
- Spacing and layout: surrounding page geometry preserved; only the annotated target controls were refined.
- Color and tokens: resolved work now uses the existing success family. Success tinting was corrected to sRGB mixing so green stays green against an achromatic surface.
- Shape: service-day rail verified at 12px outer radius with five equal 40px-high segments and 8px active-segment radius.
- Assets: no new imagery required; existing icon-library assets remain intact.
- Copy and meaning: `Skipped`, `Resume`, and `Move back` remain truthful and unchanged.
- Responsive behavior: no horizontal overflow at 528 x 987 or 390 x 844; all five day targets remain at least 64px wide and 40px high.

## Interaction and technical checks

- Selected Tuesday, confirmed its active state, then restored Monday.
- Reloaded the final Clients view and observed zero new browser console warnings or errors after the reload cutoff.
- Focused component tests: 14 passed across `CustomerCard.test.jsx` and `Clients.test.jsx`.
- Lint: passed.
- Production build: passed. The build still reports the pre-existing Tailwind ambiguity warning in the unrelated, user-edited `LandingPage.jsx`.
- `git diff --check`: passed before handoff.

## Iteration history

1. The first success-state pass still appeared pink because `ok` was mixed with an achromatic surface in OKLCH. The shared soft and line tokens were changed to sRGB mixing, then the page was recaptured and re-compared.
2. The first active day segment computed to a 10px radius because the base Radix class won the cascade. The component now explicitly applies the established 8px chip radius; the final 12px/8px geometry was measured in-browser.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: none in the annotated scope.

final result: passed
