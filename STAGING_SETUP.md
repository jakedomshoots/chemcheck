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

# Stripe (use test mode)
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_staging_stripe_key
VITE_STRIPE_STARTER_PRICE_ID=price_staging_starter
VITE_STRIPE_PRO_PRICE_ID=price_staging_pro
VITE_STRIPE_BUSINESS_PRICE_ID=price_staging_business

# Sentry (optional: create staging project)
VITE_SENTRY_DSN=https://staging-sentry-dsn@sentry.io/staging-project
```

## Convex Staging Setup

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

## Stripe Staging Setup

1. **Use Test Mode**:
   - All Stripe keys should be test keys (`pk_test_...`)
   - Create test products and prices
   - Test payments won't charge real cards

2. **Test Data**:
   - Use test card numbers: `4242 4242 4242 4242`
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
- [ ] Configure Stripe test mode
- [ ] Test full user flow on staging
- [ ] Set up monitoring for staging environment
- [ ] Document staging URLs and access

## Staging URLs

Update these with your actual URLs:
- **Staging App**: https://chemcheck-git-staging-your-username.vercel.app
- **Convex Dashboard**: https://dashboard.convex.dev (staging project)
- **Clerk Dashboard**: https://dashboard.clerk.com (staging app)
- **Stripe Dashboard**: https://dashboard.stripe.com (test mode)

## Best Practices

1. **Data Management**:
   - Use realistic test data
   - Regularly refresh staging data
   - Don't use production user data

2. **Testing**:
   - Test all critical user flows
   - Verify integrations (Stripe, Clerk, Convex)
   - Check mobile responsiveness

3. **Security**:
   - Use test API keys only
   - Don't expose staging credentials
   - Monitor staging for security issues