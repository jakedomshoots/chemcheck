# Visual Regression Testing Guide

This guide explains how to set up and use visual regression testing with Chromatic for ChemCheck.

## Overview

Visual regression testing catches unintended UI changes by comparing screenshots of your components before and after code changes.

## Setup

### 1. Install Dependencies

```bash
npm install --save-dev @storybook/react-vite @storybook/addon-essentials @storybook/addon-a11y @chromatic-com/storybook chromatic
```

### 2. Create Stories

Create story files for your components in `src/components/*.stories.jsx`:

```jsx
// src/components/ui/Button.stories.jsx
import { Button } from './button';

export default {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
};

export const Primary = {
  args: {
    children: 'Primary Button',
    variant: 'default',
  },
};

export const Secondary = {
  args: {
    children: 'Secondary Button',
    variant: 'secondary',
  },
};

export const Destructive = {
  args: {
    children: 'Delete',
    variant: 'destructive',
  },
};
```

### 3. Run Storybook Locally

```bash
npm run storybook
```

This starts Storybook at http://localhost:6006

### 4. Set Up Chromatic

1. Sign up at [chromatic.com](https://www.chromatic.com/)
2. Create a new project and get your project token
3. Add the token to your CI environment as `CHROMATIC_PROJECT_TOKEN`

### 5. Run Visual Tests

```bash
# First time - creates baseline snapshots
npx chromatic --project-token=<your-token>

# Subsequent runs - compares against baseline
npx chromatic --project-token=<your-token>
```

## CI Integration

### GitHub Actions

Add to `.github/workflows/chromatic.yml`:

```yaml
name: Chromatic

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  chromatic:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - run: npm ci
      
      - name: Run Chromatic
        uses: chromaui/action@latest
        with:
          projectToken: ${{ secrets.CHROMATIC_PROJECT_TOKEN }}
```

## Best Practices

### What to Test

- **UI Components**: Buttons, cards, inputs, modals
- **Page Layouts**: Key pages in different states
- **Responsive Views**: Mobile, tablet, desktop breakpoints
- **Theme Variations**: Light/dark mode if applicable
- **Loading States**: Skeleton screens, spinners
- **Error States**: Error messages, empty states

### Story Organization

```
src/
├── components/
│   ├── ui/
│   │   ├── button.jsx
│   │   └── button.stories.jsx
│   ├── billing/
│   │   ├── PricingPage.jsx
│   │   └── PricingPage.stories.jsx
│   └── ...
```

### Handling Dynamic Content

For components with dynamic data, use mock data:

```jsx
export const WithCustomers = {
  args: {
    customers: [
      { id: 1, name: 'John Doe', address: '123 Main St' },
      { id: 2, name: 'Jane Smith', address: '456 Oak Ave' },
    ],
  },
};

export const Empty = {
  args: {
    customers: [],
  },
};
```

## Reviewing Changes

1. Chromatic creates a build for each push
2. Review visual changes in the Chromatic UI
3. Accept intentional changes to update baselines
4. Reject unintentional changes and fix the code

## Troubleshooting

### Flaky Tests

- Use `chromatic: { delay: 300 }` for animations
- Mock dates and random values
- Use consistent test data

### Large Diffs

- Review component by component
- Use `--only-changed` flag for faster builds

## Resources

- [Storybook Docs](https://storybook.js.org/docs)
- [Chromatic Docs](https://www.chromatic.com/docs/)
- [Visual Testing Handbook](https://storybook.js.org/tutorials/visual-testing-handbook/)
