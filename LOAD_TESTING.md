# 🔥 ChemCheck Load Testing Guide

## Overview

Load testing ensures your application can handle expected traffic and identifies performance bottlenecks before they affect users.

## Recommended Tools

### 1. k6 (Recommended)
Modern load testing tool with JavaScript scripting.

```bash
# Install k6
brew install k6  # macOS
# or download from https://k6.io/docs/getting-started/installation/
```

### 2. Artillery
Node.js-based load testing.

```bash
npm install -g artillery
```

### 3. Apache JMeter
Java-based, GUI tool for complex scenarios.

## k6 Load Test Scripts

### Basic Load Test
Create `load-tests/basic.js`:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },  // Ramp up to 20 users
    { duration: '1m', target: 20 },   // Stay at 20 users
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'],   // Less than 1% failure rate
  },
};

export default function () {
  // Test homepage
  const homeRes = http.get('https://your-app.vercel.app/');
  check(homeRes, {
    'homepage status is 200': (r) => r.status === 200,
    'homepage loads under 2s': (r) => r.timings.duration < 2000,
  });

  sleep(1);

  // Test health endpoint
  const healthRes = http.get('https://your-app.vercel.app/health.json');
  check(healthRes, {
    'health check status is 200': (r) => r.status === 200,
  });

  sleep(1);
}
```

### API Load Test
Create `load-tests/api.js`:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 50,           // 50 virtual users
  duration: '2m',    // Run for 2 minutes
  thresholds: {
    http_req_duration: ['p(99)<1000'], // 99% under 1 second
  },
};

const BASE_URL = 'https://tangible-bloodhound-615.convex.cloud';

export default function () {
  // Test Convex API endpoints
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  // Simulate reading customers
  const customersRes = http.post(
    `${BASE_URL}/api/query`,
    JSON.stringify({
      path: 'customers:list',
      args: {},
    }),
    params
  );

  check(customersRes, {
    'customers API responds': (r) => r.status === 200,
  });

  sleep(Math.random() * 2 + 1); // Random sleep 1-3 seconds
}
```

### Stress Test
Create `load-tests/stress.js`:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 },  // Ramp to 100 users
    { duration: '5m', target: 100 },  // Stay at 100
    { duration: '2m', target: 200 },  // Ramp to 200
    { duration: '5m', target: 200 },  // Stay at 200
    { duration: '2m', target: 300 },  // Ramp to 300
    { duration: '5m', target: 300 },  // Stay at 300
    { duration: '10m', target: 0 },   // Ramp down
  ],
};

export default function () {
  const res = http.get('https://your-app.vercel.app/');
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
  sleep(1);
}
```

## Running Load Tests

```bash
# Basic test
k6 run load-tests/basic.js

# With cloud reporting
k6 cloud run load-tests/basic.js

# Output to JSON
k6 run --out json=results.json load-tests/basic.js
```

## Artillery Configuration

Create `load-tests/artillery.yml`:

```yaml
config:
  target: 'https://your-app.vercel.app'
  phases:
    - duration: 60
      arrivalRate: 5
      name: Warm up
    - duration: 120
      arrivalRate: 20
      name: Sustained load
    - duration: 60
      arrivalRate: 50
      name: Peak load

scenarios:
  - name: "Browse app"
    flow:
      - get:
          url: "/"
      - think: 2
      - get:
          url: "/health.json"
      - think: 1
```

Run with:
```bash
artillery run load-tests/artillery.yml
```

## Performance Targets

| Metric | Target | Critical |
|--------|--------|----------|
| Page Load Time | < 2s | < 5s |
| API Response Time | < 200ms | < 1s |
| Time to First Byte | < 500ms | < 1s |
| Error Rate | < 0.1% | < 1% |
| Concurrent Users | 100+ | 50+ |

## Monitoring During Tests

1. **Vercel Analytics**: Monitor real-time performance
2. **Convex Dashboard**: Watch function execution times
3. **Sentry**: Track errors during load
4. **Browser DevTools**: Network waterfall analysis

## Common Bottlenecks

### Frontend
- Large JavaScript bundles
- Unoptimized images
- Too many API calls on page load
- Missing code splitting

### Backend (Convex)
- Inefficient queries
- Missing indexes
- Large data transfers
- N+1 query problems

### Network
- No CDN caching
- Large asset sizes
- Too many requests
- Missing compression

## Optimization Checklist

- [ ] Enable Vercel Edge caching
- [ ] Implement code splitting
- [ ] Optimize images (WebP, lazy loading)
- [ ] Add Convex query indexes
- [ ] Enable gzip/brotli compression
- [ ] Implement pagination for large lists
- [ ] Cache frequently accessed data
- [ ] Use React.memo for expensive components

## Test Schedule

| Test Type | Frequency | Duration |
|-----------|-----------|----------|
| Smoke Test | Daily | 1 min |
| Load Test | Weekly | 10 min |
| Stress Test | Monthly | 30 min |
| Soak Test | Quarterly | 4 hours |

## Reporting

After each load test, document:
1. Test configuration (users, duration)
2. Key metrics (response times, error rates)
3. Bottlenecks identified
4. Recommendations for improvement
5. Comparison with previous tests