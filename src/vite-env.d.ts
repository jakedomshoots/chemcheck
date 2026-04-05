/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STRIPE_PUBLISHABLE_KEY: string;
  readonly VITE_STRIPE_CHECKOUT_URL: string;
  readonly VITE_STRIPE_PORTAL_URL: string;
  readonly VITE_STRIPE_CANCEL_URL: string;
  readonly VITE_STRIPE_STARTER_PRICE_ID: string;
  readonly VITE_STRIPE_PRO_PRICE_ID: string;
  readonly VITE_STRIPE_BUSINESS_PRICE_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
