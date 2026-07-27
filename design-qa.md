# Design QA: Client Directory Option 2

## Comparison target

- Source visual truth: `/Users/jakedom/.codex/generated_images/019fa125-6439-7753-a55d-7fb3dd27dcfd/exec-3726e233-68d9-4996-afc6-97052e0f2e46.png`
- Normalized source: `/Users/jakedom/.codex/visualizations/2026/07/27/019fa125-6439-7753-a55d-7fb3dd27dcfd/client-directory-option-2/source-option-2-528x987.png`
- Browser-rendered implementation: `/Users/jakedom/.codex/visualizations/2026/07/27/019fa125-6439-7753-a55d-7fb3dd27dcfd/client-directory-option-2/clients-directory-expanded-528x987.jpg`
- Route and state: `http://localhost:5173/clients`, light theme, Directory selected, one live client expanded.
- Viewport: 528 x 987 CSS pixels at 1x capture density.
- Source dimensions: 917 x 1715 pixels, normalized to 528 x 987 for comparison.
- Implementation dimensions: 528 x 987 pixels from a 528 x 987 CSS viewport.

## Evidence reviewed

- Full-view comparison: the normalized source and expanded implementation were opened together at 528 x 987. The command header, two-mode rail, Add Client action, shared search, alphabetical group, expanded action tray, right-edge alphabet, and bottom navigation were compared in the same interaction state.
- Focused source region: `/Users/jakedom/.codex/visualizations/2026/07/27/019fa125-6439-7753-a55d-7fb3dd27dcfd/client-directory-option-2/source-option-2-focused.png`
- Focused implementation region: `/Users/jakedom/.codex/visualizations/2026/07/27/019fa125-6439-7753-a55d-7fb3dd27dcfd/client-directory-option-2/clients-directory-focused.png`
- The focused comparison covered the header hierarchy, segmented control, button and search geometry, group letter, contact-row typography, day label, chevron, avatar tint, and alphabet rail.
- The source uses several fictional contacts while the implementation truthfully renders the one client currently stored in the local app. This data-state difference is expected; multi-group sorting, search, and contact actions are exercised with realistic fixtures in the focused tests.

## Required fidelity surfaces

- Fonts and typography: the existing Outfit product font matches the selected direction's rounded geometric voice. Display weight, uppercase roster label, 14px contact name, 12px metadata, and condensed action labels preserve the source hierarchy without introducing a second font.
- Spacing and layout rhythm: the mobile header was reduced to 191.5px while retaining 40px view targets and a 44px primary action. Search, section heading, grouped row, 27-letter edge index, and persistent bottom navigation align without horizontal overflow.
- Colors and visual tokens: the active Directory segment and Add Client action use the established pool-cyan brand token. The avatar now uses a true cyan soft tint; neutral surfaces, ink, dividers, and disabled contact actions preserve semantic contrast.
- Image quality and asset fidelity: the screen requires no new raster imagery. The existing ChemCheck logo is preserved and all interface icons use the project's established Lucide family rather than custom SVG or CSS drawings.
- Copy and content: `Schedule`, `Directory`, `Add Client`, the shared search prompt, service-day abbreviation, `Call`, `Text`, `Directions`, and `Open Profile` match the selected workflow. Missing phone data is stated plainly and disables only the unavailable actions.
- Responsiveness and accessibility: the 528px target has no horizontal overflow. Contact action targets measure 44 x 117.5px, the segmented mode supports Left/Right/Home/End keys, rows expose `aria-expanded`, the action tray is labelled, search is labelled, and unavailable alphabet letters and actions are semantically disabled.

## Primary interactions tested

- Confirmed a fresh Clients navigation starts in Schedule mode.
- Switched from Schedule to Directory and verified the service-day rail and Reorder action leave the active UI.
- Searched to a no-results state, verified its copy, and restored the directory.
- Expanded a client and verified the four-action tray.
- Verified missing phone data disables Call and Text without disabling Directions or Profile.
- Opened the client profile from the action tray, confirmed `/customerdetail?id=1`, then returned to Clients.
- Verified the alphabet exposes the available `J` section and disables unavailable letters.
- Checked the final browser console after an acceptance cutoff: zero new warnings or errors.

## Comparison history

1. P2 — The first implementation header was substantially taller than the selected source and pushed the directory below the intended fold. The Directory count was removed, mobile padding and gaps were tightened, and the header was recaptured at 191.5px tall while retaining accessible control sizes.
2. P2 — The initial avatar used the shared OKLCH brand-soft mix, which visibly drifted pink against the white surface. Brand soft and softer tokens now use sRGB mixing; the post-fix computed avatar background is `color(srgb 0.903356 0.958643 0.969868)`, a stable pale cyan.
3. P3 — The source shows several populated alphabet groups while the local implementation has one real client. No fictional records were added to user data. The production component is verified with multi-group fixtures and will fill the same structure as customers are added.

## Verification

- Focused tests: 16 passed across `clientDirectory.test.ts`, `ClientDirectory.test.jsx`, and `Clients.test.jsx`.
- Lint: passed with zero warnings.
- Production build: passed. The existing unrelated Tailwind ambiguity warning remains in the user-edited `LandingPage.jsx`.
- `git diff --check`: passed before staging.

## Findings

- P0: none.
- P1: none.
- P2: none remaining.
- P3: live content density is intentionally lower than the illustrative source until more clients exist.

final result: passed
