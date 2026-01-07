# Stripe Integration Setup Guide

This guide walks you through setting up Stripe for ChemCheck billing.

## Prerequisites

- A Stripe account (https://dashboard.stripe.com)
- Your Convex deployment URL

## Step 1: Get Your API Keys

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/apikeys)
2. Copy your **Publishable key** (starts with `pk_test_` or `pk_live_`)
3. Add it to your `.env.local`:
   ```
   VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_key_here
   ```

## Step 2: Create Products and Prices

1. Go to [Stripe Products](https://dashboard.stripe.com/products)
2. Create three products:

### Starter Plan ($29/month)
- Name: "ChemCheck Starter"
- Price: $29.00 USD, recurring monthly
- Copy the Price ID (starts with `price_`)

### Professional Plan ($79/month)
- Name: "ChemCheck Professional"
- Price: $79.00 USD, recurring monthly
- Copy the Price ID

### Business Plan ($149/month)
- Name: "ChemCheck Business"
- Price: $149.00 USD, recurring monthly
- Copy the Price ID

3. Add the Price IDs to your `.env.local`:
   ```
   VITE_STRIPE_STARTER_PRICE_ID=price_xxxxx
   VITE_STRIPE_PRO_PRICE_ID=price_xxxxx
   VITE_STRIPE_BUSINESS_PRICE_ID=price_xxxxx
   ```

## Step 3: Configure Webhooks

1. Go to [Stripe Webhooks](https://dashboard.stripe.com/webhooks)
2. Click "Add endpoint"
3. Enter your webhook URL:
   ```
   https://your-deployment.convex.site/stripe-webhook
   ```
   (Replace `your-deployment` with your actual Convex deployment name)

4. Select events to listen to:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`

5. Copy the **Signing secret** (starts with `whsec_`)
6. Add it to your Convex environment variables:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_xxxxx
   ```

## Step 4: Enable Customer Portal

1. Go to [Customer Portal Settings](https://dashboard.stripe.com/settings/billing/portal)
2. Enable the customer portal
3. Configure allowed actions:
   - ✅ Update payment methods
   - ✅ View invoice history
   - ✅ Cancel subscriptions

## Step 5: Configure Trial Period (Optional)

1. Go to [Subscription Settings](https://dashboard.stripe.com/settings/billing/subscriptions)
2. Set default trial period to 14 days
3. Or configure per-product trial periods

## Testing

### Test Mode
- Use test API keys (starting with `pk_test_` and `sk_test_`)
- Use [Stripe test cards](https://stripe.com/docs/testing):
  - Success: `4242 4242 4242 4242`
  - Decline: `4000 0000 0000 0002`
  - Requires auth: `4000 0025 0000 3155`

### Test Webhooks Locally
Use the Stripe CLI to forward webhooks to your local development:

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login to Stripe
stripe login

# Forward webhooks to your local Convex
stripe listen --forward-to localhost:3000/stripe-webhook
```

## Going Live

1. Complete Stripe account activation
2. Switch to live API keys
3. Update webhook endpoint to production URL
4. Test with a real card (small amount, then refund)

## Environment Variables Summary

```env
# Frontend (Vite)
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx
VITE_STRIPE_STARTER_PRICE_ID=price_xxxxx
VITE_STRIPE_PRO_PRICE_ID=price_xxxxx
VITE_STRIPE_BUSINESS_PRICE_ID=price_xxxxx

# Backend (Convex)
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
```

## Troubleshooting

### Webhook signature verification failed
- Ensure you're using the correct webhook secret
- Check that the raw request body is being passed (not parsed JSON)

### Subscription not updating
- Verify webhook events are being received in Stripe Dashboard
- Check Convex function logs for errors

### Customer portal not working
- Ensure portal is enabled in Stripe settings
- Verify customer has an active subscription

## Support

- [Stripe Documentation](https://stripe.com/docs)
- [Stripe Support](https://support.stripe.com)
- [Convex HTTP Actions](https://docs.convex.dev/functions/http-actions)
