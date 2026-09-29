# 🚀 ChemCheck Staging Environment Setup

## Overview

A staging environment is a pre-production environment that mirrors production for testing changes before they go live.

## Vercel Staging Setup

### 1. Create Staging Branch
```bash
git checkout -b staging
git push origin staging
```

### 2. Configure Vercel Preview Deployments
Vercel automatically creates preview deployments for all branches. Your staging URL will be:
```
https://chemcheck-git-staging-your-username.vercel.app
```

### 3. Environment Variables for Staging

In Vercel dashboard, set these for **Preview** environment:

```bash
# Convex (use same production instance or create staging)
VITE_CONVEX_URL=https://tangible-bloodhound-615.convex.cloud

# Clerk (create staging application)
VITE_CLERK_PUBLISHABLE_KEY=pk_test_staging_key_here

# Sentry (optional: create staging project)
VITE_SENTRY_DSN=https://staging-sentry-dsn@sentry.io/staging-project
```

## Convex Staging Setup

Set Square (sandbox) configuration in the staging Convex deployment, never in Vercel (see `SQUARE_SETUP.md`):

```bash
SQUARE_ENVIRONMENT=sandbox
SQUARE_APPLICATION_ID=sandbox-sq0idb-staging
SQUARE_APPLICATION_SECRET=sandbox-sq0csb-staging
SQUARE_ACCESS_TOKEN=EAAAstaging_sandbox_token
SQUARE_LOCATION_ID=Lstaging
SQUARE_PLATFORM_MERCHANT_ID=MLstaging
SQUARE_WEBHOOK_SIGNATURE_KEY=staging_signature_key
SQUARE_WEBHOOK_URL=https://staging-deployment.convex.site/square/webhook
SQUARE_TOKEN_ENCRYPTION_KEY=<openssl rand -base64 32>
APP_URL=https://staging.chemcheck.app
SQUARE_PLAN_VARIATION_STARTER_MONTHLY=staging_variation_id
SQUARE_PLAN_VARIATION_STARTER_ANNUAL=staging_variation_id
SQUARE_PLAN_VARIATION_PROFESSIONAL_MONTHLY=staging_variation_id
SQUARE_PLAN_VARIATION_PROFESSIONAL_ANNUAL=staging_variation_id
SQUARE_PLAN_VARIATION_BUSINESS_MONTHLY=staging_variation_id
SQUARE_PLAN_VARIATION_BUSINESS_ANNUAL=staging_variation_id
```

### Option 1: Shared Database (Simpler)
Use the same Convex deployment for both staging and production:
- Data is shared between environments
- Simpler setup, no data sync needed
- Risk: staging tests could affect production data

### Option 2: Separate Database (Recommended)
Create a separate Convex deployment for staging:

```bash
# Create new Convex project for staging
npx convex dev --configure=staging

# Deploy to staging
npx convex deploy --prod --config=staging
```

## Clerk Staging Setup

1. **Create Staging Application**:
   - Go to Clerk Dashboard
   - Create new application: "ChemCheck Staging"
   - Copy the publishable key

2. **Configure OAuth Providers**:
   - Add same OAuth providers as production
   - Use staging redirect URLs

## Square Staging Setup

1. **Use the Sandbox**:
   - Use the Sandbox tab credentials of the Square application (`SQUARE_ENVIRONMENT=sandbox`)
   - Create sandbox subscription plan variations
   - Sandbox payments never charge real cards

2. **Test Data**:
   - Use Square's sandbox test card: `4111 1111 1111 1111`
   - Any future expiry date and CVC

## Automated Staging Deployment

### GitHub Actions (Optional)
Create `.github/workflows/staging.yml`:

```yaml
name: Deploy to Staging
on:
  push:
    branches: [staging]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      # Deploy Convex functions to staging
      - name: Deploy Convex
        run: |
          npm install
          npx convex deploy --prod --config=staging
        env:
          CONVEX_DEPLOY_KEY: ${{ secrets.CONVEX_STAGING_DEPLOY_KEY }}
      
      # Vercel handles frontend deployment automatically
```

## Testing Workflow

1. **Feature Development**:
   ```bash
   git checkout -b feature/new-feature
   # Develop feature
   git push origin feature/new-feature
   ```

2. **Staging Testing**:
   ```bash
   git checkout staging
   git merge feature/new-feature
   git push origin staging
   # Test on staging URL
   ```

3. **Production Deployment**:
   ```bash
   git checkout main
   git merge staging
   git push origin main
   # Deploys to production
   ```

## Staging Checklist

- [ ] Create staging branch
- [ ] Configure Vercel preview environment variables
- [ ] Set up Convex staging deployment (if using separate DB)
- [ ] Create Clerk staging application
- [ ] Configure Square sandbox
- [ ] Test full user flow on staging
- [ ] Set up monitoring for staging environment
- [ ] Document staging URLs and access

## Staging URLs

Update these with your actual URLs:
- **Staging App**: https://chemcheck-git-staging-your-username.vercel.app
- **Convex Dashboard**: https://dashboard.convex.dev (staging project)
- **Clerk Dashboard**: https://dashboard.clerk.com (staging app)
- **Square Developer Console**: https://developer.squareup.com/apps (Sandbox tab)

## Best Practices

1. **Data Management**:
   - Use realistic test data
   - Regularly refresh staging data
   - Don't use production user data

2. **Testing**:
   - Test all critical user flows
   - Verify integrations (Square, Clerk, Convex)
   - Check mobile responsiveness

3. **Security**:
   - Use test API keys only
   - Don't expose staging credentials
   - Monitor staging for security issues
