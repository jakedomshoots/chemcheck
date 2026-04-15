# 📊 ChemCheck Monitoring Setup Guide

## Health Check Endpoint

The application provides a health check endpoint at:
```
https://your-domain.com/health.json
```

This endpoint returns:
```json
{
  "status": "healthy",
  "timestamp": "2024-12-13T20:30:00Z",
  "version": "1.0.0",
  "services": {
    "frontend": "operational",
    "convex": "operational"
  }
}
```

## Recommended Monitoring Services

### 1. UptimeRobot (Free Tier Available)
- **URL**: https://uptimerobot.com
- **Setup**: Monitor `/health.json` endpoint every 5 minutes
- **Alerts**: Email/SMS when status != "healthy"
- **Cost**: Free for up to 50 monitors

### 2. Pingdom
- **URL**: https://pingdom.com
- **Setup**: HTTP check on main domain + health endpoint
- **Features**: Global monitoring locations, detailed reports
- **Cost**: Paid service, starts ~$10/month

### 3. StatusCake (Free Tier)
- **URL**: https://statuscake.com
- **Setup**: Website monitoring + API endpoint checks
- **Features**: SSL monitoring, page speed tests
- **Cost**: Free tier available

## Sentry Performance Monitoring

Already configured! Add your Sentry DSN to environment variables:

```bash
# In Vercel dashboard or .env.local
VITE_SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
```

Sentry will automatically track:
- Error rates and exceptions
- Performance metrics and slow transactions
- User sessions and replay
- Release health

## Convex Monitoring

Convex provides built-in monitoring at:
- **Dashboard**: https://dashboard.convex.dev
- **Metrics**: Function execution times, error rates
- **Logs**: Real-time function logs and debugging

## Recommended Alerts

Set up alerts for:
1. **Website Down** - Main domain unreachable
2. **Health Check Failed** - `/health.json` returns error
3. **High Error Rate** - >5% error rate in Sentry
4. **Slow Response** - >3 second response times
5. **SSL Certificate Expiry** - 30 days before expiration

## Quick Setup Checklist

- [ ] Add health check monitoring to UptimeRobot/Pingdom
- [ ] Configure Sentry DSN in production environment
- [ ] Set up email/SMS alerts for downtime
- [ ] Monitor SSL certificate expiration
- [ ] Set up Convex function monitoring alerts
- [ ] Test alert notifications

## Emergency Contacts

Update these with your team's contact information:
- **Primary**: your-email@domain.com
- **Secondary**: backup-email@domain.com
- **Phone**: +1-XXX-XXX-XXXX (for critical alerts)