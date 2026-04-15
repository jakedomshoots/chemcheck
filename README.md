# ChemCheck

Pool and spa service management application for professional pool technicians.

## Tech Stack

- **Frontend**: React 18 + Vite + TypeScript
- **Backend**: Convex (real-time database + functions)
- **Auth**: Clerk
- **Payments**: Stripe
- **Offline Storage**: Dexie (IndexedDB)
- **Mobile**: Capacitor (iOS)
- **Deployment**: Vercel

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Installation

```bash
npm install
```

### Environment Setup

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

**Required environment variables:**

| Variable | Description |
|---|---|
| `VITE_CONVEX_URL` | Convex backend URL |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |

See `.env.example` for the full list.

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Testing

```bash
npm run test          # Unit tests (vitest)
npm run test:e2e      # E2E tests (Playwright)
```

### Lint

```bash
npm run lint
```

## Project Structure

```
src/
  components/     # React components
    auth/          # Authentication (Clerk + Convex)
    billing/       # Stripe billing & pricing
    proof-of-service/  # Photo capture & proof
    service-reports/    # Report generation & email
    sync/          # Data sync (Convex ↔ Dexie)
    ui/            # Radix UI primitives
  convex/          # Convex backend functions
  hooks/           # Custom React hooks
  lib/             # Business logic & utilities
    ai-summarizer/ # Pool analysis engine
    proof-of-service/  # Proof-of-service logic
    sync/          # Sync engine
  pages/           # Route components
  utils/           # Utility functions
```

## Deployment

This project deploys to Vercel. The `vercel.json` configuration handles SPA routing, security headers, and caching.

1. Push to GitHub
2. Connect repo in Vercel dashboard
3. Set environment variables in Vercel project settings
4. Deploy

## License

Private — All rights reserved.