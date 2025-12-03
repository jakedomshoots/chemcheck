# Deployment Guide - Pool Chemical Log

## Prerequisites

✅ **Already Complete:**
- ✅ Convex backend migrated and tested
- ✅ Clerk authentication integrated
- ✅ All components converted from Base44 to Convex
- ✅ Comprehensive test suite (100% pass rate)

## Environment Variables Required

You'll need these variables set in your deployment platform:

```bash
VITE_CONVEX_URL=https://your-convex-deployment.convex.cloud
VITE_CLERK_PUBLISHABLE_KEY=pk_test_... # or pk_live_... for production
```

## Deployment Steps

### 1. Deploy Convex Backend

```bash
# Login to Convex (if not already)
npx convex login

# Deploy to production
npx convex deploy

# This will output your production VITE_CONVEX_URL
```

### 2. Deploy to Vercel (Recommended)

**Via Vercel CLI:**
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Add environment variables when prompted, or via dashboard
```

**Via Vercel Dashboard:**
1. Go to https://vercel.com/new
2. Import your Git repository
3. **Build Settings:**
   - Framework Preset: `Vite`
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. **Environment Variables:**
   - Add `VITE_CONVEX_URL` (from Convex deploy)
   - Add `VITE_CLERK_PUBLISHABLE_KEY`
5. Click "Deploy"

### 3. Deploy to Netlify (Alternative)

**Via Netlify Dashboard:**
1. Go to https://app.netlify.com/start
2. Connect your Git repository
3. **Build Settings:**
   - Build command: `npm run build`
   - Publish directory: `dist`
4. **Environment Variables:**
   - Add `VITE_CONVEX_URL`
   - Add `VITE_CLERK_PUBLISHABLE_KEY`
5. Click "Deploy site"

**Via Netlify CLI:**
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login
netlify login

# Deploy
netlify deploy --prod
```

## Post-Deployment Checklist

- [ ] Verify Convex functions are accessible
- [ ] Test Clerk authentication flow
- [ ] Verify all CRUD operations work
- [ ] Check that service logs, customers, and notes load correctly
- [ ] Test the weekly report calculations
- [ ] Verify mobile responsiveness

## Updating Clerk Settings

After deployment, update your Clerk dashboard:

1. Go to https://dashboard.clerk.com
2. Select your application
3. Navigate to **Paths** → **Application URLs**
4. Add your production URL (e.g., `https://your-app.vercel.app`)
5. Update **Allowed redirect URLs** and **Allowed origins**

## Environment-Specific Notes

### Production vs Development

- **Development**: Uses `VITE_CONVEX_URL` from `.env.local`
- **Production**: Uses environment variables from Vercel/Netlify

### Clerk Keys

- **Development**: `pk_test_...` keys
- **Production**: Switch to `pk_live_...` keys for production

## Troubleshooting

### Build Fails
- Ensure all dependencies are in `package.json` (not just `devDependencies`)
- Check Node.js version compatibility

### Authentication Issues
- Verify Clerk domain is properly configured
- Check that `CLERK_JWT_ISSUER_DOMAIN` matches in `convex/auth.config.js`

### Convex Connection Errors
- Ensure `VITE_CONVEX_URL` is correctly set
- Verify Convex deployment is active (`npx convex deploy`)

## Quick Deploy Commands

```bash
# 1. Deploy Convex backend
npx convex deploy

# 2. Build frontend (test locally)
npm run build
npm run preview

# 3. Deploy to Vercel
vercel --prod

# Or deploy to Netlify
netlify deploy --prod
```

## Resources

- [Convex Deployment Docs](https://docs.convex.dev/production/hosting)
- [Vercel Deployment Guide](https://vercel.com/docs)
- [Netlify Deployment Guide](https://docs.netlify.com/)
- [Clerk Production Checklist](https://clerk.com/docs/deployments/overview)
