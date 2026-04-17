# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Auth-SSO is an enterprise unified identity authentication platform implementing SSO (Single Sign-On) with OIDC Provider capabilities. It's a pnpm monorepo containing:

- **apps/idp** - Identity Provider (port 4001) - Better Auth with OIDC Provider plugin
- **apps/portal** - Admin Portal (port 4000) - User/role/permission management and Dashboard
- **apps/demo-app** - Demo SSO Client (port 4002) - Tests SSO integration
- **apps/customer-graph** - GPU Graph Visualization (port 4005) - RBAC Data Scope demonstration
- **packages/contracts** - Shared types, error codes, permission codes, OIDC constants
- **packages/config** - Shared TypeScript/ESLint configuration

## Development Commands

```bash
# Start all apps in development
pnpm dev

# Start specific app
pnpm --filter @auth-sso/idp dev      # IdP on port 4001
pnpm --filter @auth-sso/portal dev   # Portal on port 4000
pnpm --filter @auth-sso/demo-app dev # Demo on port 4002
pnpm --filter @auth-sso/customer-graph dev # Graph on port 4005
```

## Key Files

- `apps/idp/src/lib/auth.ts` - Better Auth configuration with OIDC Provider
- `apps/portal/src/app/dashboard/page.tsx` - Admin analytics dashboard
- `apps/portal/src/app/api/auth/callback/route.ts` - OAuth callback with intelligent redirection
- `apps/portal/src/lib/auth-middleware.ts` - RBAC check with data scope filtering
- `apps/portal/src/lib/session.ts` - Redis-backed portal session management
- `tests/data-scope.test.js` - Data scope integration tests

## Tech Stack

- Next.js 16 (Turbopack)
- Better Auth 1.5+ with OIDC Provider plugin
- Drizzle ORM + PostgreSQL
- Redis (ioredis) for session storage
- Tailwind CSS 4
- pnpm workspaces
## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
