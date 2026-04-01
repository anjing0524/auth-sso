# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Auth-SSO is an enterprise unified identity authentication platform implementing SSO (Single Sign-On) with OIDC Provider capabilities. It's a pnpm monorepo containing:

- **apps/idp** - Identity Provider (port 4001) - Better Auth with OIDC Provider plugin
- **apps/portal** - Admin Portal (port 4000) - User/role/permission management
- **apps/demo-app** - Demo SSO Client (port 4002) - Tests SSO integration
- **packages/contracts** - Shared types, error codes, permission codes, OIDC constants
- **packages/config** - Shared TypeScript/ESLint configuration

## Development Commands

```bash
# Install dependencies
pnpm install

# Start all apps in development
pnpm dev

# Start specific app
pnpm --filter @auth-sso/idp dev      # IdP on port 4001
pnpm --filter @auth-sso/portal dev   # Portal on port 4000
pnpm --filter @auth-sso/demo-app dev # Demo on port 4002

# Build
pnpm build
pnpm --filter @auth-sso/idp build

# Lint and typecheck
pnpm lint
pnpm typecheck

# Database (IdP only)
pnpm --filter @auth-sso/idp db:generate  # Generate migrations
pnpm --filter @auth-sso/idp db:push      # Push schema to DB
pnpm --filter @auth-sso/idp db:studio    # Open Drizzle Studio
pnpm --filter @auth-sso/idp db:seed      # Seed test data
```

## Testing

Tests are in `tests/` directory using Node.js native test runner:

```bash
cd tests
./start-services.sh  # Start Docker services (Postgres, Redis)
./run-tests.sh       # Run all tests
```

Test configuration: `tests/config.js`

## Architecture

### Authentication Flow

1. **IdP (apps/idp)** is the central identity provider using Better Auth with:
   - OIDC Provider plugin for OAuth 2.1 Authorization Code Flow with PKCE
   - JWT plugin for ID Token signing (JWKS at `/api/auth/jwks`)
   - Redis secondary storage for sessions
   - PostgreSQL with Drizzle ORM

2. **Portal & Demo App** act as OAuth clients, redirecting to IdP for authentication

3. **SSO**: All apps share the same IdP session - logging into one logs into all

### Database Schema

All tables defined in `apps/idp/src/db/schema/index.ts`:
- `users`, `sessions`, `accounts` - Core auth (Better Auth compatible)
- `departments`, `roles`, `permissions` - RBAC
- `clients`, `authorization_codes`, `oauth_access_tokens`, `oauth_refresh_tokens` - OIDC
- `audit_logs`, `login_logs` - Auditing

### Trusted Clients

Configured in `apps/idp/src/lib/auth.ts` under `trustedClients`:
- `portal` - Admin Portal
- `demo-app` - Demo application

### Shared Packages

- `@auth-sso/contracts` - Error codes (`errors.ts`), permission codes (`permissions.ts`), OIDC constants (`oidc.ts`)
- `@auth-sso/config` - Shared TypeScript and ESLint configs

## Deployment (Vercel)

Each app needs `vercel.json` with custom installCommand for monorepo:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "installCommand": "cd ../.. && pnpm install --no-frozen-lockfile"
}
```

Required environment variables documented in `docs/vercel-dashboard-deployment.md`.

## Key Files

- `apps/idp/src/lib/auth.ts` - Better Auth configuration with OIDC Provider
- `apps/idp/src/lib/redis.ts` - Redis client for session storage
- `apps/idp/drizzle.config.ts` - Drizzle ORM configuration
- `apps/portal/src/lib/auth-client.ts` - Portal's OAuth client
- `apps/demo-app/src/lib/oauth.ts` - Demo app OAuth configuration

## Tech Stack

- Next.js 16 (Turbopack)
- Better Auth 1.5+ with OIDC Provider plugin
- Drizzle ORM + PostgreSQL
- Redis (ioredis) for session storage
- Tailwind CSS 4
- pnpm workspaces