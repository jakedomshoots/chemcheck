# ChemCheck Production Deployment Guide

This guide walks you through deploying ChemCheck to production using Vercel and Convex.

## Prerequisites

- GitHub account with the repository
- Vercel account (https://vercel.com)
- Convex account (https://convex.dev)
- Clerk account (https://clerk.com)
- Square Developer account (https://developer.squareup.com) - for billing and customer payments

## Step 1: Set Up Convex Production

### 1.1 Create Production Deployment

```bash
# Login to Convex
npx convex login

# Create production deployment
npx convex deploy --prod
```

### 1.2 Note Your Production URL

After deployment, you'll get a URL like:
```
https://your-project-name.convex.cloud
```

Save this - you'll need it for Vercel environment variables.

### 1.3 Configure Convex Auth

In your Convex dashboard:
1. Go to Settings > Authentication
2. Add your Clerk domain to allowed origins
3. Configure the JWT issuer URL from Clerk

## Step 2: Set Up Clerk Production

### 2.1 Create Production Instance

1. Go to [Clerk Dashboard](https://dashboard.clerk.com)
2. Create a new application or switch to production mode
3. Configure authentication methods:
   - Email/Password
   - Google OAuth (recommended)
   - GitHub OAuth (optional)

### 2.2 Get Production Keys

From Clerk Dashboard > API Keys:
- Copy the **Publishable Key** (starts with `pk_live_`)
- Copy the **Secret Key** (starts with `sk_live_`) - for backend use

### 2.3 Configure Allowed Origins

In Clerk Dashboard > Settings > Paths:
- Add your production domain: `https://your-app.vercel.app`
- Add custom domain if applicable

## Step 3: Deploy to Vercel

### 3.1 Connect Repository

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "Add New Project"
3. Import your GitHub repository
4. Select the repository containing ChemCheck

### 3.2 Configure Build Settings

Vercel should auto-detect Vite. Verify:
- Framework Preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

### 3.3 Add Environment Variables

Add these environment variables in Vercel:

| Variable | Value | Description |
|----------|-------|-------------|
| `VITE_CONVEX_URL` | `https://your-project.convex.cloud` | Convex deployment URL |
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_live_xxx` | Clerk publishable key |

Configure Square only in Convex, using the variables in `SQUARE_SETUP.md`. Do not add Square tokens, plan variation IDs, or billing endpoint URLs to Vercel/Vite environment variables.

### 3.4 Deploy

Click "Deploy" and wait for the build to complete.

## Step 4: Configure Webhooks

### 4.1 Square webhook and OAuth (billing and customer payments)

1. In the [Square Developer Console](https://developer.squareup.com/apps), open your application.
2. Webhooks → add a subscription for `https://your-project.convex.site/square/webhook` with
   `payment.created`, `payment.updated`, `subscription.created`, `subscription.updated`,
   `invoice.payment_made`, `invoice.scheduled_charge_failed`, `oauth.authorization.revoked`.
3. OAuth → redirect URL `https://your-project.convex.site/square/oauth/callback`.
4. See `SQUARE_SETUP.md` for plans, env vars and sandbox testing.

### 4.2 Clerk Webhooks (optional)

For user sync events:
1. Go to Clerk Dashboard > Webhooks
2. Add endpoint for user events if needed

## Step 5: Custom Domain (Optional)

### 5.1 Add Domain in Vercel

1. Go to Project Settings > Domains
2. Add your custom domain
3. Follow DNS configuration instructions

### 5.2 Update Clerk Settings

Add your custom domain to Clerk's allowed origins.

### 5.3 Update Convex CORS

In Convex dashboard, add your custom domain to allowed origins.

## Step 6: Post-Deployment Checklist

- [ ] Verify login/signup works
- [ ] Test creating a new business (setup wizard)
- [ ] Add a test customer
- [ ] Create a service log
- [ ] Test offline mode (disconnect network)
- [ ] Verify data syncs when back online
- [ ] Test billing flow (if configured)
- [ ] Check mobile responsiveness
- [ ] Verify PWA installation works

## Environment Variables Reference

### Required

```env
VITE_CONVEX_URL=https://your-project.convex.cloud
VITE_CLERK_PUBLISHABLE_KEY=pk_live_xxxxx
```

### Billing (Convex environment only)

```env
SQUARE_ENVIRONMENT=production
SQUARE_APPLICATION_ID=sq0idp-xxxxx
SQUARE_APPLICATION_SECRET=sq0csp-xxxxx
SQUARE_ACCESS_TOKEN=EAAAxxxxx
SQUARE_LOCATION_ID=Lxxxxx
SQUARE_PLATFORM_MERCHANT_ID=MLxxxxx
SQUARE_WEBHOOK_SIGNATURE_KEY=xxxxx
SQUARE_WEBHOOK_URL=https://your-project.convex.site/square/webhook
SQUARE_TOKEN_ENCRYPTION_KEY=<openssl rand -base64 32>
APP_URL=https://app.chemcheck.app
SQUARE_PLAN_VARIATION_STARTER_MONTHLY=xxxxx
SQUARE_PLAN_VARIATION_STARTER_ANNUAL=xxxxx
SQUARE_PLAN_VARIATION_PROFESSIONAL_MONTHLY=xxxxx
SQUARE_PLAN_VARIATION_PROFESSIONAL_ANNUAL=xxxxx
SQUARE_PLAN_VARIATION_BUSINESS_MONTHLY=xxxxx
SQUARE_PLAN_VARIATION_BUSINESS_ANNUAL=xxxxx
```

### Optional (Monitoring)

```env
VITE_SENTRY_DSN=https://xxxxx@sentry.io/xxxxx
```

## Troubleshooting

### Build Fails

1. Check Node.js version (requires 18+)
2. Verify all dependencies are in package.json
3. Check for TypeScript errors: `npm run build`

### Auth Not Working

1. Verify Clerk publishable key is correct
2. Check Clerk allowed origins include your domain
3. Verify Convex auth configuration

### Data Not Syncing

1. Check Convex deployment URL is correct
2. Verify Convex auth is configured
3. Check browser console for errors

### PWA Not Installing

1. Verify manifest.json is accessible
2. Check service worker registration
3. Ensure HTTPS is enabled

## Monitoring & Maintenance

### Recommended Tools

- **Error Tracking**: Sentry
- **Uptime Monitoring**: UptimeRobot, Pingdom
- **Analytics**: Google Analytics, Mixpanel
- **Log Management**: Convex Dashboard logs

### Regular Maintenance

- Review Convex usage and costs monthly
- Update dependencies quarterly
- Review and rotate API keys annually
- Monitor error rates and performance

## Support

- [Convex Documentation](https://docs.convex.dev)
- [Clerk Documentation](https://clerk.com/docs)
- [Vercel Documentation](https://vercel.com/docs)
- [Square Developer Documentation](https://developer.squareup.com/docs)
