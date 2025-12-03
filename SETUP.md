# Quick Setup Guide

## Step 1: Get Your Clerk Keys

1. Go to https://dashboard.clerk.com
2. **If you don't have an application yet:**
   - Click "Create Application"
   - Name it "Pool Chemical Log" (or whatever you prefer)
   - Choose your authentication methods (Email, Google, etc.)
   - Click "Create Application"

3. **Get your Publishable Key:**
   - In Clerk Dashboard → "API Keys"
   - Copy the **"Publishable Key"** (starts with `pk_test_...` or `pk_live_...`)

4. **Get your JWT Issuer Domain:**
   - In Clerk Dashboard → "Configure" → "JWT Templates"
   - Click "Convex" (or create it if it doesn't exist)
   - Copy the **"Issuer"** URL (looks like `https://your-app-name.clerk.accounts.dev`)

## Step 2: Configure Environment Variables

Edit your `.env.local` file:

```bash
# You'll get this URL after running 'npx convex dev' in Step 3
VITE_CONVEX_URL=

# Paste your Clerk Publishable Key here
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

## Step 3: Start Convex Backend

In your terminal, run:

```bash
npx convex dev
```

**What this does:**
- Deploys your Convex schema and functions
- Gives you a CONVEX_URL (copy this!)
- Keeps running to sync changes

**Copy the URL** that looks like:
```
https://your-project-name.convex.cloud
```

**Add it to `.env.local`:**
```bash
VITE_CONVEX_URL=https://your-project-name.convex.cloud
```

## Step 4: Configure Clerk in Convex Dashboard

1. Go to https://dashboard.convex.dev
2. Select your project
3. Go to "Settings" → "Environment Variables"
4. Add:
   ```
   CLERK_JWT_ISSUER_DOMAIN=https://your-app-name.clerk.accounts.dev
   ```

## Step 5: Start the React App

In a **NEW terminal** (keep Convex running), run:

```bash
npm run dev
```

Your app should now be running at `http://localhost:5173`

## Troubleshooting

### "Application isn't showing up"
- Make sure both `npx convex dev` AND `npm run dev` are running
- Check that `.env.local` has both VITE_CONVEX_URL and VITE_CLERK_PUBLISHABLE_KEY
- Open your browser to http://localhost:5173

### "Clerk errors"
- Verify your VITE_CLERK_PUBLISHABLE_KEY is correct
- Make sure you've set CLERK_JWT_ISSUER_DOMAIN in Convex dashboard

### "Convex errors"
- Make sure `npx convex dev` is running
- Verify VITE_CONVEX_URL in `.env.local` matches the URL from `npx convex dev`

## Quick Commands

```bash
# Terminal 1: Start Convex backend
npx convex dev

# Terminal 2: Start React frontend
npm run dev
```

Both need to be running at the same time!
