```
________                   ________              __
  / ____/ /_  ___  ____ ___  / ____/ /_  ___  _____/ /__
 / /   / __ \/ _ \/ __ `__ \/ /   / __ \/ _ \/ ___/ //_/
/ /___/ / / /  __/ / / / / / /___/ / / /  __/ /__/ ,<
\____/_/ /_/\___/_/ /_/ /_/\____/_/ /_/\___/\___/_/|_|

       Pool service field operations, end to end.
```

# ChemCheck

**Live:** [chemcheck.xyz](https://chemcheck.xyz)

ChemCheck is a field operations platform for pool service businesses. It combines
customer management, service logging, chemical tracking, route planning, and
branded customer reports in a mobile-friendly web app — with offline-first sync
so a tech with no signal can still finish a stop.

```
       ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
       │  Today's │ →  │   Log    │ →  │  Catch   │ →  │   Send   │ →  │  Stay    │
       │  Route   │    │  Visit   │    │  Misses  │    │  Report  │    │  Synced  │
       └──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
          30s            2 min           10s            15s             automatic
```

## Why it exists

Owner-operators and small service teams don't need another generic CRM — they
need a tool built around the **weekly service route**:

1. See today's scheduled stops
2. Log the service and the chemistry
3. Review exceptions and missed visits
4. Send the customer a polished report
5. Keep route and service data in sync across devices

ChemCheck does that, plus the surrounding plumbing: branded SMS/email reports,
capacitor mobile packaging for on-device use, and a sync service that handles
the inevitable offline-edit conflicts.

## Features

- **Customer & route management** — full CRM with service-day scheduling
- **Service logging** — chemistry readings, photos, notes, time tracking
- **Chemical usage tracking** — extra-chemical billing records per customer
- **Customer reports** — branded web reports delivered by SMS or email
- **Route optimizer** — stop sequencing and timing for the day
- **Offline-first sync** — IndexedDB cache + Convex cloud, conflict-resolving
- **Mobile packaging** — Capacitor (iOS/Android) and PWA
- **Operational health** — readiness dashboard and sync telemetry

## Tech stack

| Layer        | Tech                                       |
|--------------|--------------------------------------------|
| Frontend     | React 18 + Vite                            |
| UI           | Tailwind CSS + Radix UI                    |
| Backend      | Convex (real-time database)                |
| Auth         | Clerk                                      |
| Billing      | Stripe                                     |
| Local cache  | Dexie (IndexedDB)                          |
| Mobile       | Capacitor (iOS/Android) + PWA              |
| Observability| Sentry                                     |
| Testing      | Vitest + Playwright                        |

## Quick start

```bash
# 1. Install
npm install

# 2. Configure env (Convex, Clerk, Stripe — see SETUP.md)
cp .env.example .env

# 3. Run dev server
npm run dev
```

Node 20+ required. Full environment setup is in **[SETUP.md](./SETUP.md)**.

### Common commands

```bash
npm run dev          # Vite dev server
npm run build        # Production build
npm test             # Vitest unit + component tests
npm run test:e2e     # Playwright end-to-end
npm run lint         # ESLint
npm run patch-clerk  # Apply local Clerk patch (post-install)
```

## Architecture at a glance

```
   ┌──────────────────────────────────────────────────────────┐
   │                      React (Vite)                        │
   │   Pages · Components · Hooks · Radix UI · Tailwind       │
   └────────────────┬─────────────────────┬──────────────────┘
                    │                     │
        convex-react│                     │dexie-hooks
                    ▼                     ▼
   ┌────────────────────────┐   ┌──────────────────────┐
   │   Convex (cloud DB)    │   │ Dexie (IndexedDB)    │
   │   auth · billing ·     │◄─►│ offline cache ·      │
   │   reports · sync       │   │ local mutations      │
   └────────────────────────┘   └──────────────────────┘
                    │
                    ▼
   ┌──────────────────────────────────────────────────────────┐
   │  Clerk (auth) · Stripe (billing) · Sentry (observability)│
   └──────────────────────────────────────────────────────────┘
```

The app reads from **both** Convex and Dexie. Convex is the source of truth for
team-shared data; Dexie is the local cache that lets a tech keep working when
they lose signal. The sync service (in `src/lib/sync/`) reconciles both
directions and resolves conflicts. See **[ARCHITECTURE.md](./ARCHITECTURE.md)**
for the full data flow.

## Repository layout

```
chemcheck/
├── src/
│   ├── pages/          # Route-level views (Home, Customers, Reports, ...)
│   ├── components/     # Reusable UI + feature components
│   ├── api/            # Hooks that bridge React ↔ Convex/Dexie
│   ├── lib/            # Sync, validation, SMS/email, business logic
│   ├── hooks/          # Cross-cutting React hooks
│   └── utils/          # Pure helpers
├── convex/             # Backend functions, schema, HTTP actions
├── docs/               # Internal specs and launch checklists
├── e2e/                # Playwright end-to-end tests
└── public/             # Static assets
```

## Documentation

| Doc                                          | Purpose                              |
|----------------------------------------------|--------------------------------------|
| [SETUP.md](./SETUP.md)                       | First-time environment setup         |
| [ARCHITECTURE.md](./ARCHITECTURE.md)         | System design and data flow          |
| [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) | Convex functions and contracts     |
| [SECURITY_FIXES.md](./SECURITY_FIXES.md)     | Security posture and known issues    |
| [SCALABILITY_NOTES.md](./SCALABILITY_NOTES.md) | Where this scales, where it doesn't |
| [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md) | Production deploy runbook     |
| [STAGING_SETUP.md](./STAGING_SETUP.md)       | Staging environment                  |
| [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md) | Vercel + Convex deploy details |
| [STRIPE_SETUP.md](./STRIPE_SETUP.md)         | Billing configuration                |
| [EMAIL_SETUP.md](./EMAIL_SETUP.md)           | Transactional email setup             |
| [MOBILE_MIGRATION_PLAN.md](./MOBILE_MIGRATION_PLAN.md) | Capacitor migration plan       |
| [docs/](./docs/)                             | Specs, launch checklists             |

## Status

Active development. Public repository for code review, integration, and
developer evaluation. Not currently accepting external pull requests.

## License

Proprietary — all rights reserved unless otherwise stated.
