# ChemCheck

ChemCheck is a field operations platform for pool service businesses. It combines customer management, service logging, chemical tracking, route planning, and branded customer reports in a mobile-friendly web app.

**Live site:** https://chemcheck.xyz

## What it does

- Manage customer accounts and service schedules
- Record service logs and chemical usage
- Generate customer-facing service reports
- Deliver reports by SMS or email
- Optimize technician routes for the day
- Support mobile workflows with PWA/Capacitor packaging
- Track operational health, readiness, and sync behavior

## Product focus

ChemCheck is built for owner-operators and service teams who need a practical day-to-day operations tool rather than a generic CRM. The application is optimized around the weekly service route:

1. See today’s scheduled stops
2. Log completed service and chemistry
3. Review exceptions or missed visits
4. Send polished customer reports
5. Keep route and service data in sync across devices

## Tech stack

- **Frontend:** React 18 + Vite
- **UI:** Tailwind CSS + Radix UI
- **Backend / data:** Convex
- **Auth:** Clerk
- **Billing:** Stripe
- **Observability:** Sentry
- **Testing:** Vitest + Playwright
- **Mobile packaging:** Capacitor

## Key modules

- `src/pages/Home.jsx` — daily operations dashboard
- `src/pages/Customers*.jsx` / `CustomerDetail.jsx` — customer management
- `src/pages/NewServiceLog.jsx` — service logging workflow
- `src/pages/ChemicalUsage.jsx` — chemistry tracking
- `src/pages/RouteOptimizer.jsx` — route sequencing and timing
- `src/pages/ReportPage.jsx` — public customer report view
- `src/lib/sync/` — offline/sync and integrity logic
- `convex/` — backend functions and schema

## Local development

### Prerequisites

- Node.js 20+
- npm
- Convex project/environment
- Clerk, Stripe, and any required third-party service credentials

### Run locally

```bash
npm install
npm run dev
```

### Quality checks

```bash
npm run lint
npm test
npm run test:e2e
```

## Repository notes

This repository includes product notes and implementation documents used during development (`ARCHITECTURE.md`, deployment notes, testing docs, and feature summaries). The main application code lives under `src/` and `convex/`.

## Status

Active product repository. Public for review, integration, and developer evaluation.

## License

Proprietary / all rights reserved unless otherwise stated.
