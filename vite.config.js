import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { sentryVitePlugin } from '@sentry/vite-plugin'

const isProd = process.env.NODE_ENV === 'production';
const enableSentryUpload = isProd && !!process.env.SENTRY_AUTH_TOKEN;
const isPlaywrightE2E = process.env.PLAYWRIGHT_E2E === 'true';

const manualChunkGroups = {
  // Vendor chunks - split large dependencies
  'vendor-react': ['react', 'react-dom'],
  'vendor-clerk': ['@clerk/clerk-react', '@clerk/shared'],
  // Split heavy Radix primitives by package so routes only download what they use.
  'vendor-radix-dialog': ['@radix-ui/react-dialog'],
  'vendor-radix-select': ['@radix-ui/react-select'],
  // Secondary Radix components (less frequently used)
  'vendor-radix-ui': [
    '@radix-ui/react-tabs',
    '@radix-ui/react-popover',
  ],
  // Other Radix components (lazy loaded on demand)
  'vendor-radix-extra': [
    '@radix-ui/react-alert-dialog',
    '@radix-ui/react-checkbox',
    '@radix-ui/react-switch',
  ],
  'vendor-validation': ['zod'],
  'vendor-dates': ['date-fns'],
  'vendor-router': ['react-router', 'react-router-dom'],
  'vendor-stripe': ['@stripe/stripe-js'],
  'vendor-convex': ['convex'],
  'vendor-dexie-core': ['dexie'],
  'vendor-dexie-hooks': ['dexie-react-hooks'],
  'vendor-icons': ['lucide-react'],
  'vendor-sentry': ['@sentry/react'],
};

function isPackageModule(id, packageName) {
  const normalizedId = id.split(path.sep).join('/');
  return (
    normalizedId.includes(`/node_modules/${packageName}/`) ||
    normalizedId.endsWith(`/node_modules/${packageName}`)
  );
}

function manualChunks(id) {
  if (!id.includes('node_modules')) return undefined;

  for (const [chunkName, packageNames] of Object.entries(manualChunkGroups)) {
    if (packageNames.some((packageName) => isPackageModule(id, packageName))) {
      return chunkName;
    }
  }

  return undefined;
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Only add Sentry plugin in production builds with auth token
    enableSentryUpload && sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: {
        assets: './dist/**',
      },
    })
  ].filter(Boolean),
  server: {
    allowedHosts: true,
    hmr: isPlaywrightE2E ? false : undefined,
    watch: {
      ignored: ['**/playwright-report/**', '**/test-results/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json']
  },
  optimizeDeps: {
    rolldownOptions: {
      moduleTypes: {
        '.js': 'jsx',
      },
    },
  },
  build: {
    // iOS launch builds should prioritize startup performance.
    minify: isProd ? 'esbuild' : false,
    // Upload hidden sourcemaps only when Sentry upload is configured.
    sourcemap: enableSentryUpload ? 'hidden' : false,
    rolldownOptions: {
      output: {
        manualChunks,
        // Ensure consistent chunk naming
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.worktrees/**',
      '**/e2e/**'
    ],
  },
})
