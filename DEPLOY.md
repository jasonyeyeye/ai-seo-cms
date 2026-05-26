# AI Shopping Deployment Guide

## Overview

The AI Shopping refactor splits the application into:
- **Worker API** (`src/worker/index.ts`) - Cloudflare Workers for API endpoints
- **Pages Frontend** (`static/`) - Cloudflare Pages for static hosting

## Prerequisites

- Cloudflare account with admin access
- Wrangler CLI installed: `npm install -g wrangler`
- GitHub repository for CI/CD (optional)

## Cloudflare Resources

| Resource | Name | ID |
|----------|------|-----|
| D1 Database | ai-shopping | f078849f-4d0e-4c2d-866c-5d9ee5d037b7 |
| KV (Search Cache) | SEARCH_CACHE | 9f58ddc751a8486c9c0bfe438f196379 |
| KV (Product Cache) | PRODUCT_CACHE | a18c0f0e41674ae48dc2d31db8a61ec2 |
| R2 Bucket | aiseo | - |

## Environment Variables

Set these in Cloudflare Dashboard > Workers & Pages > ai-shopping-api > Settings > Variables:

| Variable | Value | Notes |
|----------|-------|-------|
| `SITE_URL` | https://aibuylab.com | Production URL |
| `ENABLE_TURNSTILE` | true | Enable Cloudflare challenge |
| `TURNSTILE_SITE_KEY` | 0x4AAAAAADWddcRXYsQ9gMJw | Turnstile site key |
| `TURNSTILE_SECRET_KEY` | (from Cloudflare) | Turnstile secret key |
| `IP_HASH_SALT` | ai-shopping-secret-key-2026 | Session salt |

## Worker API Deployment

### Manual Deployment

```bash
# Install dependencies
npm ci

# Login to Cloudflare (if not already)
npx wrangler login

# Deploy Worker
npx wrangler deploy
```

### GitHub Actions (Recommended)

1. Add secrets to GitHub repository:
   - `CLOUDFLARE_API_TOKEN` - Cloudflare API token with Workers deployment permission
   - `CLOUDFLARE_ACCOUNT_ID` - Account ID (3e8c5385498b295ad3873e07c1b049e5)

2. Push to `main` branch - deployment happens automatically

## Pages Frontend Deployment

### Manual Deployment

```bash
# Build frontend
npm run build

# Deploy to Cloudflare Pages
npx wrangler pages deploy dist --project-name=aiseo
```

### GitHub Actions

The workflow (`.github/workflows/pages-deploy.yml`) auto-deploys on push to `main`.

## D1 Database Migrations

### Apply Migrations

```bash
# Apply all migrations
npx wrangler d1 migrations apply ai-shopping --local
npx wrangler d1 migrations apply ai-shopping --remote

# Check migration status
npx wrangler d1 migrations list ai-shopping --remote
```

### Create New Migration

```bash
npx wrangler d1 migrations create ai-shopping <migration-name>
# Edit the generated SQL file
# Apply with the commands above
```

## KV Cache Warming

### Manual Cache Warm

```bash
# Warm search cache
wrangler kv:key put "search:warm:timestamp" "$(date -Iseconds)" \
  --namespace-id=9f58ddc751a8486c9c0bfe438f196379

# Warm product cache
wrangler kv:key put "product:warm:timestamp" "$(date -Iseconds)" \
  --namespace-id=a18c0f0e41674ae48dc2d31db8a61ec2
```

### Cache Invalidation

```bash
# List all keys in namespace
wrangler kv:key list --namespace-id=SEARCH_CACHE

# Delete specific key
wrangler kv:key delete "product:12345" --namespace-id=PRODUCT_CACHE

# Bulk delete
wrangler kv:bulk delete --namespace-id=PRODUCT_CACHE -f <(echo '["key1","key2"]')
```

## R2 Media Bucket

Media files are served from the `aiseo` R2 bucket via the Worker.

### Upload Media

```bash
# Upload a file
wrangler r2 object put media/brands/logo.png --bucket=aiseo --file=./logo.png

# List bucket contents
wrangler r2 object list --bucket=aiseo
```

### URL Structure

Media URLs follow this pattern:
```
https://aibuylab.com/media/
```

## Rollback Procedure

### Worker Rollback

```bash
# List deployments
npx wrangler deployments list

# Rollback to previous version
npx wrangler rollback <deployment-id>
```

### Pages Rollback

Via Cloudflare Dashboard:
1. Workers & Pages > aiseo > Deployments
2. Select previous deployment > "Retry deployment"

## Monitoring

- **Worker Logs**: Dashboard > Workers & Pages > ai-shopping-api > Logs
- **D1 Queries**: Dashboard > Workers & Pages > ai-shopping-api > Resources > DB
- **R2 Analytics**: Dashboard > R2 > aiseo > Analytics

## Troubleshooting

### Worker Deployment Fails

```bash
# Check for TypeScript errors
npx tsc --noEmit

# Validate wrangler config
npx wrangler whoami

# Redeploy with verbose output
npx wrangler deploy --verbose
```

### Pages Build Fails

```bash
# Check build output
npm run build

# Test locally
npx wrangler pages dev dist
```

### D1 Query Errors

```bash
# Execute SQL directly
npx wrangler d1 execute ai-shopping --remote --command="SELECT * FROM table LIMIT 10"

# Check schema
npx wrangler d1 execute ai-shopping --remote --command=".schema"
```

## Development Workflow

1. Make changes to `src/worker/index.ts` (API) or `static/` (frontend)
2. Test locally: `npx wrangler dev`
3. Commit and push
4. GitHub Actions deploys automatically

## Local Development

```bash
# Start Worker locally
npx wrangler dev src/worker/index.ts

# Start Pages locally
npx wrangler pages dev dist